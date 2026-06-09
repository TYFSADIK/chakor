import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUserById, updatePassword } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;

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
