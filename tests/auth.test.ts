import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fresh DB BEFORE importing lib/auth (which pulls in lib/db; the path is read
// at module load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-auth-'));
process.env.CHAKOR_DB_PATH = path.join(tmp, 'test.db');

// next-auth can't load under vitest (it imports the ESM-only 'next/server'),
// but the staleness helper doesn't touch it — stub the module factory.
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, signIn: async () => ({}), signOut: async () => ({}), auth: async () => null }),
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (cfg: unknown) => cfg }));

const { sessionStaleAfterPasswordChange } = await import('@/lib/auth');
const dbm = await import('@/lib/db');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sessionStaleAfterPasswordChange (JWT issued before a password change is stale)', () => {
  it('stale when token.iat is before the password change', () => {
    expect(sessionStaleAfterPasswordChange({ password_changed_at: 1000 }, 999)).toBe(true);
  });

  it('fresh when token.iat is at or after the password change', () => {
    expect(sessionStaleAfterPasswordChange({ password_changed_at: 1000 }, 1000)).toBe(false);
    expect(sessionStaleAfterPasswordChange({ password_changed_at: 1000 }, 1001)).toBe(false);
  });

  it('never stale when the password was never changed', () => {
    expect(sessionStaleAfterPasswordChange({ password_changed_at: null }, 1)).toBe(false);
    expect(sessionStaleAfterPasswordChange({ password_changed_at: undefined }, 1)).toBe(false);
    expect(sessionStaleAfterPasswordChange(undefined, 1)).toBe(false);
  });

  it('never stale when the token carries no numeric iat', () => {
    expect(sessionStaleAfterPasswordChange({ password_changed_at: 1000 }, undefined)).toBe(false);
    expect(sessionStaleAfterPasswordChange({ password_changed_at: 1000 }, '999')).toBe(false);
  });
});

describe('password_changed_at wiring (lib/db)', () => {
  it('updatePassword stamps password_changed_at, invalidating older tokens', () => {
    const uid = dbm.createUser('pwuser', 'hash1');
    const before = dbm.getUserById(uid)!;
    expect(before.password_changed_at ?? null).toBeNull();
    // No change recorded: a token issued long ago is still fine.
    expect(sessionStaleAfterPasswordChange(before, 1)).toBe(false);

    dbm.updatePassword(uid, 'hash2');
    const after = dbm.getUserById(uid)!;
    expect(typeof after.password_changed_at).toBe('number');
    // A token issued before the change is stale; one issued after is not.
    expect(sessionStaleAfterPasswordChange(after, after.password_changed_at! - 10)).toBe(true);
    expect(sessionStaleAfterPasswordChange(after, after.password_changed_at! + 10)).toBe(false);
  });
});
