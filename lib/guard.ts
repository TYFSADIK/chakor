/**
 * Shared auth guard for API routes. A JWT can outlive its user (account
 * deleted, password changed) — lib/auth.ts strips user.id from those stale
 * sessions, and routes that blind-cast session.user.id would then crash or
 * run with an undefined id. requireUser fails closed with a 401 instead.
 */
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from './auth';

export interface AuthedUser {
  session: Session;
  userId: number;
}

export async function requireUser(): Promise<AuthedUser | NextResponse> {
  const session = await auth();
  const id = (session?.user as { id?: unknown } | undefined)?.id;
  if (!session?.user || typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return { session, userId: id };
}

/** True when the session belongs to an admin. Used to gate model management
 * and to decide whether real model names may reach this user. */
export function isAdminSession(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}
