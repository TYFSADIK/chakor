/**
 * GET /api/admin/images — image-generation status for the admin panel:
 * feature flag, allowlist, engine label (stable-diffusion.cpp), sd-server
 * reachability, swap/parallel mode, and the installed GGUF models + encoders.
 * PUT /api/admin/images — { enabled?, allowlist? } updates the settings.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as path from 'node:path';
import { requireUser, isAdminSession } from '@/lib/guard';
import { setSetting, getUserById } from '@/lib/db';
import {
  readImageGenSettings,
  decideImageMode,
  listImageModels,
  getActiveImageModel,
  imageModelsDir,
  imageQuality,
  isImageQuality,
  estimateImageSeconds,
} from '@/lib/image-gen';
import { sdCapabilities, listEncoders, resolveEncoderPath } from '@/lib/sd-server';
import { detectHardware } from '@/lib/hardware';

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

export async function GET() {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const settings = readImageGenSettings();
  const [caps, models, activeModel, hw] = await Promise.all([
    sdCapabilities(),
    listImageModels(),
    getActiveImageModel(),
    detectHardware(),
  ]);

  const mode = decideImageMode(hw);
  const quality = imageQuality();
  return NextResponse.json({
    enabled: settings.enabled,
    allowlist: settings.allowlist,
    engine: 'stable-diffusion.cpp',
    online: caps !== null,
    mode,
    quality,
    etaSeconds: estimateImageSeconds(mode, quality),
    modelsDir: imageModelsDir(),
    activeModel,
    models: models.map((m) => ({ name: m.name, sizeBytes: m.size, active: m.name === activeModel })),
    activeEncoder: path.basename(resolveEncoderPath()),
    encoders: listEncoders().map((e) => ({ name: e.name, sizeBytes: e.size, active: e.name === path.basename(resolveEncoderPath()) })),
  });
}

export async function PUT(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const unknown = Object.keys(body).filter((k) => k !== 'enabled' && k !== 'allowlist' && k !== 'quality');
  if (unknown.length) {
    return NextResponse.json({ error: `unknown setting: ${unknown.join(', ')}` }, { status: 400 });
  }

  const b = body as { enabled?: unknown; allowlist?: unknown; quality?: unknown };
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    setSetting('image_gen_enabled', b.enabled ? 'true' : 'false');
  }
  if (b.allowlist !== undefined) {
    if (!Array.isArray(b.allowlist) || !b.allowlist.every((n) => Number.isInteger(n) && n > 0)) {
      return NextResponse.json({ error: 'allowlist must be an array of user ids' }, { status: 400 });
    }
    // Drop ids that don't exist, so the stored list can never rot.
    const valid = (b.allowlist as number[]).filter((id) => !!getUserById(id));
    setSetting('image_gen_allowlist', JSON.stringify(valid));
  }
  if (b.quality !== undefined) {
    if (!isImageQuality(b.quality)) {
      return NextResponse.json({ error: 'quality must be fast, balanced, or quality' }, { status: 400 });
    }
    setSetting('image_quality', b.quality);
  }

  return NextResponse.json({ ...readImageGenSettings(), quality: imageQuality() });
}
