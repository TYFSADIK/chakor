/**
 * SSRF-protected page fetching, shared by the fetch_url tool and the deep
 * research pipeline. Anything a model or a search result hands us is
 * untrusted, so every hop is validated before it is requested.
 */

// Block obvious internal targets so a model cannot use fetching to poke at the
// host's own network. Set TOOLS_ALLOW_PRIVATE=true to turn this off.
export function isBlockedHost(hostname: string): boolean {
  if (process.env.TOOLS_ALLOW_PRIVATE === 'true') return false;
  let h = hostname.toLowerCase();
  // WHATWG URL normalizes decimal/hex/short-form IPv4 (http://2130706433/,
  // http://0x7f000001/, http://127.1/) to dotted-decimal, so the regexes below
  // already catch those notations. IPv4-mapped IPv6 comes back in hex form like
  // [::ffff:7f00:1] — unwrap it to dotted IPv4 and check the same ranges.
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(h);
  if (mapped) {
    const n = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
    h = `${Math.floor(n / 16777216) % 256}.${Math.floor(n / 65536) % 256}.${Math.floor(n / 256) % 256}.${n % 256}`;
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

export function stripHtml(html: string): string {
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

/**
 * Fetch a page and return readable text, capped at maxChars.
 * Follows redirects manually (max 5 hops) and re-validates every target
 * against isBlockedHost, so a public URL that 302s to a private or metadata
 * address cannot bypass the blocklist. Returns a human-readable error string
 * instead of throwing so callers can stuff it straight into model context.
 */
export async function fetchPageText(rawUrl: string, maxChars = 6000): Promise<string> {
  const raw = String(rawUrl ?? '').trim();
  let u: URL;
  try { u = new URL(raw); } catch { return 'Invalid URL.'; }
  try {
    let res: Response | null = null;
    for (let redirects = 0; ; redirects++) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https URLs are allowed.';
      if (isBlockedHost(u.hostname)) return 'That host is not allowed.';
      res = await fetch(u.toString(), {
        headers: { 'User-Agent': 'ChakorBot/1.0' },
        signal: AbortSignal.timeout(12_000),
        redirect: 'manual',
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (redirects >= 5) return 'Too many redirects.';
        res.body?.cancel().catch(() => {});
        try { u = new URL(loc, u); } catch { return 'Invalid redirect target.'; }
        continue;
      }
      break;
    }
    if (!res || !res.ok) return `Fetch failed: HTTP ${res?.status ?? 0}`;
    const ctype = res.headers.get('content-type') ?? '';
    const body = await res.text();
    const text = ctype.includes('html') ? stripHtml(body) : body;
    return text.slice(0, maxChars) || '(empty page)';
  } catch (e) {
    return `Could not fetch the page: ${e instanceof Error ? e.message : 'error'}`;
  }
}
