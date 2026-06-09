import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listApiKeys, createApiKey } from '@/lib/db';
import { generateApiToken, maskToken } from '@/lib/apiauth';

function userId(session: { user?: unknown } | null): number | null {
  const id = (session?.user as { id?: number } | undefined)?.id;
  return typeof id === 'number' ? id : null;
}

// List the caller's API keys. Tokens are masked — the full value is only ever
// shown once, at creation time.
export async function GET() {
  const session = await auth();
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const keys = listApiKeys(uid).map((k) => ({
    id: k.id,
    name: k.name,
    masked: maskToken(k.token),
    created_at: k.created_at,
    last_used: k.last_used,
  }));
  return NextResponse.json(keys);
}

// Create a new key. Returns the full token exactly once.
export async function POST(req: NextRequest) {
  const session = await auth();
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 60) || 'API key';

  const token = generateApiToken();
  const key = createApiKey(uid, name, token);

  return NextResponse.json({ id: key.id, name: key.name, token, created_at: key.created_at });
}
