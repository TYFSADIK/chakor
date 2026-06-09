import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateDisplayName } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const name = String(body.displayName ?? '').trim().slice(0, 50);
  if (!name) return NextResponse.json({ error: 'displayName required' }, { status: 400 });

  updateDisplayName(userId, name);
  return NextResponse.json({ ok: true });
}
