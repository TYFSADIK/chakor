import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { listMemories, createMemory } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  return NextResponse.json(listMemories(authd.userId));
}

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
  return NextResponse.json(createMemory(randomUUID(), userId, content, 'user'));
}
