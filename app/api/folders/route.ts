import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { listFolders, createFolder } from '@/lib/db';

export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  return NextResponse.json(listFolders(authd.userId));
}

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { userId } = authd;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  return NextResponse.json(createFolder(userId, name.slice(0, 60)));
}
