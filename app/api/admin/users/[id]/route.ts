import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, updatePassword } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Session } from 'next-auth';

function requireAdmin(session: Session | null) {
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(session.user as unknown as { isAdmin?: boolean }).isAdmin)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const selfId = (session!.user as unknown as { id: number }).id;
  const { id } = await params;
  const targetId = Number(id);

  if (targetId === selfId) {
    return NextResponse.json({ error: 'cannot delete your own account' }, { status: 400 });
  }

  db().prepare('DELETE FROM users WHERE id = ?').run(targetId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  const deny = requireAdmin(session);
  if (deny) return deny;

  const selfId = (session!.user as unknown as { id: number }).id;
  const { id } = await params;
  const targetId = Number(id);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (body.action !== undefined) {
    // Only known actions may run — anything else is a client bug or probe.
    if (body.action !== 'reset_password') {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
    const tempPassword = randomBytes(6).toString('hex'); // 12-char hex
    const hash = await bcrypt.hash(tempPassword, 12);
    updatePassword(targetId, hash);
    return NextResponse.json({ ok: true, tempPassword });
  }

  if (body.is_admin !== undefined) {
    // Coerce strictly to 0|1; reject anything else instead of storing it raw.
    const isAdmin = body.is_admin === 1 || body.is_admin === true ? 1
      : body.is_admin === 0 || body.is_admin === false ? 0
      : null;
    if (isAdmin === null) {
      return NextResponse.json({ error: 'is_admin must be 0 or 1' }, { status: 400 });
    }
    // Prevent self-demotion if last admin
    if (targetId === selfId && isAdmin === 0) {
      const adminCount = (
        db().prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get() as { c: number }
      ).c;
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'cannot demote the last admin' }, { status: 400 });
      }
    }
    db().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin, targetId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
