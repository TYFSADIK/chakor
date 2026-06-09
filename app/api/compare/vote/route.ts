import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { addCompareVote } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  const body = await req.json().catch(() => ({}));
  const winner = String(body?.winner ?? '').trim();
  const models = Array.isArray(body?.models)
    ? body.models.filter((m: unknown): m is string => typeof m === 'string')
    : [];
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  if (!winner) return NextResponse.json({ error: 'winner required' }, { status: 400 });

  addCompareVote(userId, winner, models, prompt);
  return NextResponse.json({ ok: true });
}
