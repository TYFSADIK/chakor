/**
 * /api/admin/imagemodels — manage the diffusion-model GGUFs in
 * <SDCPP_DIR>/models. Admin-only.
 *
 * GET     → { models: [{ name, sizeBytes, active }] }
 * POST    { name } → make that model the active one (must exist on disk)
 * DELETE  { name } → delete the file from disk (the active model is refused)
 *
 * Model files are dropped into the models directory by the admin directly;
 * there is no download pipeline — the panel only lists, selects, deletes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { requireUser, isAdminSession } from '@/lib/guard';
import {
  listImageModels,
  getActiveImageModel,
  setActiveImageModel,
  sanitizeGgufName,
  imageModelPath,
} from '@/lib/image-gen';

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
  return { models: models.map((m) => ({ name: m.name, sizeBytes: m.size, active: m.name === active })) };
}

function cleanName(body: unknown): string | NextResponse {
  const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name : '';
  const clean = sanitizeGgufName(name);
  if (!clean) return NextResponse.json({ error: 'invalid model name' }, { status: 400 });
  return clean;
}

export async function GET() {
  const deny = await requireAdmin();
  if (deny) return deny.error;
  return NextResponse.json(await payload());
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const body = await req.json().catch(() => null);
  const name = cleanName(body);
  if (name instanceof NextResponse) return name;

  const models = await listImageModels();
  if (!models.some((m) => m.name === name)) {
    return NextResponse.json({ error: 'model not found' }, { status: 404 });
  }
  setActiveImageModel(name);
  return NextResponse.json(await payload());
}

export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const body = await req.json().catch(() => null);
  const name = cleanName(body);
  if (name instanceof NextResponse) return name;

  const active = await getActiveImageModel();
  if (name === active) {
    return NextResponse.json({ error: 'cannot delete the active model' }, { status: 409 });
  }
  const models = await listImageModels();
  if (!models.some((m) => m.name === name)) {
    return NextResponse.json({ error: 'model not found' }, { status: 404 });
  }
  await fs.unlink(imageModelPath(name));
  return NextResponse.json(await payload());
}
