import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import pkg from '@/package.json';

// Intentionally minimal: this endpoint exists for uptime monitors and the
// Docker HEALTHCHECK, so it stays unauthenticated and leaks no internals,
// no engine details, and no secrets — just "alive?" and "database reachable?".
export const dynamic = 'force-dynamic';

export function GET() {
  let dbStatus: 'up' | 'down' = 'up';
  try {
    db().prepare('SELECT 1').get();
  } catch {
    dbStatus = 'down';
  }

  return NextResponse.json(
    { ok: dbStatus === 'up', db: dbStatus, version: pkg.version },
    { status: dbStatus === 'up' ? 200 : 503 },
  );
}
