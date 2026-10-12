import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { listPrompts, createPrompt } from '@/lib/db';

export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  return NextResponse.json(listPrompts(authd.userId));
}

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? '').trim().slice(0, 80);
  const promptBody = String(body?.body ?? '').trim().slice(0, 8000);
  if (!title || !promptBody) return NextResponse.json({ error: 'title and body required' }, { status: 400 });

  return NextResponse.json(createPrompt(userId, title, promptBody));
}
