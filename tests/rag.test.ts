import { describe, it, expect } from 'vitest';
import { chunkText, bm25Search, formatRagContext } from '@/lib/rag';

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps short text as one chunk', () => {
    const out = chunkText('A single short paragraph of useful content.');
    expect(out).toHaveLength(1);
  });

  it('splits long text into bounded chunks', () => {
    const para = 'word '.repeat(80).trim(); // ~400 chars
    const text = Array.from({ length: 8 }, () => para).join('\n\n');
    const out = chunkText(text);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(900);
  });
});

describe('bm25Search', () => {
  const chunks = [
    { id: 1, document_id: 1, filename: 'gpu.txt', content: 'The graphics card has 24 gigabytes of video memory and tensor cores.' },
    { id: 2, document_id: 1, filename: 'cpu.txt', content: 'The processor has sixteen cores and supports vector instructions.' },
    { id: 3, document_id: 2, filename: 'recipe.txt', content: 'Bake the bread at two hundred degrees for forty minutes.' },
  ];

  it('ranks the relevant chunk first', () => {
    const out = bm25Search('how much video memory does the graphics card have', chunks);
    expect(out[0]?.id).toBe(1);
  });

  it('returns [] for no matches or empty corpus', () => {
    expect(bm25Search('antidisestablishmentarianism', chunks)).toEqual([]);
    expect(bm25Search('graphics', [])).toEqual([]);
  });

  it('respects the limit', () => {
    const out = bm25Search('the', chunks, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe('formatRagContext', () => {
  it('groups chunks by filename and wraps them in markers', () => {
    const ctx = formatRagContext([
      { id: 1, document_id: 1, filename: 'a.txt', content: 'alpha', score: 1 },
      { id: 2, document_id: 1, filename: 'a.txt', content: 'beta', score: 0.9 },
    ]);
    expect(ctx).toContain('=== DOCUMENT CONTEXT ===');
    expect(ctx).toContain('[Source: a.txt]');
    expect(ctx).toContain('alpha');
    expect(ctx).toContain('beta');
  });
  it('returns empty string for no chunks', () => {
    expect(formatRagContext([])).toBe('');
  });
});
