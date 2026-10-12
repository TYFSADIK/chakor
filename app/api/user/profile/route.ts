import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { updateDisplayName } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const name = String(body.displayName ?? '').trim().slice(0, 50);
  if (!name) return NextResponse.json({ error: 'displayName required' }, { status: 400 });

  updateDisplayName(userId, name);
  return NextResponse.json({ ok: true });
}
