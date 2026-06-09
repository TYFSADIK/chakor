import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getConversation, deleteMessagesFrom } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  const { id } = await params;
  if (!getConversation(id, userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const fromMessageId = body?.fromMessageId;
  if (typeof fromMessageId !== 'number') {
    return NextResponse.json({ error: 'fromMessageId required' }, { status: 400 });
  }

  deleteMessagesFrom(id, fromMessageId);
  return NextResponse.json({ ok: true });
}
