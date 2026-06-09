import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { OLLAMA_BASE_URL } from '@/lib/models';

// POST { name }: size, quantization and family for an installed Ollama model
// (from `/api/show`). Read-only, available to any signed-in user.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'model name required' }, { status: 400 });

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Ollama ${res.status}` }, { status: 502 });
    const data = await res.json();
    const d = data.details ?? {};
    return NextResponse.json({
      parameterSize: d.parameter_size ?? null,
      quantization: d.quantization_level ?? null,
      family: d.family ?? null,
      format: d.format ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Could not reach Ollama' }, { status: 502 });
  }
}
