import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listPrompts, createPrompt } from '@/lib/db';

function userId(session: { user?: unknown } | null): number | null {
  const id = (session?.user as { id?: number } | undefined)?.id;
  return typeof id === 'number' ? id : null;
}

export async function GET() {
  const session = await auth();
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(listPrompts(uid));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const uid = userId(session);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = String(body?.title ?? '').trim().slice(0, 80);
  const promptBody = String(body?.body ?? '').trim().slice(0, 8000);
  if (!title || !promptBody) return NextResponse.json({ error: 'title and body required' }, { status: 400 });

  return NextResponse.json(createPrompt(uid, title, promptBody));
}
