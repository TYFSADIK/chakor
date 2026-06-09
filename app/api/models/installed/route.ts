import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { OLLAMA_BASE_URL } from '@/lib/models';
import type { Session } from 'next-auth';

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

// List installed Ollama models with size + modified date, for the management UI.
export async function GET() {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return NextResponse.json({ models: [], reachable: false });
    const data = await res.json();
    const models = ((data.models ?? []) as Array<{ name?: string; size?: number; modified_at?: string }>)
      .filter((m) => m.name)
      .map((m) => ({ name: m.name as string, size: m.size ?? 0, modified_at: m.modified_at ?? null }));
    return NextResponse.json({ models, reachable: true });
  } catch {
    return NextResponse.json({ models: [], reachable: false });
  }
}

// Delete an installed Ollama model: DELETE /api/models/installed { name }
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'model name required' }, { status: 400 });

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `Ollama ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not reach Ollama. Is it running?' }, { status: 502 });
  }
}
