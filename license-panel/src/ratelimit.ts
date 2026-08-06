/**
 * Per-IP rate limit for the public (app-facing) endpoints.
 *
 * The key space is far too large to brute-force meaningfully, but an
 * unthrottled activate endpoint is still free CPU for whoever finds it — and
 * the audit log should not be floodable by a stranger.
 */

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 1000;

export function allow(ip: string | null, max: number): boolean {
  const key = ip ?? "unknown";
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.windowStart > WINDOW_MS) buckets.delete(k);
    }
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
