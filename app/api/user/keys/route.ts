import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { listApiKeys, createApiKey } from '@/lib/db';
import { generateApiToken, maskToken } from '@/lib/apiauth';

// List the caller's API keys. Tokens are masked — the full value is only ever
// shown once, at creation time.
export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const keys = listApiKeys(userId).map((k) => ({
    id: k.id,
    name: k.name,
    masked: maskToken(k.token_tail ?? ''),
    created_at: k.created_at,
    last_used: k.last_used,
  }));
  return NextResponse.json(keys);
}

// Create a new key. Returns the full token exactly once.
export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 60) || 'API key';

  const token = generateApiToken();
  const key = createApiKey(userId, name, token);

  return NextResponse.json({ id: key.id, name: key.name, token, created_at: key.created_at });
}
