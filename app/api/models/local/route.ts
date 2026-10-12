import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { liveProps, scanLocalModels, readRuntimeEnv, writeRuntimeEnv, findMmproj, waitForHealthy } from '@/lib/local-llama';
import { llamaSupervisor, type SupervisorMode } from '@/lib/llama-supervisor';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

const MIN_CTX = 512;
const MAX_CTX = 131072;

function modeOf(managing: boolean, enabled: boolean, online: boolean): SupervisorMode {
  if (managing) return 'managed';
  if (online) return 'external';
  return enabled ? 'down' : 'off';
}

/**
 * GET: status of the local model. Admin only — the live status carries the
 * real model file name, which non-admins must never see. The non-admin UI
 * treats a 403 as "no live info" and falls back to the static model config.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const live = await liveProps();
  const st = llamaSupervisor.status();
  const mode = modeOf(st.managing, st.enabled, live.online);

  const [available, runtime] = await Promise.all([scanLocalModels(live.modelPath), readRuntimeEnv()]);
  return NextResponse.json({
    live,
    available,
    managed: st.managing,
    mode,
    supervisor: { running: st.running, lastError: st.lastError, failureKind: st.failureKind, restarts: st.restarts },
    runtime,
    isAdmin: true,
  });
}

/**
 * POST { model?, ctx? }: switch the local model and/or context size. Admin only.
 * When Chakor supervises the server it restarts the child in-process (no sudo);
 * otherwise the choice is saved and applied once Chakor is supervising.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const live = await liveProps();
  const available = await scanLocalModels(live.modelPath);

  // Resolve the target model: explicit choice (validated against disk) or keep current.
  let model = typeof body.model === 'string' && body.model ? body.model : live.modelPath;
  if (body.model) {
    const match = available.find((m) => m.path === body.model);
    if (!match) return NextResponse.json({ error: 'Unknown model file. Refresh and try again.' }, { status: 400 });
    model = match.path;
  }

  // Resolve context: explicit value (clamped) or keep current.
  let ctx = live.nCtx ?? 8192;
  if (body.ctx != null) {
    const n = Math.round(Number(body.ctx));
    if (!Number.isFinite(n) || n < MIN_CTX || n > MAX_CTX) {
      return NextResponse.json({ error: `Context must be between ${MIN_CTX} and ${MAX_CTX}.` }, { status: 400 });
    }
    ctx = n;
  }

  const st = llamaSupervisor.status();

  // Supervised (or able to take over because nothing else is serving): apply now.
  if (st.managing || (st.enabled && !live.online)) {
    if (!model) return NextResponse.json({ error: 'No model selected and none found on disk.' }, { status: 400 });
    const mmproj = (await findMmproj(model)) ?? '';
    const r = await llamaSupervisor.restart({ model, ctx, mmproj });
    if (!r.ok) return NextResponse.json({ error: r.error ?? 'restart failed', mode: 'managed' }, { status: 502 });
    // restart() resolves at spawn; large GGUFs answer 503 until the model is
    // actually loaded. Wait for real health so "applied" means usable — if it
    // is still loading, report 'starting' so the UI can poll GET for readiness.
    const healthy = await waitForHealthy();
    if (!healthy) {
      return NextResponse.json({ ok: true, applied: false, starting: true, managed: true, mode: 'managed', model, ctx });
    }
    return NextResponse.json({ ok: true, applied: true, managed: true, mode: 'managed', model, ctx });
  }

  // Something external owns the server (e.g. the old separate service). Save the
  // choice so it applies once Chakor supervises; tell the UI to consolidate.
  if (!model) return NextResponse.json({ error: 'No model selected and none found on disk.' }, { status: 400 });
  const mmproj = (await findMmproj(model)) ?? '';
  await writeRuntimeEnv({ model, ctx, mmproj });
  return NextResponse.json({ ok: true, applied: false, managed: false, mode: st.enabled ? 'external' : 'off', model, ctx });
}
