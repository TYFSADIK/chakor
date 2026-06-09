import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDocument, deleteDocument } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!id || isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const doc = getDocument(id, userId);
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  deleteDocument(id, userId);
  return NextResponse.json({ ok: true });
}
