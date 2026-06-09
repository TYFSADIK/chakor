import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listTools } from '@/lib/tools';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(listTools());
}
