import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the DB at a throwaway file BEFORE importing lib/db (path is read at module load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-test-'));
process.env.CHAKOR_DB_PATH = path.join(tmp, 'test.db');

const dbm = await import('@/lib/db');

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('users (regression: first-user admin race)', () => {
  let firstId: number;
  it('first user becomes admin, second does not', () => {
    firstId = dbm.createUser('alice', 'hash1');
    const secondId = dbm.createUser('bob', 'hash2');
    expect(dbm.getUserById(firstId)!.is_admin).toBe(1);
    expect(dbm.getUserById(secondId)!.is_admin).toBe(0);
  });
  it('username uniqueness is enforced', () => {
    expect(() => dbm.createUser('alice', 'hash3')).toThrow(/UNIQUE/);
  });
});

describe('API tokens (regression: plaintext storage)', () => {
  it('stores only the sha256 hash plus a 4-char tail', () => {
    const raw = 'sk-chakor-testtoken1234abcd';
    const key = dbm.createApiKey(1, 'cli', raw);
    expect(key.token).toBe(dbm.hashApiToken(raw));
    expect(key.token).toMatch(/^[0-9a-f]{64}$/);
    expect(key.token_tail).toBe('abcd');
    expect(key.token).not.toBe(raw);
  });
  it('authenticates by raw token, rejects wrong tokens', () => {
    const raw = 'sk-chakor-anothertoken5678wxyz';
    dbm.createApiKey(1, 'cli2', raw);
    expect(dbm.getApiKeyByToken(raw)).toBeDefined();
    expect(dbm.getApiKeyByToken('sk-chakor-wrong')).toBeUndefined();
  });
});

describe('conversations/messages', () => {
  beforeAll(() => {
    dbm.createConversation('c1', 1, 'chakor', 'test');
    for (let i = 1; i <= 5; i++) dbm.addMessage('c1', i % 2 ? 'user' : 'assistant', `msg${i}`);
  });

  it('listMessages returns all without limit', () => {
    expect(dbm.listMessages('c1').map((m) => m.content)).toEqual(['msg1', 'msg2', 'msg3', 'msg4', 'msg5']);
  });

  it('listMessages(limit) returns the NEWEST N in ascending order', () => {
    expect(dbm.listMessages('c1', 3).map((m) => m.content)).toEqual(['msg3', 'msg4', 'msg5']);
  });
});

describe('message sources (persisted research/search sources)', () => {
  it('round-trips sources stored on an assistant message', () => {
    dbm.createConversation('cs1', 1, 'chakor', 'sources');
    dbm.addMessage('cs1', 'user', 'research this');
    const sources = [
      { title: 'Example', url: 'https://example.com/a', snippet: 'a snippet' },
      { title: 'Other', url: 'https://other.example/b' },
    ];
    dbm.addMessage('cs1', 'assistant', 'answer [1]', undefined, sources);
    const msgs = dbm.listMessages('cs1');
    expect(msgs[0].sources).toBeUndefined();
    expect(msgs[1].sources).toEqual(sources);
  });

  it('drops malformed entries instead of breaking the row', () => {
    dbm.createConversation('cs2', 1, 'chakor', 'bad sources');
    dbm.db()
      .prepare('INSERT INTO messages (conversation_id, role, content, sources) VALUES (?, ?, ?, ?)')
      .run('cs2', 'assistant', 'raw', JSON.stringify([{ title: 'ok', url: 'https://ok.example' }, { title: 1 }, 'junk']));
    const msgs = dbm.listMessages('cs2');
    expect(msgs[0].sources).toEqual([{ title: 'ok', url: 'https://ok.example' }]);
  });
});

describe('importConversation (regression: partial import on crash)', () => {
  it('imports atomically', () => {
    dbm.importConversation('imp1', 1, 'chakor', 'imported', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(dbm.listMessages('imp1').map((m) => m.content)).toEqual(['hello', 'hi there']);
  });

  it('rolls back the whole import on failure (no partial conversation)', () => {
    // Duplicate conversation id forces createConversation to throw mid-import.
    expect(() =>
      dbm.importConversation('imp1', 1, 'chakor', 'dupe', [{ role: 'user', content: 'x' }]),
    ).toThrow();
    // The failed import must not have added anything to the existing conversation.
    expect(dbm.listMessages('imp1')).toHaveLength(2);
  });
});
