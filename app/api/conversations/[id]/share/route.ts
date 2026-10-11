import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getConversation, setShareSlug } from '@/lib/db';
import { randomBytes } from 'node:crypto';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

  const { id } = await params;
  const conv = getConversation(id, userId);
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 128-bit slug: shared links are public by design, so they must be unguessable.
  const slug = randomBytes(16).toString('hex');
  setShareSlug(id, slug);

  return NextResponse.json({ slug });
}
