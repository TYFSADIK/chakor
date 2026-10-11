import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createUser, getUserByUsername, db } from '@/lib/db';
import { rateLimit } from '@/lib/ratelimit';

const schema = z.object({
  username: z
    .string()
    .min(3, 'username must be at least 3 characters')
    .max(32, 'username too long')
    .regex(/^[a-z0-9_.-]+$/, 'username may only contain a-z 0-9 _ . -'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  email: z.string().email('invalid email').optional().or(z.literal('')),
  invite: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // Per-IP throttle on account creation (depends on the reverse proxy setting
  // x-forwarded-for; falls back to a shared 'local' bucket).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!rateLimit(`register:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'too many attempts, try again later' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { username, password, email, invite } = parsed.data;
  const mode = process.env.REGISTRATION_MODE || 'closed';
  const isFirstUser =
    (db().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c === 0;

  if (!isFirstUser && mode === 'closed') {
    return NextResponse.json({ error: 'registration is closed' }, { status: 403 });
  }

  // Invite mode is enforced server-side — the UI field alone is not a gate.
  if (!isFirstUser && mode === 'invite') {
    const expected = process.env.INVITE_CODE || '';
    if (!expected || invite !== expected) {
      return NextResponse.json({ error: 'invalid invite code' }, { status: 403 });
    }
  }

  if (getUserByUsername(username)) {
    return NextResponse.json({ error: 'username already taken' }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    createUser(username, hash, email || undefined);
  } catch (e) {
    // Concurrent registration with the same username: the pre-check above passed
    // for both requests, and the UNIQUE constraint rejects the loser.
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'username already taken' }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
