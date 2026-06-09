import { searxSearch } from './searxng';
import { createMemory } from './db';
import { randomUUID } from 'node:crypto';

/**
 * The tool registry. Each tool is an OpenAI-style function definition plus a
 * `run` that actually does the work on the server. Models that support function
 * calling (see lib/agent.ts) can ask to call these, we run them, and feed the
 * result back so the model can answer with real data.
 *
 * Keep these small and side-effect-light. They run with the server's network
 * access, so treat anything the model passes in as untrusted.
 */
/** Per-request context handed to tools that need to know who is asking. */
export interface ToolContext { userId?: number }

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<string>;
}

// Block obvious internal targets so a model cannot use fetch_url to poke at the
// host's own network. Set TOOLS_ALLOW_PRIVATE=true to turn this off.
function isBlockedHost(hostname: string): boolean {
  if (process.env.TOOLS_ALLOW_PRIVATE === 'true') return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export const TOOLS: Record<string, ToolSpec> = {
  web_search: {
    name: 'web_search',
    description: 'Search the web and get back a list of result titles, URLs and snippets. Use for current events or facts you are unsure about.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
    run: async (args) => {
      const query = String(args.query ?? '').trim();
      if (!query) return 'No query provided.';
      const results = await searxSearch(query, 6).catch(() => []);
      if (!results.length) return 'No results found.';
      return results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.content ?? '').slice(0, 300)}`)
        .join('\n\n');
    },
  },

  fetch_url: {
    name: 'fetch_url',
    description: 'Fetch a single web page and return its readable text content. Use after web_search to read a specific result.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The full http(s) URL to fetch' } },
      required: ['url'],
    },
    run: async (args) => {
      const raw = String(args.url ?? '').trim();
      let u: URL;
      try { u = new URL(raw); } catch { return 'Invalid URL.'; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https URLs are allowed.';
      if (isBlockedHost(u.hostname)) return 'That host is not allowed.';
      try {
        const res = await fetch(u.toString(), {
          headers: { 'User-Agent': 'ChakorBot/1.0' },
          signal: AbortSignal.timeout(12_000),
          redirect: 'follow',
        });
        if (!res.ok) return `Fetch failed: HTTP ${res.status}`;
        const ctype = res.headers.get('content-type') ?? '';
        const body = await res.text();
        const text = ctype.includes('html') ? stripHtml(body) : body;
        return text.slice(0, 6000) || '(empty page)';
      } catch (e) {
        return `Could not fetch the page: ${e instanceof Error ? e.message : 'error'}`;
      }
    },
  },

  calculator: {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression (+, -, *, /, parentheses, decimals, exponent with **).',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'e.g. (1200 * 1.08) / 12' } },
      required: ['expression'],
    },
    run: async (args) => {
      const expr = String(args.expression ?? '').trim();
      // Restrict to arithmetic characters only, then evaluate. The charset guard
      // is what keeps this from running arbitrary code.
      if (!expr || !/^[-+*/().\d\s eE]+$/.test(expr.replace(/\*\*/g, ''))) {
        return 'Only basic arithmetic is supported.';
      }
      try {
        // eslint-disable-next-line no-new-func
        const val = Function(`"use strict"; return (${expr});`)();
        if (typeof val !== 'number' || !isFinite(val)) return 'Could not evaluate that expression.';
        return String(val);
      } catch {
        return 'Could not evaluate that expression.';
      }
    },
  },

  current_time: {
    name: 'current_time',
    description: 'Get the current date and time on the server.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const now = new Date();
      return `${now.toISOString()} (server local: ${now.toString()})`;
    },
  },

  save_memory: {
    name: 'save_memory',
    description: 'Remember a durable fact about the user for future conversations (name, role, preferences, ongoing projects). Use for stable facts, not one-off details.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string', description: 'The fact to remember, one short sentence.' } },
      required: ['content'],
    },
    run: async (args, ctx) => {
      const content = String(args.content ?? '').trim();
      if (!content) return 'Nothing to save.';
      if (!ctx?.userId) return 'No user context, cannot save.';
      createMemory(randomUUID(), ctx.userId, content, 'assistant');
      return `Saved to memory: ${content}`;
    },
  },
};

/** OpenAI-format tool definitions for the given enabled tool ids. */
export function toolDefs(ids: string[]) {
  return ids
    .filter((id) => TOOLS[id])
    .map((id) => ({
      type: 'function' as const,
      function: { name: TOOLS[id].name, description: TOOLS[id].description, parameters: TOOLS[id].parameters },
    }));
}

/** Lightweight list for the UI drawer. */
export function listTools() {
  return Object.values(TOOLS).map((t) => ({ name: t.name, description: t.description }));
}
