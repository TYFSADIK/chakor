import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { searxSearch } from '@/lib/searxng';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? '').trim();
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
  const results = await searxSearch(query, 5);
  return NextResponse.json({ results });
}
