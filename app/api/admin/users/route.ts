import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Session } from 'next-auth';

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

export async function GET() {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const users = db().prepare(`
    SELECT u.id, u.username, u.email, u.created_at, u.is_admin,
           COUNT(DISTINCT c.id)  AS conv_count,
           COUNT(DISTINCT m.id)  AS msg_count,
           MAX(c.updated_at)     AS last_active
    FROM users u
    LEFT JOIN conversations c ON c.user_id = u.id
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `).all();

  return NextResponse.json(users);
}
