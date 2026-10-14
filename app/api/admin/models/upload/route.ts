/**
 * POST /api/admin/models/upload?name=<file>.gguf&kind=chat|image|encoder
 *
 * Uploads a GGUF straight from the browser into the shared models folder.
 * The request body is the raw file, streamed to disk (never buffered in
 * memory — these files are gigabytes). The file lands as <name>.part and is
 * renamed into place only when the upload completes, so an interrupted
 * upload never looks like a loadable model. kind is optional; the name
 * heuristic guesses it, and the tag decides which lists (chat picker / image
 * models / encoders) the file appears in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireUser, isAdminSession } from '@/lib/guard';
import {
  sanitizeGgufName,
  guessModelKind,
  setModelKind,
  modelsHome,
  type ModelKind,
} from '@/lib/sd-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Belts and braces: never let a multipart parser near these bodies.
export const maxDuration = 3600;

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  if (!isAdminSession(authd.session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const name = sanitizeGgufName(url.searchParams.get('name') ?? '');
  if (!name) return NextResponse.json({ error: 'invalid file name (basename .gguf only)' }, { status: 400 });

  const kindParam = url.searchParams.get('kind') ?? '';
  const kind: ModelKind =
    kindParam === 'chat' || kindParam === 'image' || kindParam === 'encoder'
      ? kindParam
      : guessModelKind(name);

  if (!req.body) return NextResponse.json({ error: 'empty body' }, { status: 400 });

  const dir = modelsHome();
  const dest = path.join(dir, name);
  const part = `${dest}.part`;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    return NextResponse.json({ error: `cannot write to ${dir}` }, { status: 500 });
  }
  try {
    await fs.stat(dest);
    return NextResponse.json({ error: 'a model with that name already exists — delete it first' }, { status: 409 });
  } catch { /* does not exist: good */ }

  let bytes = 0;
  try {
    const ws = createWriteStream(part);
    await pipeline(
      Readable.fromWeb(req.body as import('node:stream/web').ReadableStream),
      async function* (source) {
        for await (const chunk of source) {
          bytes += (chunk as Buffer).length;
          yield chunk;
        }
      },
      ws,
    );
    await fs.rename(part, dest);
  } catch {
    await fs.unlink(part).catch(() => {});
    return NextResponse.json({ error: 'upload failed or was aborted' }, { status: 500 });
  }

  setModelKind(name, kind);
  return NextResponse.json({ ok: true, name, kind, sizeBytes: bytes, dir });
}
