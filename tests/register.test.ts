import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

// Fresh DB + invite mode BEFORE importing the route (module reads env at call time,
// but the DB path is fixed at import).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-reg-'));
process.env.CHAKOR_DB_PATH = path.join(tmp, 'test.db');
process.env.REGISTRATION_MODE = 'invite';
process.env.INVITE_CODE = 'secret-code';

const { POST } = await import('@/app/api/register/route');

function req(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(),
  } as unknown as NextRequest;
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('register route — invite mode enforcement (regression: invite never checked)', () => {
  it('first user registers without an invite (bootstrap admin)', async () => {
    const r = await POST(req({ username: 'admin1', password: 'password123' }));
    expect(r.status).toBe(200);
  });

  it('second user without invite is rejected', async () => {
    const r = await POST(req({ username: 'noinvite', password: 'password123' }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/invite/);
  });

  it('second user with a wrong invite is rejected', async () => {
    const r = await POST(req({ username: 'badinvite', password: 'password123', invite: 'wrong' }));
    expect(r.status).toBe(403);
  });

  it('second user with the correct invite registers', async () => {
    const r = await POST(req({ username: 'invited', password: 'password123', invite: 'secret-code' }));
    expect(r.status).toBe(200);
  });

  it('duplicate username returns 409', async () => {
    const r = await POST(req({ username: 'invited', password: 'password123', invite: 'secret-code' }));
    expect(r.status).toBe(409);
  });

  it('password under 8 chars returns 400', async () => {
    const r = await POST(req({ username: 'shortpw', password: 'short', invite: 'secret-code' }));
    expect(r.status).toBe(400);
  });
});
