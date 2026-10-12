import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { getDocument, deleteDocument } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id || isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const doc = getDocument(id, userId);
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  deleteDocument(id, userId);
  return NextResponse.json({ ok: true });
}
