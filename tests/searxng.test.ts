import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { searxSearch } from '@/lib/searxng';

// The search chain: SearXNG → Brave API (when BRAVE_SEARCH_API_KEY is set) →
// DuckDuckGo scrape → []. Regression: a self-hosted SearXNG with every
// upstream engine suspended returns {"results": []}, which used to mean the
// user silently got nothing even though a Brave key was configured.

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SEARX_HIT = {
  results: [{ title: 'SearX result', url: 'https://searx.example/1', content: 'from searxng' }],
};

const BRAVE_HIT = {
  web: {
    results: [{ title: 'Brave result', url: 'https://brave.example/1', description: 'from brave', page_age: '2026-10-01' }],
  },
};

function urlOf(input: unknown): string {
  return typeof input === 'string' ? input : String(input);
}

beforeEach(() => {
  vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-brave-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('searxSearch provider chain', () => {
  it('uses SearXNG results when present and never calls Brave', async () => {
    const spy = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes('api.search.brave.com')) throw new Error('Brave should not be called');
      return jsonRes(SEARX_HIT);
    });
    vi.stubGlobal('fetch', spy);

    const results = await searxSearch('q', 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: 'SearX result', url: 'https://searx.example/1', content: 'from searxng' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls back to Brave when SearXNG returns zero results', async () => {
    const spy = vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes('api.search.brave.com')) return jsonRes(BRAVE_HIT);
      return jsonRes({ results: [] }); // SearXNG up, but every engine suspended
    });
    vi.stubGlobal('fetch', spy);

    const results = await searxSearch('q', 5);
    expect(results).toHaveLength(1);
    // Brave's description/page_age map onto the shared SearchResult shape.
    expect(results[0]).toMatchObject({
      title: 'Brave result',
      url: 'https://brave.example/1',
      content: 'from brave',
      publishedDate: '2026-10-01',
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('falls back to Brave when SearXNG fails outright, sending the subscription token', async () => {
    const spy = vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = urlOf(input);
      if (url.includes('api.search.brave.com')) {
        expect(init?.headers?.['X-Subscription-Token']).toBe('test-brave-key');
        return jsonRes(BRAVE_HIT);
      }
      return jsonRes({ error: 'suspended' }, 500);
    });
    vi.stubGlobal('fetch', spy);

    const results = await searxSearch('q', 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Brave result');
  });

  it('falls back to Brave when SearXNG times out / throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes('api.search.brave.com')) return jsonRes(BRAVE_HIT);
      throw new Error('abort: SearXNG timeout');
    }));

    const results = await searxSearch('q', 5);
    expect(results[0]?.url).toBe('https://brave.example/1');
  });

  it('returns [] when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(searxSearch('q', 5)).resolves.toEqual([]);
  });

  it('returns [] when SearXNG is empty and no Brave key is set (DDG scrape finds nothing)', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      // Brave must not be attempted without a key.
      if (url.includes('api.search.brave.com')) throw new Error('Brave called without a key');
      if (url.includes('duckduckgo.com')) return new Response('<html><body>no results</body></html>', { status: 200 });
      return jsonRes({ results: [] });
    }));

    await expect(searxSearch('q', 5)).resolves.toEqual([]);
  });

  it('caps Brave snippets at 300 chars like SearXNG snippets', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = urlOf(input);
      if (url.includes('api.search.brave.com')) {
        return jsonRes({ web: { results: [{ title: 't', url: 'https://x/', description: 'd'.repeat(500) }] } });
      }
      return jsonRes({ results: [] });
    }));

    const results = await searxSearch('q', 5);
    expect(results[0].content).toHaveLength(300);
  });
});
