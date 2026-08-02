/**
 * Generic request executor with per-attempt timeout, retry of temporary
 * failures, and exponential backoff with full jitter. Shared by the Spotify and
 * licensor upstream stages so retry policy lives in exactly one place.
 */

import {
  PERMANENT_HTTP_STATUS,
  RETRYABLE_HTTP_STATUS,
  ResolverConfig,
} from "./config";
import { InternalApiError } from "./internalApi";
import { logger } from "./logger";

function isRetryableStatus(status: number): boolean {
  if (PERMANENT_HTTP_STATUS.has(status)) return false;
  return RETRYABLE_HTTP_STATUS.has(status);
}

function backoffDelayMs(attempt: number, cfg: ResolverConfig): number {
  const exponential = cfg.retryBaseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, cfg.retryMaxMs);
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type HttpCallResult = { status: number; body: Record<string, unknown> };

/**
 * Execute `call` with retry/timeout/backoff.
 *
 * `call` receives an AbortSignal (wired to the per-attempt timeout) and must
 * return `{ status, body }`. A non-2xx status is classified: retryable statuses
 * (429/5xx) are retried, permanent statuses (400/401/403/404) throw immediately.
 * Transport errors (network/abort) are treated as retryable.
 *
 * @throws {InternalApiError} when all attempts are exhausted or on a permanent
 *         failure. The thrown error carries `httpStatus` and `attempts`.
 */
export async function executeWithRetry(
  label: string,
  cfg: ResolverConfig,
  parentSignal: AbortSignal | undefined,
  call: (signal: AbortSignal) => Promise<HttpCallResult>
): Promise<HttpCallResult & { attempts: number }> {
  const maxAttempts = Math.max(1, cfg.maxRetries + 1);
  let lastError: InternalApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (parentSignal?.aborted) {
      throw new InternalApiError(`${label} aborted.`, null, false);
    }
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const started = Date.now();
    try {
      const { status, body } = await call(controller.signal);
      if (status >= 200 && status < 300) {
        return { status, body, attempts: attempt };
      }
      const retryable = isRetryableStatus(status);
      lastError = new InternalApiError(`${label} returned HTTP ${status}.`, status, retryable);
      logger.warn({
        event: "upstream_http_error",
        httpStatus: status,
        requestStatus: "failed",
        retryAttempt: attempt,
        errorCategory: retryable ? "retryable" : "permanent",
        durationMs: Date.now() - started,
      });
      if (!retryable) break;
    } catch (err) {
      const aborted =
        controller.signal.aborted || (err as Error)?.name === "AbortError";
      const retryable = err instanceof InternalApiError ? err.retryable : true;
      lastError =
        err instanceof InternalApiError
          ? err
          : new InternalApiError(
              aborted
                ? `${label} timed out after ${cfg.timeoutMs}ms.`
                : `${label} transport error: ${(err as Error).message}`,
              null,
              retryable
            );
      logger.warn({
        event: aborted ? "upstream_timeout" : "upstream_transport_error",
        requestStatus: "failed",
        retryAttempt: attempt,
        errorCategory: retryable ? "retryable" : "permanent",
        durationMs: Date.now() - started,
      });
      if (!retryable) break;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }

    if (attempt < maxAttempts) {
      await sleep(backoffDelayMs(attempt, cfg));
    }
  }

  const finalError =
    lastError ?? new InternalApiError(`${label} failed.`, null, false);
  finalError.attempts = maxAttempts;
  throw finalError;
}
