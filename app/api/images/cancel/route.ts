/**
 * POST /api/images/cancel — stop the in-flight image generation for one
 * conversation. This is the ONLY way a generation is cancelled: a client
 * disconnect deliberately does not (a full-quality image can take ~30
 * minutes and people refresh), so the stop button calls this endpoint in
 * addition to dropping its stream.
 *
 * The conversation owner (or an admin) may cancel. The sd-server job keeps
 * its terminal 'cancelled' status, which the generate route's poll loop
 * turns into a persisted "_Image generation cancelled._" reply.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import { getConversation } from '@/lib/db';
import { getActiveImageJob } from '@/lib/image-gen';
import { cancelJob } from '@/lib/sd-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authd = await requireUser();
  if (authd instanceof Response) return authd;
  const { session, userId } = authd;

  const body = await req.json().catch(() => null);
  const convId = typeof body?.conversationId === 'string' ? body.conversationId : '';
  if (!convId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
  }

  if (!getConversation(convId, userId) && !isAdminSession(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const job = getActiveImageJob(convId);
  if (!job) {
    return NextResponse.json({ error: 'no image is being generated in this conversation' }, { status: 404 });
  }

  await cancelJob(job.jobId);
  return NextResponse.json({ ok: true });
}
