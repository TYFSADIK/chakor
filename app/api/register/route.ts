import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createUser, getUserByUsername, db } from '@/lib/db';

const schema = z.object({
  username: z
    .string()
    .min(3, 'username must be at least 3 characters')
    .max(32, 'username too long')
    .regex(/^[a-z0-9_.-]+$/, 'username may only contain a-z 0-9 _ . -'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  email: z.string().email('invalid email').optional().or(z.literal('')),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { username, password, email } = parsed.data;
  const mode = process.env.REGISTRATION_MODE || 'closed';
  const isFirstUser =
    (db().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c === 0;

  if (!isFirstUser && mode === 'closed') {
    return NextResponse.json({ error: 'registration is closed' }, { status: 403 });
  }

  if (getUserByUsername(username)) {
    return NextResponse.json({ error: 'username already taken' }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 12);
  createUser(username, hash, email || undefined);

  return NextResponse.json({ ok: true });
}
