import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getConversation,
  listMessages,
  deleteConversation,
  updateConversationTitle,
  setConversationFolder,
  setConversationPinned,
  setConversationArchived,
  setConversationTags,
} from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const messages = listMessages(id);
  return NextResponse.json({ ...conv, messages });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  deleteConversation(id, userId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  // Make sure the conversation belongs to this user before mutating anything.
  if (!getConversation(id, userId)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // Title, folder, pin, archive and tags can each be set independently.
  if (typeof body.title === 'string' && body.title.trim()) {
    updateConversationTitle(id, userId, body.title.trim().slice(0, 100));
  }
  if ('folderId' in body) {
    setConversationFolder(id, userId, body.folderId == null ? null : Number(body.folderId));
  }
  if (typeof body.pinned === 'boolean') setConversationPinned(id, userId, body.pinned);
  if (typeof body.archived === 'boolean') setConversationArchived(id, userId, body.archived);
  if (Array.isArray(body.tags)) {
    setConversationTags(id, userId, body.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 12));
  }
  return NextResponse.json({ ok: true });
}
