import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listMemories, createMemory } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  return NextResponse.json(listMemories(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
  return NextResponse.json(createMemory(randomUUID(), userId, content, 'user'));
}
