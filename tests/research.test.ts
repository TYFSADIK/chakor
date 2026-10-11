import { describe, it, expect } from 'vitest';
import { trimToContext, contextBudget, estimateTokens } from '@/lib/dispatch';
import { rankResults, buildResearchContext } from '@/lib/research';

describe('contextBudget', () => {
  it('prefers the explicit UI choice', () => {
    expect(contextBudget(4096, { contextWindow: 128000 })).toBe(4096);
  });
  it('falls back to the model window, then to the default', () => {
    expect(contextBudget(undefined, { contextWindow: 32768 })).toBe(32768);
    expect(contextBudget(undefined, { contextWindow: 0 })).toBe(8192);
    expect(contextBudget(0, { contextWindow: 0 })).toBe(8192);
  });
});

describe('trimToContext', () => {
  const sys = { role: 'system' as const, content: 'sys '.repeat(50) };
  const turn = (n: number) => ({ role: 'user' as const, content: `m${n} ` + 'x'.repeat(400) });

  it('always trims, even without an explicit size (regression: untrimmed overflow)', () => {
    // 1000 messages x ~100 tokens each >> 8192 default
    const msgs = [sys, ...Array.from({ length: 1000 }, (_, i) => turn(i))];
    const out = trimToContext(msgs, undefined);
    expect(out.length).toBeLessThan(msgs.length);
    expect(out[0].role).toBe('system');
  });

  it('keeps the newest turns and drops the oldest', () => {
    const msgs = [sys, ...Array.from({ length: 200 }, (_, i) => turn(i))];
    const out = trimToContext(msgs, 4096);
    const last = out[out.length - 1];
    expect(typeof last.content === 'string' && last.content.startsWith('m199')).toBe(true);
  });

  it('always keeps the most recent message even when over budget', () => {
    const huge = { role: 'user' as const, content: 'y'.repeat(100_000) };
    const out = trimToContext([sys, huge], 1024);
    expect(out).toHaveLength(2);
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token and charges for images', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(
      estimateTokens([
        { type: 'text', text: 'a'.repeat(40) },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
      ]),
    ).toBe(10 + 512);
  });
});

describe('rankResults', () => {
  const r = (url: string) => ({ title: url, url, content: '' });

  it('ranks sources found by multiple queries first (consensus)', () => {
    const out = rankResults([
      [r('a'), r('b'), r('c')],
      [r('b'), r('d')],
      [r('b'), r('e')],
    ]);
    expect(out[0].url).toBe('b');
  });

  it('dedupes and breaks ties by best position', () => {
    const out = rankResults([[r('a'), r('b')], [r('c'), r('a')]]);
    const urls = out.map((x) => x.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toBe('a'); // hits:2 beats c's hits:1... a appears twice
  });
});

describe('buildResearchContext', () => {
  const src = (n: number) => ({ title: `t${n}`, url: `https://x/${n}`, content: `snippet ${n}` });

  it('numbers sources and includes the question', () => {
    const ctx = buildResearchContext('why is the sky blue', [src(1), src(2)], new Map());
    expect(ctx).toContain('"why is the sky blue"');
    expect(ctx).toContain('[1] t1');
    expect(ctx).toContain('[2] t2');
    expect(ctx).toContain('Cite every non-obvious claim');
  });

  it('prefers full page text over snippets when a page was read', () => {
    const pages = new Map([['https://x/1', 'full page text '.repeat(50)]]);
    const ctx = buildResearchContext('q', [src(1)], pages);
    expect(ctx).toContain('full page text');
    expect(ctx).not.toContain('snippet 1');
  });

  it('ignores too-short page reads (error strings)', () => {
    const pages = new Map([['https://x/1', 'Fetch failed: HTTP 403']]);
    const ctx = buildResearchContext('q', [src(1)], pages);
    expect(ctx).toContain('snippet 1');
  });

  it('respects the total context cap', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      title: `t${i}`, url: `https://x/${i}`, content: 'z'.repeat(350),
    }));
    const ctx = buildResearchContext('q', many, new Map());
    expect(ctx.length).toBeLessThan(26_000);
  });
});
