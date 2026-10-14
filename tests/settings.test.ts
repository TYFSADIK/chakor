import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

// Fresh DB BEFORE importing lib/db or the route (path is read at module load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-settings-'));
process.env.CHAKOR_DB_PATH = path.join(tmp, 'test.db');

// Stub the session the guard will see; each test sets it explicitly.
const mockAuth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('@/lib/auth', () => ({ auth: async () => mockAuth.session }));

const dbm = await import('@/lib/db');
const { buildSystemPrompt } = await import('@/lib/system-prompt');
const { GET, PUT } = await import('@/app/api/admin/settings/route');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const ADMIN = { user: { id: 1, name: 'admin', isAdmin: true } };
const MEMBER = { user: { id: 2, name: 'bob', isAdmin: false } };

describe('getSetting/setSetting round-trip', () => {
  it('returns null for a missing key, then round-trips values', () => {
    expect(dbm.getSetting('custom_instructions')).toBeNull();
    dbm.setSetting('custom_instructions', 'Be terse.');
    expect(dbm.getSetting('custom_instructions')).toBe('Be terse.');
    dbm.setSetting('custom_instructions', 'Be verbose.');
    expect(dbm.getSetting('custom_instructions')).toBe('Be verbose.');
  });
});

describe('buildSystemPrompt customInstructions', () => {
  it('is unchanged when no instructions are provided', () => {
    const plain = buildSystemPrompt({ name: 'Chakor', today: '2026-01-01' });
    expect(plain).not.toContain('Instructions from the administrator');
    expect(buildSystemPrompt({ name: 'Chakor', today: '2026-01-01', customInstructions: '' })).toBe(plain);
    expect(buildSystemPrompt({ name: 'Chakor', today: '2026-01-01', customInstructions: '   ' })).toBe(plain);
  });

  it('appends an administrator section before the closing identity line', () => {
    const p = buildSystemPrompt({ name: 'Chakor', today: '2026-01-01', customInstructions: 'Always answer in French.' });
    expect(p).toContain('## Instructions from the administrator');
    expect(p).toContain('Always answer in French.');
    const sectionIdx = p.indexOf('## Instructions from the administrator');
    const identityIdx = p.indexOf("If asked who you are, you're Chakor.");
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeGreaterThan(sectionIdx);
  });
});

describe('admin settings route', () => {
  it('rejects unauthenticated requests with 401', async () => {
    mockAuth.session = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT(req({ customInstructions: 'x' }))).status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    mockAuth.session = MEMBER;
    expect((await GET()).status).toBe(403);
    expect((await PUT(req({ customInstructions: 'x' }))).status).toBe(403);
  });

  it('lets an admin save and read back instructions', async () => {
    mockAuth.session = ADMIN;
    const put = await PUT(req({ customInstructions: '  Keep it short.  ' }));
    expect(put.status).toBe(200);
    expect((await put.json()).customInstructions).toBe('Keep it short.');

    const get = await GET();
    expect(get.status).toBe(200);
    expect((await get.json()).customInstructions).toBe('Keep it short.');
  });

  it('rejects instructions over 4000 chars and non-string values', async () => {
    mockAuth.session = ADMIN;
    expect((await PUT(req({ customInstructions: 'a'.repeat(4001) }))).status).toBe(400);
    expect((await PUT(req({ customInstructions: 42 }))).status).toBe(400);
  });

  it('rejects unknown setting keys', async () => {
    mockAuth.session = ADMIN;
    const r = await PUT(req({ customInstructions: 'ok', evil_key: 'nope' }));
    expect(r.status).toBe(400);
  });
});
