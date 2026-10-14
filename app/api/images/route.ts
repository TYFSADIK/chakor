import { NextResponse } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import {
  readImageGenSettings,
  isImageGenAllowed,
  imageGenRemaining,
  IMAGE_GEN_DAILY_LIMIT,
} from '@/lib/image-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/images — what the composer needs to decide whether to show the
// "Create image" pill: is the feature on, is THIS user allowed, and how much
// of today's allowance is left. Deliberately cheap: no engine probe (the
// generate endpoint does that when it matters).
export async function GET() {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return authd;
  const { session, userId } = authd;

  const settings = readImageGenSettings();
  const isAdmin = isAdminSession(session);
  const allowed = isImageGenAllowed(userId, isAdmin);
  const remaining = allowed ? imageGenRemaining(userId, isAdmin) : 0;
  return NextResponse.json({
    enabled: settings.enabled,
    allowed,
    dailyLimit: IMAGE_GEN_DAILY_LIMIT,
    unlimited: remaining === Number.POSITIVE_INFINITY,
    remaining: remaining === Number.POSITIVE_INFINITY ? IMAGE_GEN_DAILY_LIMIT : remaining,
  });
}
