/**
 * Background model downloads. Pulling a multi-gigabyte GGUF takes minutes, so it
 * must not die when the user closes the tab or navigates away. This manager owns
 * the download loop the way lib/llama-supervisor owns the model process: a single
 * instance on globalThis runs each job to completion in the background, tracks
 * progress + speed, and the UI just polls a list.
 *
 * Server-only. Routes call start()/list()/cancel(); they never do the I/O.
 */
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { primaryModelsDir } from './local-llama';
import {
  resolveDownloadSet,
  resolveFileUrl,
  repoFolderName,
  hfHeaders,
} from './huggingface';

export type DownloadStatus = 'downloading' | 'done' | 'error' | 'cancelled';

export interface DownloadJob {
  id: string;
  repo: string;
  file: string;
  name: string;            // pretty file name being saved
  status: DownloadStatus;
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
  lastBytes: number;
  lastAt: number;
}

const MMPROJ_RE = /mmproj/i;
const KEEP_FINISHED_MS = 10 * 60 * 1000; // show completed/failed jobs for 10 min

class DownloadManager {
  private jobs = new Map<string, JobInternal>();
  private seq = 0;

  /** Kick off a download in the background. Returns the job id immediately. */
  async start(repo: string, file: string): Promise<{ id?: string; error?: string }> {
    // Don't queue the same file twice if one is already running.
    for (const j of this.jobs.values()) {
      if (j.repo === repo && j.file === file && j.status === 'downloading') return { id: j.id };
    }

    let set: { paths: string[]; totalBytes: number } | null;
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

  private async run(job: JobInternal): Promise<void> {
    let doneBytes = 0;
    try {
      await fs.mkdir(job.destDir, { recursive: true });
      const mainRepoFile = job.paths.find((p) => !MMPROJ_RE.test(path.basename(p))) ?? job.paths[0];
      job.path = path.join(job.destDir, path.basename(mainRepoFile));

      for (const repoFile of job.paths) {
        const name = path.basename(repoFile);
        const finalPath = path.join(job.destDir, name);
        const partPath = `${finalPath}.part`;

        // Already downloaded fully? Skip (cheap resume across the file set).
        try {
          const st = await fs.stat(finalPath);
          if (st.size > 0) { doneBytes += st.size; this.tick(job, doneBytes); continue; }
        } catch { /* not present */ }

        const res = await fetch(resolveFileUrl(job.repo, repoFile), { headers: hfHeaders(), signal: job.abort.signal });
        if (!res.ok || !res.body) throw new Error(`Hugging Face ${res.status} for ${name}`);

        const ws = createWriteStream(partPath);
        const reader = res.body.getReader();
        let fileBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
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
        doneBytes += fileBytes;
        this.tick(job, doneBytes);
      }

      job.status = 'done';
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
    const { abort, destDir, paths, lastBytes, lastAt, ...pub } = j; // strip internals
    void abort; void destDir; void paths; void lastBytes; void lastAt;
    return pub;
  }
}

function getManager(): DownloadManager {
  const g = globalThis as typeof globalThis & { __chakorDownloads?: DownloadManager };
  if (!g.__chakorDownloads) g.__chakorDownloads = new DownloadManager();
  return g.__chakorDownloads;
}

export const downloadManager = getManager();
