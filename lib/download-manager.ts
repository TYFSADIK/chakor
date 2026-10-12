/**
 * Background model downloads. Pulling a multi-gigabyte GGUF takes minutes, so it
 * must not die when the user closes the tab or navigates away. This manager owns
 * the download loop the way lib/llama-supervisor owns the model process: a single
 * instance on globalThis runs each job to completion in the background, tracks
 * progress + speed, and the UI just polls a list.
 *
 * Server-only. Routes call start()/list()/cancel(); they never do the I/O.
 */
import { createWriteStream, createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { primaryModelsDir } from './local-llama';
import { idleWatchdog } from './llama';
import { logger, errText } from './logger';
import {
  resolveDownloadSet,
  resolveFileUrl,
  repoFolderName,
  hfHeaders,
  type HfDownloadFile,
} from './huggingface';

export type DownloadStatus = 'downloading' | 'done' | 'error' | 'cancelled';
/** downloading = bytes streaming; verifying = post-download size/sha256 check. */
export type DownloadPhase = 'downloading' | 'verifying';

export interface DownloadJob {
  id: string;
  repo: string;
  file: string;
  name: string;            // pretty file name being saved
  status: DownloadStatus;
  phase: DownloadPhase;    // what the job is doing right now (for the UI)
  total: number;           // bytes
  downloaded: number;      // bytes
  pct: number;             // 0..100
  speedBps: number;        // bytes/sec, smoothed
  etaSec: number | null;   // seconds remaining, null when unknown
  error: string | null;
  path: string | null;     // final on-disk path of the main file when done
  startedAt: number;
  finishedAt: number | null;
}

interface JobInternal extends DownloadJob {
  abort: AbortController;
  destDir: string;
  paths: string[];
  /** Expected size + sha256 per repo path, from the HF tree. */
  files: HfDownloadFile[];
  lastBytes: number;
  lastAt: number;
}

const MMPROJ_RE = /mmproj/i;
const KEEP_FINISHED_MS = 10 * 60 * 1000; // show completed/failed jobs for 10 min
const STALL_MS = 60_000; // fail a download that delivers no bytes for 60s

/** The bytes on disk don't match what Hugging Face said the file should be. */
export class IntegrityError extends Error {}

/** Streamed sha256 of a file — fine even for multi-GB GGUFs. */
function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(p);
    rs.on('data', (d) => hash.update(d));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

/**
 * Check a finished file against what the HF tree promised: size always (when
 * known), sha256 when the repo provides it (streamed, so multi-GB is fine).
 * A mismatch deletes the bad file and throws IntegrityError so the caller
 * refetches instead of leaving a corrupt model on disk.
 */
export async function verifyFileIntegrity(
  filePath: string,
  name: string,
  exp: { size: number; sha256: string | null },
): Promise<void> {
  const st = await fs.stat(filePath);
  if (exp.size > 0 && st.size !== exp.size) {
    await fs.rm(filePath, { force: true });
    throw new IntegrityError(`${name}: size mismatch (got ${st.size}, expected ${exp.size})`);
  }
  if (exp.sha256) {
    const digest = await sha256File(filePath);
    if (digest !== exp.sha256.toLowerCase()) {
      await fs.rm(filePath, { force: true });
      throw new IntegrityError(`${name}: sha256 mismatch — the download was corrupt`);
    }
  }
}

class DownloadManager {
  private jobs = new Map<string, JobInternal>();
  private seq = 0;

  /** Kick off a download in the background. Returns the job id immediately. */
  async start(repo: string, file: string): Promise<{ id?: string; error?: string }> {
    // Don't queue the same file twice if one is already running.
    for (const j of this.jobs.values()) {
      if (j.repo === repo && j.file === file && j.status === 'downloading') return { id: j.id };
    }

    let set: { paths: string[]; totalBytes: number; files: HfDownloadFile[] } | null;
    try {
      set = await resolveDownloadSet(repo, file);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not read the repo.' };
    }
    if (!set || set.paths.length === 0) return { error: 'That file was not found in the repo.' };

    const id = `dl_${Date.now()}_${++this.seq}`;
    const destDir = path.join(primaryModelsDir(), repoFolderName(repo));
    const mainRepoFile = set.paths.find((p) => !MMPROJ_RE.test(path.basename(p))) ?? set.paths[0];

    const job: JobInternal = {
      id, repo, file,
      name: path.basename(mainRepoFile),
      status: 'downloading',
      phase: 'downloading',
      total: set.totalBytes,
      downloaded: 0,
      pct: 0,
      speedBps: 0,
      etaSec: null,
      error: null,
      path: null,
      startedAt: Date.now(),
      finishedAt: null,
      abort: new AbortController(),
      destDir,
      paths: set.paths,
      files: set.files,
      lastBytes: 0,
      lastAt: Date.now(),
    };
    this.jobs.set(id, job);
    // Run detached — do NOT await. The HTTP response returns right away.
    void this.run(job);
    return { id };
  }

  private tick(job: JobInternal, downloaded: number): void {
    job.downloaded = downloaded;
    job.pct = job.total > 0 ? Math.min(100, Math.round((downloaded / job.total) * 100)) : 0;
    const now = Date.now();
    const dt = (now - job.lastAt) / 1000;
    if (dt >= 0.5) {
      const inst = (downloaded - job.lastBytes) / dt;
      // Smooth so the readout doesn't jump around.
      job.speedBps = job.speedBps > 0 ? job.speedBps * 0.6 + inst * 0.4 : inst;
      job.etaSec = job.speedBps > 0 && job.total > 0 ? Math.round((job.total - downloaded) / job.speedBps) : null;
      job.lastBytes = downloaded;
      job.lastAt = now;
    }
  }

  /** Stream one repo file to destDir as .part, then rename into place. */
  private async pullFile(job: JobInternal, repoFile: string, partPath: string, finalPath: string, doneBytes: number): Promise<number> {
    const name = path.basename(repoFile);
    job.phase = 'downloading';
    // Stall watchdog: abort if no bytes arrive for 60s so a wedged TCP
    // connection can't hang a multi-GB job forever at its last speedBps.
    const wd = idleWatchdog(job.abort.signal, STALL_MS);
    try {
      const res = await fetch(resolveFileUrl(job.repo, repoFile), { headers: hfHeaders(), signal: wd.signal });
      if (!res.ok || !res.body) throw new Error(`Hugging Face ${res.status} for ${name}`);

      const ws = createWriteStream(partPath);
      const reader = res.body.getReader();
      let fileBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          wd.reset();
          if (!ws.write(Buffer.from(value))) await new Promise<void>((r) => ws.once('drain', r));
          fileBytes += value.length;
          this.tick(job, doneBytes + fileBytes);
        }
        await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
      } catch (e) {
        ws.destroy();
        await fs.rm(partPath, { force: true });
        throw e;
      }
      await fs.rename(partPath, finalPath);
      return fileBytes;
    } finally {
      wd.done();
    }
  }

  /**
   * Check a finished file against what the HF tree promised, flipping the job
   * phase so the UI shows "verifying" while the checksum runs.
   */
  private async verifyFile(job: JobInternal, name: string, finalPath: string, exp: HfDownloadFile): Promise<void> {
    job.phase = 'verifying';
    try {
      await verifyFileIntegrity(finalPath, name, exp);
    } finally {
      job.phase = 'downloading';
    }
  }

  private async run(job: JobInternal): Promise<void> {
    let doneBytes = 0;
    try {
      await fs.mkdir(job.destDir, { recursive: true });
      const mainRepoFile = job.paths.find((p) => !MMPROJ_RE.test(path.basename(p))) ?? job.paths[0];
      const mainFinalPath = path.join(job.destDir, path.basename(mainRepoFile));

      // Fail fast when the disk can't hold the set — a multi-GB write that dies
      // at 90% wastes a lot of time and bandwidth. If statfs itself is
      // unavailable, log and proceed rather than block the download.
      if (job.total > 0) {
        try {
          const st = await fs.statfs(job.destDir);
          const free = Number(st.bavail) * Number(st.bsize);
          if (free < job.total) {
            throw new Error(`Not enough disk space: need ~${(job.total / 1e9).toFixed(1)} GB, only ~${(free / 1e9).toFixed(1)} GB free.`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('Not enough disk space')) throw e;
          logger.warn('disk space check unavailable', { dir: job.destDir, err: errText(e) });
        }
      }

      const expected = new Map(job.files.map((f) => [f.path, f]));

      for (const repoFile of job.paths) {
        const name = path.basename(repoFile);
        const finalPath = path.join(job.destDir, name);
        const partPath = `${finalPath}.part`;
        const exp = expected.get(repoFile) ?? { path: repoFile, size: 0, sha256: null };

        // Already downloaded fully? Skip (cheap resume across the file set) —
        // but only when the size matches what HF says the file should be. A
        // size>0 file of the wrong size is a truncated older download: delete
        // and refetch it. When HF gave no size, any non-empty file passes.
        // Documented limitation: no HTTP Range resume WITHIN a file — a failed
        // file restarts from zero.
        try {
          const st = await fs.stat(finalPath);
          if (exp.size > 0 ? st.size === exp.size : st.size > 0) { doneBytes += st.size; this.tick(job, doneBytes); continue; }
          logger.warn('existing file has wrong size, re-downloading', { path: finalPath, have: st.size, want: exp.size });
          await fs.rm(finalPath, { force: true });
        } catch (e) {
          if (e instanceof Error && 'code' in e && e.code !== 'ENOENT') throw e;
        }

        // Pull the file and verify it; on an integrity mismatch the bad bytes
        // are deleted and the file is refetched once before the job fails.
        let fileBytes = 0;
        for (let attempt = 1; ; attempt++) {
          try {
            fileBytes = await this.pullFile(job, repoFile, partPath, finalPath, doneBytes);
            await this.verifyFile(job, name, finalPath, exp);
            break;
          } catch (e) {
            if (e instanceof IntegrityError && attempt < 2) {
              logger.warn('integrity check failed, re-downloading', { path: finalPath, err: errText(e) });
              continue;
            }
            throw e;
          }
        }
        doneBytes += fileBytes;
        this.tick(job, doneBytes);
      }

      job.status = 'done';
      // Only advertise the final path once every byte is on disk — a failed job
      // must never point at a file that doesn't exist.
      job.path = mainFinalPath;
      job.downloaded = job.total || doneBytes;
      job.pct = 100;
      job.speedBps = 0;
      job.etaSec = 0;
      job.finishedAt = Date.now();
    } catch (e) {
      const aborted = job.abort.signal.aborted || (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)));
      job.status = aborted ? 'cancelled' : 'error';
      job.error = aborted ? null : (e instanceof Error ? e.message : 'Download failed.');
      job.finishedAt = Date.now();
      if (!aborted) logger.error('download failed', { repo: job.repo, file: job.file, err: errText(e) });
      // Tidy any partial file from the file we were on.
      await fs.rm(path.join(job.destDir, `${job.name}.part`), { force: true }).catch(() => {});
    }
  }

  /** Public snapshot of all jobs, newest first, with stale finished ones pruned. */
  list(): DownloadJob[] {
    const now = Date.now();
    const out: DownloadJob[] = [];
    for (const [id, j] of this.jobs) {
      if (j.finishedAt && now - j.finishedAt > KEEP_FINISHED_MS) { this.jobs.delete(id); continue; }
      out.push(this.view(j));
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  cancel(id: string): boolean {
    const j = this.jobs.get(id);
    if (!j) return false;
    if (j.status === 'downloading') j.abort.abort();
    else this.jobs.delete(id); // dismiss a finished/failed card
    return true;
  }

  /** Are any downloads currently in flight (for the UI's polling cadence). */
  hasActive(): boolean {
    for (const j of this.jobs.values()) if (j.status === 'downloading') return true;
    return false;
  }

  private view(j: JobInternal): DownloadJob {
    const { abort, destDir, paths, files, lastBytes, lastAt, ...pub } = j; // strip internals
    void abort; void destDir; void paths; void files; void lastBytes; void lastAt;
    return pub;
  }
}

function getManager(): DownloadManager {
  const g = globalThis as typeof globalThis & { __chakorDownloads?: DownloadManager };
  if (!g.__chakorDownloads) g.__chakorDownloads = new DownloadManager();
  return g.__chakorDownloads;
}

export const downloadManager = getManager();
