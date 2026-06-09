import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { primaryModelsDir } from '@/lib/local-llama';
import {
  sanitizeRepo,
  sanitizeRepoFile,
  resolveDownloadSet,
  resolveFileUrl,
  repoFolderName,
  hfHeaders,
} from '@/lib/huggingface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600; // model files are big; don't cut the stream short

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

const MMPROJ_RE = /mmproj/i;

/**
 * POST /api/models/hf/pull { repo, file }
 * Download a GGUF (and its shards / mmproj sibling) from Hugging Face into the
 * local models directory, streaming progress back as SSE so the UI shows a bar.
 * Admin only. Once finished, scanLocalModels() picks it up and it's ready to run.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const repo = sanitizeRepo(String(body?.repo ?? ''));
  const file = sanitizeRepoFile(String(body?.file ?? ''));
  if (!repo || !file) return NextResponse.json({ error: 'A valid repo and .gguf file are required.' }, { status: 400 });

  let set: { paths: string[]; totalBytes: number } | null;
  try {
    set = await resolveDownloadSet(repo, file);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read repo.' }, { status: 502 });
  }
  if (!set || set.paths.length === 0) return NextResponse.json({ error: 'That file was not found in the repo.' }, { status: 404 });

  const destDir = path.join(primaryModelsDir(), repoFolderName(repo));
  const total = set.totalBytes;
  const downloadPaths = set.paths;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // The file the UI should offer to run when we're done (first non-mmproj).
      const mainRepoFile = downloadPaths.find((p) => !MMPROJ_RE.test(path.basename(p))) ?? downloadPaths[0];
      const mainLocalPath = path.join(destDir, path.basename(mainRepoFile));

      let doneBytes = 0; // bytes finished across already-completed files
      try {
        await fs.mkdir(destDir, { recursive: true });
        send({ status: `Preparing ${path.basename(mainRepoFile)}…`, completed: 0, total });

        for (const repoFile of downloadPaths) {
          const name = path.basename(repoFile);
          const finalPath = path.join(destDir, name);
          const partPath = `${finalPath}.part`;

          // Already have it (right size)? Skip — makes re-pull / multi-file resume cheap.
          try {
            const st = await fs.stat(finalPath);
            if (st.size > 0) { doneBytes += st.size; send({ status: `Already have ${name}`, completed: doneBytes, total }); continue; }
          } catch { /* not there yet */ }

          const res = await fetch(resolveFileUrl(repo, repoFile), { headers: hfHeaders(), signal: req.signal });
          if (!res.ok || !res.body) throw new Error(`Hugging Face ${res.status} for ${name}`);

          const ws = createWriteStream(partPath);
          const reader = res.body.getReader();
          let fileBytes = 0;
          let lastTick = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!ws.write(Buffer.from(value))) await new Promise<void>((r) => ws.once('drain', r));
              fileBytes += value.length;
              const now = Date.now();
              if (now - lastTick > 300) { // throttle UI updates
                lastTick = now;
                send({ status: `Downloading ${name}`, completed: doneBytes + fileBytes, total });
              }
            }
            await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
          } catch (e) {
            ws.destroy();
            await fs.rm(partPath, { force: true });
            throw e;
          }

          await fs.rename(partPath, finalPath);
          doneBytes += fileBytes;
          send({ status: `Saved ${name}`, completed: doneBytes, total });
        }

        send({ done: true, path: mainLocalPath, name: path.basename(mainLocalPath), completed: total || doneBytes, total: total || doneBytes });
      } catch (e) {
        const aborted = e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
        send({ error: aborted ? 'Download cancelled.' : (e instanceof Error ? e.message : 'Download failed.') });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop reverse proxies (nginx, and tunnels like cloudflared) from buffering
      // the stream, which would freeze the progress bar until the very end.
      'X-Accel-Buffering': 'no',
    },
  });
}
