import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { getConversation, setShareSlug, clearShareSlug } from '@/lib/db';
import { randomBytes } from 'node:crypto';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const { id } = await params;
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 128-bit slug: shared links are public by design, so they must be unguessable.
  const slug = randomBytes(16).toString('hex');
  setShareSlug(id, slug);

  return NextResponse.json({ slug });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const { id } = await params;
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  clearShareSlug(id, userId);
  return NextResponse.json({ ok: true });
}
