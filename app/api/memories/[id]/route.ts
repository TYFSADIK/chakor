import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateMemory, deleteMemory } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const fields: Parameters<typeof updateMemory>[2] = {};
  if (typeof body.content === 'string') fields.content = body.content;
  if (typeof body.pinned === 'boolean') fields.pinned = body.pinned;
  updateMemory(id, userId, fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  const { id } = await params;
  deleteMemory(id, userId);
  return NextResponse.json({ ok: true });
}
