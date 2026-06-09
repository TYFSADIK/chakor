import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { detectHardware, hardwareSummary } from '@/lib/hardware';
import { probeEngines } from '@/lib/backends';
import { fitModel, recommendedModelPath, maxContextForModel } from '@/lib/hwfit';
import { scanLocalModels, liveProps } from '@/lib/local-llama';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

/**
 * One call for the whole "what can this machine run, and what's running" picture:
 * detected hardware, the status of every local engine (llama.cpp / Ollama / LM
 * Studio), and a fit verdict for each local model file. The picker and the
 * Settings -> Models page both read this so a user never has to guess (or open a
 * terminal) to find out why a model crashed or where to switch.
 *
 * GET /api/system          - cached hardware probe
 * GET /api/system?fresh=1  - re-probe hardware (the Rescan button)
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const admin = isAdmin(session);

  const [hardware, engines, live] = await Promise.all([
    detectHardware(fresh),
    probeEngines(),
    liveProps(),
  ]);

  // Hardware + engine status are safe for any signed-in user (they drive the
  // picker's "this engine is down, switch here" hint). File paths and the full
  // model list stay admin-only, matching /api/models/local.
  const base = {
    hardware,
    hardwareSummary: hardwareSummary(hardware),
    engines,
    isAdmin: admin,
  };

  if (!admin) return NextResponse.json(base);

  const found = await scanLocalModels(live.modelPath);
  const localModels = found.map((m) => ({
    path: m.path,
    name: m.name,
    size: m.size,
    vision: m.vision,
    fit: fitModel(m.size, hardware),
    maxCtx: maxContextForModel(m.size, hardware),
  }));

  return NextResponse.json({
    ...base,
    localModels,
    recommended: recommendedModelPath(found, hardware),
  });
}
