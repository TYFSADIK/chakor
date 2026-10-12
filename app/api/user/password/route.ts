import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { getUserById, updatePassword } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const { currentPassword, newPassword } = body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return NextResponse.json(
      { error: 'currentPassword and newPassword (min 8 chars) required' },
      { status: 400 },
    );
  }

  const user = getUserById(userId);
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return NextResponse.json({ error: 'current password is incorrect' }, { status: 403 });

  const hash = await bcrypt.hash(newPassword, 12);
  updatePassword(userId, hash);

  return NextResponse.json({ ok: true });
}
