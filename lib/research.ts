import { searxSearch, type SearchResult } from './searxng';
import { fetchPageText } from './safe-fetch';
import { llamaEndpoint, type ModelConfig } from './models';
import { agentEndpoint } from './agent';
import { logger, errText } from './logger';

/**
 * Deep research pipeline: plan angles -> search them all -> read the strongest
 * pages in full -> hand the model real source text instead of 300-char
 * snippets. Every step is best-effort; if planning or page reads fail, the
 * pipeline degrades to plain multi-query search instead of dying.
 */

export interface ResearchSource { title: string; url: string; snippet?: string }
export interface ResearchStep { name: string; args: string; result: string }
export interface ResearchResult {
  sources: ResearchSource[];
  /** Formatted context block to prepend to the user's message. '' if nothing found. */
  context: string;
}

// Caps chosen so the injected context fits small local context windows with
// room left for the system prompt, history, and the reply.
const PLAN_TIMEOUT_MS = 10_000;
const RESULTS_PER_QUERY = 10;
const MAX_SOURCES = 24;
const PAGES_TO_READ = 6;
const PAGE_CHARS = 4000;
const SNIPPET_CHARS = 350;
const TOTAL_CONTEXT_CHARS = 24_000;

/** One non-streaming completion against whatever model is selected. '' on failure. */
async function chatOnce(model: ModelConfig, prompt: string, maxTokens: number): Promise<string> {
  // Prefer the selected model (cloud models plan better); fall back to the
  // local server, which is always there in a default install.
  const cfg = agentEndpoint(model) ?? (() => {
    const e = llamaEndpoint();
    return { url: `${e.url}/v1/chat/completions`, headers: { 'Content-Type': 'application/json' }, model: e.label };
  })();
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    });
    if (!res.ok) return '';
    const json = await res.json();
    return typeof json.choices?.[0]?.message?.content === 'string' ? json.choices[0].message.content : '';
  } catch (e) {
    logger.warn('research planning request failed', { err: errText(e) });
    return '';
  }
}

/**
 * Ask the model for distinct search angles on the question. Always returns at
 * least the original question, with planned queries appended when planning works.
 */
export async function planQueries(question: string, model: ModelConfig): Promise<string[]> {
  const out = await chatOnce(
    model,
    `You are planning web research for this question:\n"${question.slice(0, 400)}"\n\n` +
    `Write 4 distinct, specific search queries that together cover the most important angles ` +
    `(definitions, current state, evidence and data, comparisons, criticism or counterpoints). ` +
    `Return ONLY the queries, one per line, no numbering, no quotes.`,
    160,
  );
  const extra = out
    .trim()
    .split('\n')
    .map((q) => q.replace(/^[-*\d.)\s"']+/, '').trim())
    .filter((q) => q.length > 3 && q.length < 200)
    .filter((q) => q.toLowerCase() !== question.trim().toLowerCase())
    .slice(0, 4);
  return [question, ...extra];
}

/**
 * Rank deduped results: sources that show up for several independent queries
 * rise to the top (consensus across angles), ties broken by best position.
 */
export function rankResults(resultsArrays: SearchResult[][]): SearchResult[] {
  const stats = new Map<string, { r: SearchResult; hits: number; best: number }>();
  resultsArrays.forEach((arr) => {
    arr.forEach((r, pos) => {
      if (!r.url) return;
      const s = stats.get(r.url);
      if (s) { s.hits += 1; s.best = Math.min(s.best, pos); }
      else stats.set(r.url, { r, hits: 1, best: pos });
    });
  });
  return [...stats.values()]
    .sort((a, b) => b.hits - a.hits || a.best - b.best)
    .map((s) => s.r);
}

/** Build the numbered context block, using full page text where we read it. */
export function buildResearchContext(
  question: string,
  sources: SearchResult[],
  pages: Map<string, string>,
): string {
  const blocks: string[] = [];
  let used = 0;
  for (let i = 0; i < sources.length; i++) {
    const r = sources[i];
    const page = pages.get(r.url);
    const body = page && page.length > 200 ? page.slice(0, PAGE_CHARS) : (r.content || '').slice(0, SNIPPET_CHARS);
    const block = `[${i + 1}] ${r.title}\n${r.url}\n${body}`;
    if (used + block.length > TOTAL_CONTEXT_CHARS && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
  }
  if (blocks.length === 0) return '';
  return (
    `Deep research results for: "${question}"\n` +
    `${pages.size > 0 ? `Sources marked with full text were read in full; the rest are search snippets.\n` : ''}` +
    `─────────────────────────────────\n` +
    blocks.join('\n\n') +
    `\n─────────────────────────────────\n` +
    `Write a research briefing grounded in these sources. Cite every non-obvious claim by [number].\n\n`
  );
}

export async function runDeepResearch(
  question: string,
  opts: { model: ModelConfig; onStep?: (s: ResearchStep) => void },
): Promise<ResearchResult> {
  const step = (name: string, args: string, result: string) =>
    opts.onStep?.({ name, args, result: result.slice(0, 1500) });

  // 1. Plan angles.
  const queries = await planQueries(question, opts.model);
  step('research_plan', question.slice(0, 120), `Searching ${queries.length} angles:\n${queries.map((q) => `- ${q}`).join('\n')}`);

  // 2. Search every angle in parallel; individual failures just yield [].
  const resultsArrays = await Promise.all(
    queries.map((q) => searxSearch(q, RESULTS_PER_QUERY).catch(() => [] as SearchResult[])),
  );
  const ranked = rankResults(resultsArrays);
  if (ranked.length === 0) return { sources: [], context: '' };
  step('web_search', queries.join(' | '), `Found ${ranked.length} unique sources across ${queries.length} queries.`);

  // 3. Read the strongest pages in full so the model synthesizes from real
  // text, not snippets. Best-effort per page, parallel.
  const top = ranked.slice(0, MAX_SOURCES);
  const toRead = top.slice(0, PAGES_TO_READ);
  const pageTexts = await Promise.all(toRead.map((r) => fetchPageText(r.url, PAGE_CHARS).catch(() => '')));
  const pages = new Map<string, string>();
  pageTexts.forEach((text, i) => {
    // Only keep pages that actually yielded readable content, not error strings.
    if (text && text.length > 200 && !/^(Invalid URL|Only http|That host|Too many redirects|Fetch failed|Could not fetch)/.test(text)) {
      pages.set(toRead[i].url, text);
    }
  });
  if (pages.size > 0) {
    step('read_pages', `${pages.size} pages`, [...pages.keys()].join('\n'));
  }

  return {
    sources: top.map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
    context: buildResearchContext(question, top, pages),
  };
}
