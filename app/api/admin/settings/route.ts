import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAdminSession } from '@/lib/guard';
import { getSetting, setSetting } from '@/lib/db';

// Server-wide settings editable from the admin panel. The whitelist keeps
// this route from becoming a generic key/value store by accident.
const EDITABLE_SETTINGS = {
  customInstructions: 'custom_instructions',
} as const;

const MAX_INSTRUCTIONS_CHARS = 4000;

async function requireAdmin(): Promise<{ error: NextResponse } | null> {
  const authd = await requireUser();
  if (authd instanceof NextResponse) return { error: authd };
  if (!isAdminSession(authd.session)) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return null;
}

export async function GET() {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  return NextResponse.json({
    customInstructions: getSetting(EDITABLE_SETTINGS.customInstructions) ?? '',
  });
}

export async function PUT(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  // Only whitelisted keys are accepted.
  const unknownKeys = Object.keys(body).filter((k) => !(k in EDITABLE_SETTINGS));
  if (unknownKeys.length) {
    return NextResponse.json({ error: `unknown setting: ${unknownKeys.join(', ')}` }, { status: 400 });
  }

  const raw = (body as { customInstructions?: unknown }).customInstructions;
  if (typeof raw !== 'string') {
    return NextResponse.json({ error: 'customInstructions must be a string' }, { status: 400 });
  }
  const value = raw.trim();
  if (value.length > MAX_INSTRUCTIONS_CHARS) {
    return NextResponse.json({ error: `customInstructions too long (max ${MAX_INSTRUCTIONS_CHARS} chars)` }, { status: 400 });
  }

  setSetting(EDITABLE_SETTINGS.customInstructions, value);
  return NextResponse.json({ customInstructions: value });
}
