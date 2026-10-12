import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import { MASKED_MODEL_ID } from '@/lib/models';
import {
  getConversation,
  listMessages,
  deleteConversation,
  updateConversationTitle,
  setConversationFolder,
  setConversationPinned,
  setConversationArchived,
  setConversationTags,
  getFolder,
} from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const { id } = await params;
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const messages = listMessages(id);
  // Non-admins never see which real model served a conversation.
  const model = isAdminSession(authd.session) ? conv.model : MASKED_MODEL_ID;
  return NextResponse.json({ ...conv, model, messages });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const { id } = await params;
  deleteConversation(id, userId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const { id } = await params;
  // Make sure the conversation belongs to this user before mutating anything.
  if (!getConversation(id, userId)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // Title, folder, pin, archive and tags can each be set independently.
  if (typeof body.title === 'string' && body.title.trim()) {
    updateConversationTitle(id, userId, body.title.trim().slice(0, 100));
  }
  if ('folderId' in body) {
    if (body.folderId == null) {
      setConversationFolder(id, userId, null);
    } else {
      const folderId = Number(body.folderId);
      // A folder id that isn't one of this user's folders must not stick.
      if (!Number.isInteger(folderId) || !getFolder(folderId, userId)) {
        return NextResponse.json({ error: 'folder not found' }, { status: 400 });
      }
      setConversationFolder(id, userId, folderId);
    }
  }
  if (typeof body.pinned === 'boolean') setConversationPinned(id, userId, body.pinned);
  if (typeof body.archived === 'boolean') setConversationArchived(id, userId, body.archived);
  if (Array.isArray(body.tags)) {
    setConversationTags(id, userId, body.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 12));
  }
  return NextResponse.json({ ok: true });
}
