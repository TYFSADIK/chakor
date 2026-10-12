/**
 * SSRF-protected page fetching, shared by the fetch_url tool and the deep
 * research pipeline. Anything a model or a search result hands us is
 * untrusted, so every hop is validated before it is requested: the hostname is
 * resolved via DNS and EVERY returned address is checked against the full
 * special-use range lists (IPv4 + IPv6), immediately before the fetch, and
 * again on each redirect hop.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

// Block obvious internal targets so a model cannot use fetching to poke at the
// host's own network. Set TOOLS_ALLOW_PRIVATE=true to turn this off.
export function isBlockedHost(hostname: string): boolean {
  if (process.env.TOOLS_ALLOW_PRIVATE === 'true') return false;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (isIP(h)) return isBlockedIp(h);
  return false;
}

/** True when the address sits in any special-use range (RFC 6890 et al.). */
export function isBlockedIp(ip: string): boolean {
  let addr = ip.toLowerCase();
  // Unwrap IPv4-mapped/compatible IPv6 (::ffff:7f00:1) to dotted IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) addr = mapped[1];
  else {
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
    if (hexMapped) {
      const n = parseInt(hexMapped[1], 16) * 65536 + parseInt(hexMapped[2], 16);
      addr = `${Math.floor(n / 16777216) % 256}.${Math.floor(n / 65536) % 256}.${Math.floor(n / 256) % 256}.${n % 256}`;
    }
  }

  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 0 || // 0.0.0.0/8 "this network"
      a === 10 || // RFC 1918
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) || // RFC 1918
      (a === 192 && b === 0) || // 192.0.0.0/24 IETF protocol assignments (+192.0.2.0/24 doc)
      (a === 192 && b === 168) || // RFC 1918
      (a === 198 && (b === 18 || b === 19)) || // benchmark 198.18.0.0/15
      (a === 198 && b === 51) || // doc 198.51.100.0/24
      (a === 203 && b === 0) || // doc 203.0.113.0/24
      a >= 224 // multicast 224.0.0.0/4 + reserved 240.0.0.0/4
    );
  }
  if (family === 6) {
    const first = parseInt(addr.split(':')[0] || '0', 16);
    return (
      addr === '::' || // unspecified
      addr === '::1' || // loopback
      (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (first & 0xff00) === 0xff00 || // multicast ff00::/8
      (first === 0x2001 && addr.startsWith('2001:db8')) // doc 2001:db8::/32
    );
  }
  return true; // not a parseable address — fail closed
}

/**
 * Resolve a hostname and confirm EVERY address it maps to is public. Literal
 * IPs skip DNS. Returns null when allowed, or a reason string when blocked.
 */
async function checkHost(hostname: string): Promise<string | null> {
  if (process.env.TOOLS_ALLOW_PRIVATE === 'true') return null;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) {
    return 'That host is not allowed.';
  }
  if (isIP(h)) return isBlockedIp(h) ? 'That host is not allowed.' : null;
  let addresses: Array<{ address: string }>;
  try {
    // verbatim: don't let getaddrinfo reordering hide a blocked address family.
    addresses = await dns.lookup(h, { all: true, verbatim: true });
  } catch {
    return 'Could not resolve that host.';
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    return 'That host is not allowed.';
  }
  return null;
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

/** Read a response body with a hard byte cap instead of buffering it whole. */
async function readBodyCapped(res: Response, capBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < capBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(total, capBytes));
  let off = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.min(c.byteLength, buf.byteLength - off));
    buf.set(slice, off);
    off += slice.byteLength;
    if (off >= buf.byteLength) break;
  }
  return new TextDecoder().decode(buf);
}

/**
 * Fetch a page and return readable text, capped at maxChars.
 * Follows redirects manually (max 5 hops) and re-resolves + re-validates every
 * target right before requesting it, so a public URL that 302s to a private or
 * metadata address — or a hostname whose DNS flips mid-lookup (rebinding) —
 * cannot bypass the blocklist. (In-process this is best-effort: the kernel
 * could still resolve differently at connect time; full protection needs a
 * network-level egress rule.) Returns a human-readable error string instead of
 * throwing so callers can stuff it straight into model context.
 */
export async function fetchPageText(rawUrl: string, maxChars = 6000): Promise<string> {
  const raw = String(rawUrl ?? '').trim();
  let u: URL;
  try { u = new URL(raw); } catch { return 'Invalid URL.'; }
  try {
    let res: Response | null = null;
    for (let redirects = 0; ; redirects++) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https URLs are allowed.';
      const blocked = await checkHost(u.hostname);
      if (blocked) return blocked;
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
    // Stream with a hard cap (2x maxChars of headroom for HTML stripping)
    // instead of buffering an arbitrarily large body.
    const body = await readBodyCapped(res, maxChars * 2);
    const text = ctype.includes('html') ? stripHtml(body) : body;
    return text.slice(0, maxChars) || '(empty page)';
  } catch (e) {
    return `Could not fetch the page: ${e instanceof Error ? e.message : 'error'}`;
  }
}
