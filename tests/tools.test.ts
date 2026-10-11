import { describe, it, expect, vi, afterEach } from 'vitest';
import { TOOLS } from '@/lib/tools';

const fetchUrl = TOOLS.fetch_url.run;

function res(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetch_url SSRF guard (regression: redirect bypass)', () => {
  it('blocks direct private hosts without fetching', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    for (const url of [
      'http://127.0.0.1:4546/props',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
      'http://localhost:3001/api/system',
      'http://2130706433/', // decimal 127.0.0.1, normalized by WHATWG URL
      'http://[::ffff:7f00:1]/', // IPv4-mapped IPv6 loopback
    ]) {
      const out = await fetchUrl({ url });
      expect(out, url).toMatch(/not allowed/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks a public URL that redirects to a private address', async () => {
    const spy = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === 'http://example.com/redirect') {
        return res(302, '', { location: 'http://169.254.169.254/latest/meta-data' });
      }
      return res(200, 'should never reach here');
    });
    vi.stubGlobal('fetch', spy);
    const out = await fetchUrl({ url: 'http://example.com/redirect' });
    expect(out).toMatch(/not allowed/);
    // Only the first (public) hop may be fetched — never the private target.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects and returns content', async () => {
    const spy = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === 'http://example.com/a') return res(301, '', { location: '/b' });
      return res(200, '<html><body><p>hello world</p></body></html>', { 'content-type': 'text/html' });
    });
    vi.stubGlobal('fetch', spy);
    const out = await fetchUrl({ url: 'http://example.com/a' });
    expect(out).toBe('hello world');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('caps redirect loops', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(302, '', { location: 'http://example.com/loop' })));
    const out = await fetchUrl({ url: 'http://example.com/loop' });
    expect(out).toMatch(/Too many redirects/);
  });

  it('rejects non-http(s) schemes', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await fetchUrl({ url: 'file:///etc/passwd' })).toMatch(/Only http/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('calculator tool', () => {
  const calc = TOOLS.calculator.run;
  it('evaluates arithmetic', async () => {
    expect(await calc({ expression: '(1200 * 1.08) / 12' })).toBe('108');
    expect(await calc({ expression: '2**10' })).toBe('1024');
  });
  it('rejects non-arithmetic input', async () => {
    const out = await calc({ expression: 'process.exit(1)' });
    expect(out).not.toBe('1');
  });
});
