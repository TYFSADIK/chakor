import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { downloadManager } from '@/lib/download-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

// GET /api/models/hf/jobs — every download job (active + recently finished), so
// the UI can show a downloads tray that survives navigation and reloads.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ jobs: downloadManager.list() });
}

// DELETE /api/models/hf/jobs { id } — cancel a running download, or dismiss a
// finished/failed card from the tray.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'job id required' }, { status: 400 });
  return NextResponse.json({ ok: downloadManager.cancel(id) });
}
