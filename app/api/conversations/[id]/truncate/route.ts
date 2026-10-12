import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { getConversation, deleteMessagesFrom } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

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
