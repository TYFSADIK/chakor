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
           (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conv_count,
           (SELECT COUNT(*) FROM messages m JOIN conversations c ON m.conversation_id = c.id
            WHERE c.user_id = u.id) AS msg_count,
           (SELECT MAX(updated_at) FROM conversations c WHERE c.user_id = u.id) AS last_active
    FROM users u
    ORDER BY u.created_at ASC
  `).all();

  return NextResponse.json(users);
}
