import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { deleteApiKey } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  deleteApiKey(numId, userId);
  return NextResponse.json({ ok: true });
}
