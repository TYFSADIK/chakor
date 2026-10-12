import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chakor-dl-'));

const { verifyFileIntegrity, IntegrityError } = await import('@/lib/download-manager');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function writeFile(name: string, content: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('verifyFileIntegrity (post-download size/sha256 check)', () => {
  it('passes when the size matches', async () => {
    const p = writeFile('ok.gguf', 'hello world');
    await expect(verifyFileIntegrity(p, 'ok.gguf', { size: 11, sha256: null })).resolves.toBeUndefined();
    expect(fs.existsSync(p)).toBe(true);
  });

  it('fails and deletes the file when the size is wrong', async () => {
    const p = writeFile('short.gguf', 'hello');
    await expect(verifyFileIntegrity(p, 'short.gguf', { size: 11, sha256: null }))
      .rejects.toBeInstanceOf(IntegrityError);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('skips the size check when the repo gave no size (size 0)', async () => {
    const p = writeFile('unknown-size.gguf', 'anything at all');
    await expect(verifyFileIntegrity(p, 'unknown-size.gguf', { size: 0, sha256: null })).resolves.toBeUndefined();
    expect(fs.existsSync(p)).toBe(true);
  });

  it('passes when the sha256 matches (case-insensitive)', async () => {
    const p = writeFile('hash-ok.gguf', 'model bytes');
    await expect(
      verifyFileIntegrity(p, 'hash-ok.gguf', { size: 11, sha256: sha256('model bytes').toUpperCase() }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(p)).toBe(true);
  });

  it('fails and deletes the file when the sha256 is wrong', async () => {
    const p = writeFile('hash-bad.gguf', 'model bytes');
    await expect(verifyFileIntegrity(p, 'hash-bad.gguf', { size: 11, sha256: sha256('different bytes') }))
      .rejects.toThrow(/sha256 mismatch/);
    expect(fs.existsSync(p)).toBe(false);
  });
});
