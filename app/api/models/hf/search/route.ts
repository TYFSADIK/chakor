import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { Session } from 'next-auth';
import { searchGgufRepos } from '@/lib/huggingface';

function isAdmin(session: Session | null): boolean {
  return !!(session?.user as unknown as { isAdmin?: boolean } | undefined)?.isAdmin;
}

// GET /api/models/hf/search?q=qwen — find GGUF repos on Hugging Face.
// Admin only, since the next step (download) writes to the server's disk.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const repos = await searchGgufRepos(q);
  return NextResponse.json({ repos });
}
