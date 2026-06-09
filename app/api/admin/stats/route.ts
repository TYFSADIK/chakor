import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, dailyMessageStats } from '@/lib/db';
import fs from 'node:fs';
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

  const d = db();
  const users = (d.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  const conversations = (d.prepare('SELECT COUNT(*) AS c FROM conversations').get() as { c: number }).c;
  const messages = (d.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  const documents = (d.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c;

  const dbPath = process.env.CHAKOR_DB_PATH || './data/chakor.db';
  let dbBytes = 0;
  try { dbBytes = fs.statSync(dbPath).size; } catch {}

  const topUsers = d.prepare(`
    SELECT u.username, u.is_admin,
           COUNT(DISTINCT c.id) AS conv_count,
           COUNT(DISTINCT m.id) AS msg_count
    FROM users u
    LEFT JOIN conversations c ON c.user_id = u.id
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY u.id
    ORDER BY msg_count DESC
    LIMIT 10
  `).all();

  const dailyStats = dailyMessageStats();

  return NextResponse.json({ users, conversations, messages, documents, dbBytes, topUsers, dailyStats });
}
