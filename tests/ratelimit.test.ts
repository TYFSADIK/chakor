import { describe, it, expect } from 'vitest';
import { rateLimit } from '@/lib/ratelimit';

describe('rateLimit', () => {
  it('allows up to the limit then blocks', () => {
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000)).toBe(true);
    expect(rateLimit(key, 5, 60_000)).toBe(false);
    expect(rateLimit(key, 5, 60_000)).toBe(false);
  });

  it('tracks keys independently', () => {
    const a = `t:${Math.random()}`;
    const b = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(a, 2, 60_000);
    expect(rateLimit(a, 2, 60_000)).toBe(false);
    expect(rateLimit(b, 2, 60_000)).toBe(true);
  });

  it('resets after the window expires', async () => {
    const key = `t:${Math.random()}`;
    expect(rateLimit(key, 1, 50)).toBe(true);
    expect(rateLimit(key, 1, 50)).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimit(key, 1, 50)).toBe(true);
  });
});
