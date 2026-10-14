/**
 * /api/admin/imagemodels — manage the diffusion-model and text-encoder GGUFs
 * in <SDCPP_DIR>/models. Admin-only.
 *
 * GET     → { models: [{ name, sizeBytes, active }], encoders: [{ name, sizeBytes, active }] }
 * POST    { name } | { encoder } → make that model/encoder the active one
 * DELETE  { name } | { encoder } → delete the file from disk (the active one is refused)
 *
 * Model files are dropped into the models directory by the admin directly;
 * there is no download pipeline — the panel only lists, selects, deletes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { requireUser, isAdminSession } from '@/lib/guard';
import {
  listImageModels,
  getActiveImageModel,
  setActiveImageModel,
  imageModelPath,
} from '@/lib/image-gen';
import {
  listEncoders,
  resolveEncoderPath,
  setActiveEncoder,
  sanitizeGgufName,
  sdDir,
} from '@/lib/sd-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(): Promise<{ error: NextResponse } | null> {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return { error: authd };
  if (!isAdminSession(authd.session)) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return null;
}

async function payload() {
  const [models, active] = await Promise.all([listImageModels(), getActiveImageModel()]);
  const activeEncoder = path.basename(resolveEncoderPath());
  return {
    models: models.map((m) => ({ name: m.name, sizeBytes: m.size, active: m.name === active })),
    encoders: listEncoders().map((e) => ({ name: e.name, sizeBytes: e.size, active: e.name === activeEncoder })),
  };
}

/** Extract and sanitize whichever selector the body carries: {name} or {encoder}. */
function cleanBody(body: unknown): { kind: 'model' | 'encoder'; name: string } | NextResponse {
  const b = body as { name?: unknown; encoder?: unknown } | null;
  const kind = typeof b?.encoder === 'string' ? 'encoder' : 'model';
  const raw = kind === 'encoder' ? b?.encoder : b?.name;
  const clean = typeof raw === 'string' ? sanitizeGgufName(raw) : null;
  if (!clean) return NextResponse.json({ error: 'invalid model name' }, { status: 400 });
  return { kind, name: clean };
}

export async function GET() {
  const deny = await requireAdmin();
  if (deny) return deny.error;
  return NextResponse.json(await payload());
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const sel = cleanBody(await req.json().catch(() => null));
  if (sel instanceof NextResponse) return sel;

  if (sel.kind === 'encoder') {
    if (!listEncoders().some((e) => e.name === sel.name)) {
      return NextResponse.json({ error: 'encoder not found' }, { status: 404 });
    }
    setActiveEncoder(sel.name);
    return NextResponse.json(await payload());
  }

  const models = await listImageModels();
  if (!models.some((m) => m.name === sel.name)) {
    return NextResponse.json({ error: 'model not found' }, { status: 404 });
  }
  setActiveImageModel(sel.name);
  return NextResponse.json(await payload());
}

export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const sel = cleanBody(await req.json().catch(() => null));
  if (sel instanceof NextResponse) return sel;

  if (sel.kind === 'encoder') {
    if (sel.name === path.basename(resolveEncoderPath())) {
      return NextResponse.json({ error: 'cannot delete the active encoder' }, { status: 409 });
    }
    if (!listEncoders().some((e) => e.name === sel.name)) {
      return NextResponse.json({ error: 'encoder not found' }, { status: 404 });
    }
    await fs.unlink(path.join(sdDir(), 'models', sel.name));
    return NextResponse.json(await payload());
  }

  const active = await getActiveImageModel();
  if (sel.name === active) {
    return NextResponse.json({ error: 'cannot delete the active model' }, { status: 409 });
  }
  const models = await listImageModels();
  if (!models.some((m) => m.name === sel.name)) {
    return NextResponse.json({ error: 'model not found' }, { status: 404 });
  }
  await fs.unlink(imageModelPath(sel.name));
  return NextResponse.json(await payload());
}
