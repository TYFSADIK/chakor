import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { addCompareVote } from '@/lib/db';

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

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
