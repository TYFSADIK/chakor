const SEARXNG_URL = process.env.SEARXNG_URL || 'http://127.0.0.1:8080';
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

// ── SearXNG ──────────────────────────────────────────────────────────────────

async function searxngSearch(query: string, limit: number): Promise<SearchResult[]> {
  const url = new URL('/search', SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('safesearch', '0');
  url.searchParams.set('language', 'en');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Chakor/2.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`SearXNG ${res.status}`);

  const data = await res.json();
  return ((data.results || []) as Array<{ title?: string; url?: string; content?: string; publishedDate?: string }>)
    .slice(0, limit)
    .map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.content || '').slice(0, 300),
      publishedDate: r.publishedDate,
    }));
}

// ── Brave Search ─────────────────────────────────────────────────────────────

async function braveSearch(query: string, limit: number): Promise<SearchResult[]> {
  if (!BRAVE_API_KEY) throw new Error('no Brave key');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(limit, 20)));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`Brave ${res.status}`);

  const data = await res.json();
  return ((data.web?.results || []) as Array<{ title?: string; url?: string; description?: string; page_age?: string }>)
    .slice(0, limit)
    .map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.description || '').slice(0, 300),
      publishedDate: r.page_age,
    }));
}

// ── DuckDuckGo HTML fallback ──────────────────────────────────────────────────

async function duckduckgoSearch(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`DDG ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];

  // Parse result blocks: <div class="result__body"> ... </div>
  const blockRe = /<div[^>]+class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < limit) {
    const block = match[1];
    const titleMatch = titleRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // DDG uses redirect URLs — extract real URL from uddg param
    let finalUrl = rawUrl;
    try {
      const u = new URL(rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl);
      finalUrl = u.searchParams.get('uddg') ?? rawUrl;
    } catch { /* keep rawUrl */ }

    if (finalUrl && title) {
      results.push({ title, url: finalUrl, content: snippet.slice(0, 300) });
    }
  }

  return results;
}

// ── Public API: tries providers in priority order ─────────────────────────────

export async function searxSearch(query: string, limit = 10): Promise<SearchResult[]> {
  // 1. SearXNG
  try {
    const results = await searxngSearch(query, limit);
    if (results.length > 0) return results;
  } catch { /* fall through */ }

  // 2. Brave (if key is set)
  if (BRAVE_API_KEY) {
    try {
      const results = await braveSearch(query, limit);
      if (results.length > 0) return results;
    } catch { /* fall through */ }
  }

  // 3. DuckDuckGo HTML scrape
  try {
    return await duckduckgoSearch(query, limit);
  } catch {
    return [];
  }
}

export function formatSearchContext(query: string, results: SearchResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`,
  );
  return (
    `Web search results for: "${query}"\n` +
    `─────────────────────────────────\n` +
    lines.join('\n\n') +
    `\n─────────────────────────────────\n` +
    `Use these results to inform your answer. Cite sources by [number] when relevant.\n\n`
  );
}
