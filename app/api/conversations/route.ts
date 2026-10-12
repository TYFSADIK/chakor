import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import { listConversations, createConversation } from '@/lib/db';
import { MASKED_MODEL_ID } from '@/lib/models';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const convs = listConversations(authd.userId);
  // Non-admins never see which real model served a conversation.
  if (!isAdminSession(authd.session)) {
    return NextResponse.json(convs.map((c) => ({ ...c, model: MASKED_MODEL_ID })));
  }
  return NextResponse.json(convs);
}

export async function POST(_req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const id = randomUUID();
  createConversation(id, userId, 'chakor');
  return NextResponse.json({ id, title: 'new session', model: 'chakor' });
}
