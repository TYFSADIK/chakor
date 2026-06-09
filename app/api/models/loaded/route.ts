import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { OLLAMA_BASE_URL } from '@/lib/models';
import type { Session } from 'next-auth';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

// GET: which Ollama models are currently loaded in memory (like `ollama ps`).
// Any signed-in user can see this, it is read-only status.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return NextResponse.json({ models: [], reachable: false });
    const data = await res.json();
    const models = ((data.models ?? []) as Array<{ name?: string; model?: string; size?: number; size_vram?: number; expires_at?: string }>)
      .map((m) => ({ name: m.name ?? m.model ?? '', size: m.size ?? 0, sizeVram: m.size_vram ?? 0, expiresAt: m.expires_at ?? null }))
      .filter((m) => m.name);
    return NextResponse.json({ models, reachable: true });
  } catch {
    return NextResponse.json({ models: [], reachable: false });
  }
}

// POST { name, action: 'load' | 'unload' }: keep_alive -1 loads and pins the
// model, 0 unloads it. Admin only, since it changes the shared server's memory.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const action = body?.action === 'unload' ? 'unload' : 'load';
  if (!name) return NextResponse.json({ error: 'model name required' }, { status: 400 });

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, prompt: '', stream: false, keep_alive: action === 'unload' ? 0 : -1 }),
      // Loading a cold model into VRAM can take a while; unloading is instant.
      signal: AbortSignal.timeout(action === 'unload' ? 8_000 : 120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `Ollama ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, action });
  } catch {
    return NextResponse.json({ error: 'Could not reach Ollama. Is it running?' }, { status: 502 });
  }
}
