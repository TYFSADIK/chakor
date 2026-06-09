import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listNotes, createNote, getNote, type NoteItem } from '@/lib/db';
import { randomUUID } from 'node:crypto';

function cleanItems(raw: unknown): NoteItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((it): it is { text?: unknown; done?: unknown } => !!it && typeof it === 'object')
    .map((it) => ({ text: String(it.text ?? '').slice(0, 500), done: !!it.done }));
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  return NextResponse.json(listNotes(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const body = await req.json().catch(() => ({}));

  const id = randomUUID();
  createNote(id, userId, {
    title: typeof body?.title === 'string' ? body.title.slice(0, 200) : '',
    body: typeof body?.body === 'string' ? body.body.slice(0, 20000) : '',
    color: typeof body?.color === 'string' ? body.color : null,
    items: cleanItems(body?.items),
  });
  return NextResponse.json(getNote(id, userId));
}
