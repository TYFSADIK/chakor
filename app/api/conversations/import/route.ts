import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser, isAdminSession } from '@/lib/guard';
import { importConversation, getConversation } from '@/lib/db';
import { defaultModel, MASKED_MODEL_ID } from '@/lib/models';

/**
 * Import a conversation from an exported .json file (the same shape the
 * "Export .json" button produces: { title, messages: [{ role, content }] }).
 * Creates a fresh conversation owned by the caller.
 */
export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const body = await req.json().catch(() => null);
  const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
  if (!rawMessages) return NextResponse.json({ error: 'messages array required' }, { status: 400 });

  const messages = rawMessages
    .filter((m: unknown): m is { role: string; content: string } =>
      !!m && typeof (m as { content?: unknown }).content === 'string' &&
      ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant'))
    .slice(0, 1000);

  if (messages.length === 0) return NextResponse.json({ error: 'no valid messages' }, { status: 400 });

  const title = String(body?.title ?? 'Imported conversation').trim().slice(0, 100) || 'Imported conversation';
  const convId = randomUUID();
  const admin = isAdminSession(authd.session);
  importConversation(
    convId,
    userId,
    admin ? defaultModel().id : MASKED_MODEL_ID,
    title,
    messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 100000) })),
  );

  const conv = getConversation(convId, userId);
  return NextResponse.json(conv && !admin ? { ...conv, model: MASKED_MODEL_ID } : conv);
}
