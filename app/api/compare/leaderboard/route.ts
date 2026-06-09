import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { compareLeaderboard } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = (session.user as unknown as { id: number }).id;
  return NextResponse.json(compareLeaderboard(userId));
}
