import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { listGgufFiles, sanitizeRepo } from '@/lib/huggingface';
import { detectHardware } from '@/lib/hardware';
import { fitModel } from '@/lib/hwfit';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

// GET /api/models/hf/files?repo=org/name — list the GGUF files in a repo, each
// tagged with how well it fits this machine so you don't download one that
// can't run here.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const repo = sanitizeRepo(req.nextUrl.searchParams.get('repo') ?? '');
  if (!repo) return NextResponse.json({ error: 'A valid org/name repo is required.' }, { status: 400 });

  try {
    const [files, hw] = await Promise.all([listGgufFiles(repo), detectHardware()]);
    const withFit = files.map((f) => ({ ...f, fit: fitModel(f.size, hw) }));
    return NextResponse.json({ repo, files: withFit });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read repo files.' }, { status: 502 });
  }
}
