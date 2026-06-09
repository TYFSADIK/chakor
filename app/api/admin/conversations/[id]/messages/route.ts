import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Session } from 'next-auth';

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const { id } = await params;
  const messages = db().prepare(`
    SELECT id, role, content, created_at FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(id);

  return NextResponse.json(messages);
}
