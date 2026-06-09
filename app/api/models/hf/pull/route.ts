import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { sanitizeRepo, sanitizeRepoFile } from '@/lib/huggingface';
import { downloadManager } from '@/lib/download-manager';

export const runtime = 'nodejs';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

/**
 * POST /api/models/hf/pull { repo, file }
 * Start a background download of a GGUF from Hugging Face. Returns a job id right
 * away; the download runs on the server even if the browser closes. Poll
 * /api/models/hf/jobs for progress. Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const repo = sanitizeRepo(String(body?.repo ?? ''));
  const file = sanitizeRepoFile(String(body?.file ?? ''));
  if (!repo || !file) return NextResponse.json({ error: 'A valid repo and .gguf file are required.' }, { status: 400 });

  const { id, error } = await downloadManager.start(repo, file);
  if (error) return NextResponse.json({ error }, { status: 502 });
  return NextResponse.json({ ok: true, jobId: id });
}
