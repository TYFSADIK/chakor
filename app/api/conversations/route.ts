import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listConversations, createConversation } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  return NextResponse.json(listConversations(userId));
}

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const id = randomUUID();
  createConversation(id, userId, 'chakor');
  return NextResponse.json({ id, title: 'new session', model: 'chakor' });
}
