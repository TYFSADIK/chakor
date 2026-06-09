import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getNote, updateNote, deleteNote, type NoteItem } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

function cleanItems(raw: unknown): NoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is { text?: unknown; done?: unknown } => !!it && typeof it === 'object')
    .map((it) => ({ text: String(it.text ?? '').slice(0, 500), done: !!it.done }));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  if (!getNote(id, userId)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const fields: Parameters<typeof updateNote>[2] = {};
  if (typeof body.title === 'string') fields.title = body.title.slice(0, 200);
  if (typeof body.body === 'string') fields.body = body.body.slice(0, 20000);
  if (typeof body.color === 'string' || body.color === null) fields.color = body.color;
  if (typeof body.pinned === 'boolean') fields.pinned = body.pinned;
  if (typeof body.archived === 'boolean') fields.archived = body.archived;
  if (Array.isArray(body.items)) fields.items = cleanItems(body.items);

  updateNote(id, userId, fields);
  return NextResponse.json(getNote(id, userId));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  deleteNote(id, userId);
  return NextResponse.json({ ok: true });
}
