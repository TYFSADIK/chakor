import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { getModel } from '@/lib/models';
import { engineForProvider, activateEngine } from '@/lib/backends';
import { detectHardware } from '@/lib/hardware';
import { canRunMultipleModels } from '@/lib/hwfit';
import { readAppSettings, writeAppSettings } from '@/lib/app-settings';

export const runtime = 'nodejs';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

// GET — current exclusivity setting + whether this machine could even handle
// multiple models loaded at once (so the UI knows whether to offer the toggle).
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [settings, hw] = await Promise.all([readAppSettings(), detectHardware()]);
  return NextResponse.json({ multiModel: settings.multiModel, canMultiModel: canRunMultipleModels(hw) });
}

/**
 * POST { modelId } — switch the active engine to the one behind this model. With
 * the default one-at-a-time policy this evicts whatever else was loaded so the
 * new model has room; with multiModel on it leaves the others alone. Admin only,
 * since it changes the shared server's memory.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const modelId = String(body?.modelId ?? '').trim();
  if (!modelId) return NextResponse.json({ error: 'modelId required' }, { status: 400 });

  const model = getModel(modelId);
  const target = model ? engineForProvider(model.provider) : null;

  const settings = await readAppSettings();
  // Multi-model on, or a cloud model (no local memory to free): nothing to evict.
  if (settings.multiModel || target === null) {
    return NextResponse.json({ ok: true, exclusive: false, freed: [], llamaStarted: false, target });
  }

  const { freed, llamaStarted } = await activateEngine(target);
  return NextResponse.json({ ok: true, exclusive: true, freed, llamaStarted, target });
}

// PUT { multiModel } — turn keeping multiple models loaded on or off. Admin only.
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const multiModel = Boolean(body?.multiModel);
  const saved = await writeAppSettings({ multiModel });
  return NextResponse.json({ ok: true, multiModel: saved.multiModel });
}
