/**
 * Tiny structured logger: one JSON object per line on stdout, so failures in
 * lib/ don't vanish. Server-side only. NEVER log secrets — context keys on
 * the redact list are masked before the line is written.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACT_KEYS = new Set([
  'authorization', 'token', 'apikey', 'api_key', 'password', 'secret', 'cookie', 'set-cookie',
]);

function redact(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(ctx ? redact(ctx) : {}) });
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
};

/** Safe one-line text for an unknown caught value (for log context). */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
