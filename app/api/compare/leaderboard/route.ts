import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { compareLeaderboard } from '@/lib/db';

export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  return NextResponse.json(compareLeaderboard(authd.userId));
}
