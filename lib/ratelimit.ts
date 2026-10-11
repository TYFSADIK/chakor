/**
 * Tiny dependency-free fixed-window rate limiter, kept in process memory.
 * Good enough to blunt brute-force / abuse on a self-hosted single-process
 * deployment. Note: state is per-process and resets on restart; behind a
 * reverse proxy, per-IP keys only work if the proxy sets x-forwarded-for.
 */

interface Bucket { count: number; resetAt: number }

const buckets = new Map<string, Bucket>();

// Lazily drop expired buckets so the map does not grow without bound.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Returns true if the call is within the limit, false when exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
