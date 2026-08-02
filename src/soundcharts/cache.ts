/**
 * Server-side TTL cache + in-flight request coalescing for safe GET responses,
 * plus lightweight metrics for the API Usage page. No secrets are ever cached.
 */

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export const cacheMetrics = { hits: 0, misses: 0 };

function now() { return Date.now(); }

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) { cacheMetrics.misses++; return undefined; }
  if (e.expiresAt <= now()) { store.delete(key); cacheMetrics.misses++; return undefined; }
  cacheMetrics.hits++;
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  store.set(key, { value, expiresAt: now() + ttlMs });
}

/**
 * Coalesce identical concurrent GETs: the first caller runs `fn`, the rest await
 * the same promise. Only successful results are cached (caller decides via ttl).
 */
export async function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function cacheClear(): void {
  store.clear();
  inflight.clear();
}
export function cacheSize(): number { return store.size; }
