/**
 * soundchartsRequest<T>() — the single authenticated entry point for Soundcharts
 * customer API calls. Server-only. Never accepts arbitrary URLs from the browser:
 * callers pass a fixed API path built by allow-listed service functions.
 */

import { getSoundchartsConfig, isLegacyConfigured, SoundchartsConfig } from "./config";
import { getSoundchartsAccessToken, invalidateSoundchartsToken, noteSoundchartsRateLimit } from "./auth";
import { SoundchartsError, errorForStatus } from "./errors";
import { cacheGet, cacheSet, coalesce } from "./cache";
import { getLimiter, recordRequest } from "./rate-limit";

type Method = "GET" | "POST";
export type RequestOptions = {
  method?: Method;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  cacheTtlMs?: number; // GET only; defaults to config cache TTL
  timeoutMs?: number;
};

function buildUrl(cfg: SoundchartsConfig, path: string, query?: RequestOptions["query"]): string {
  // path must be a fixed, server-controlled API path like "/api/v2.25/song/...".
  const url = new URL(cfg.baseUrl + (path.startsWith("/") ? path : `/${path}`));
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

function authHeaders(cfg: SoundchartsConfig, bearer: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cfg.useLegacyAuth && isLegacyConfigured(cfg)) {
    // Legacy header auth — do NOT mix with bearer.
    headers["x-app-id"] = cfg.legacyAppId;
    headers["x-api-key"] = cfg.legacyApiKey;
  } else if (bearer) {
    headers.Authorization = `Bearer ${bearer}`; // never logged
  }
  return headers;
}

function parseRetryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number.parseInt(h, 10);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

async function doFetch(cfg: SoundchartsConfig, url: string, method: Method, body: unknown, timeoutMs: number, bearer: string | null): Promise<{ status: number; json: unknown; retryAfterMs: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const headers = authHeaders(cfg, bearer);
    // no-store: our own cache layer handles caching; Next's patched fetch must
    // never serve these from its persistent data cache.
    const init: RequestInit = { method, headers, signal: controller.signal, cache: "no-store" };
    if (method === "POST" && body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    const res = await fetch(url, init);
    const text = await res.text();
    let json: unknown = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    recordRequest(res.status, Date.now() - started);
    return { status: res.status, json, retryAfterMs: parseRetryAfter(res) };
  } catch (err) {
    recordRequest(null, Date.now() - started);
    const aborted = controller.signal.aborted;
    throw new SoundchartsError(aborted ? "SOUNDCHARTS_TIMEOUT" : "SOUNDCHARTS_INVALID_RESPONSE", aborted ? `Soundcharts request timed out after ${timeoutMs}ms.` : `Soundcharts transport error: ${(err as Error).message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Perform a Soundcharts customer API request with retry/backoff/timeout,
 * one-time 401 refresh, and (for GET) short-term caching + coalescing.
 * @returns the parsed JSON body (envelope intact; use unwrap helpers).
 */
export async function soundchartsRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const cfg = getSoundchartsConfig();
  const method = opts.method ?? "GET";
  const url = buildUrl(cfg, path, opts.query);
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const cacheable = method === "GET";
  const cacheKey = `${method}:${url}`;

  if (cacheable) {
    const hit = cacheGet<T>(cacheKey);
    if (hit !== undefined) return hit;
  }

  const exec = async (): Promise<T> => {
    const limiter = getLimiter(cfg.concurrency, cfg.maxRequestsPerMinute);
    const maxAttempts = Math.max(1, cfg.maxRetries + 1);
    let lastErr: SoundchartsError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const bearer = cfg.useLegacyAuth && isLegacyConfigured(cfg) ? null : await getSoundchartsAccessToken();
      const result = await limiter.run(() => doFetch(cfg, url, method, opts.body, timeoutMs, bearer)).catch((e: SoundchartsError) => e);
      if (result instanceof SoundchartsError) {
        lastErr = result;
        if (result.retryable && attempt < maxAttempts) { await sleep(backoff(attempt, cfg)); continue; }
        throw result;
      }
      const { status, json, retryAfterMs } = result;
      if (status >= 200 && status < 300) {
        validateEnvelope(json);
        if (cacheable) cacheSet(cacheKey, json, opts.cacheTtlMs ?? cfg.cacheTtlMs);
        return json as T;
      }
      // 401: refresh the token and retry WITH BACKOFF. Soundcharts intermittently
      // rejects freshly issued tokens for a moment (validation lag), so an
      // immediate retry with a brand-new token can 401 again — the delay is
      // what makes the refresh actually succeed.
      if (status === 401 && !(cfg.useLegacyAuth && isLegacyConfigured(cfg))) {
        invalidateSoundchartsToken();
        lastErr = errorForStatus(status, retryAfterMs);
        if (attempt < maxAttempts) { await sleep(backoff(attempt, cfg)); continue; }
        throw lastErr;
      }
      if (status === 429) noteSoundchartsRateLimit(retryAfterMs ? Math.round(retryAfterMs / 1000) : null);
      const err = errorForStatus(status, retryAfterMs);
      lastErr = err;
      if (err.retryable && attempt < maxAttempts) {
        await sleep(err.retryAfterMs ?? backoff(attempt, cfg));
        continue;
      }
      throw err;
    }
    throw lastErr ?? new SoundchartsError("SOUNDCHARTS_INVALID_RESPONSE", "Soundcharts request failed.");
  };

  return cacheable ? coalesce(cacheKey, exec) : exec();
}

function backoff(attempt: number, cfg: SoundchartsConfig): number {
  const base = 400;
  return Math.min(base * 2 ** (attempt - 1), 5000) * (0.5 + Math.random() * 0.5);
}

function validateEnvelope(json: unknown): void {
  if (json === null || typeof json !== "object") {
    throw new SoundchartsError("SOUNDCHARTS_INVALID_RESPONSE", "Soundcharts returned a malformed response body.");
  }
}

/** Unwrap a single-object envelope: { type, object } -> object. */
export function unwrapObject<T = Record<string, unknown>>(body: unknown): T | null {
  if (body && typeof body === "object" && "object" in (body as Record<string, unknown>)) {
    return (body as { object: T }).object ?? null;
  }
  return (body as T) ?? null;
}

/** Unwrap a list envelope: { items, page } -> items[]. */
export function unwrapItems<T = Record<string, unknown>>(body: unknown): T[] {
  if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: T[] }).items;
  }
  return Array.isArray(body) ? (body as T[]) : [];
}
