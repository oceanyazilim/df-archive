/**
 * Authorized internal API access layer.
 *
 * This module owns request control (timeout, retries, exponential backoff) and
 * delegates the actual transport to an injected {@link InternalApiClient}. The
 * concrete client is supplied by the host project so this package never
 * hardcodes an endpoint, transport, or credential and never turns into a
 * general-purpose scraper for any specific third-party service.
 */

import {
  InternalApiClient,
  InternalApiTrackResponse,
  TrackIdentifier,
} from "./types";
import {
  PERMANENT_HTTP_STATUS,
  RETRYABLE_HTTP_STATUS,
  ResolverConfig,
} from "./config";
import { logger } from "./logger";

/** Error thrown by the API layer; carries retry classification. */
export class InternalApiError extends Error {
  readonly code = "INTERNAL_API_ERROR" as const;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  /** Number of attempts made before giving up. */
  attempts = 1;
  constructor(message: string, httpStatus: number | null, retryable: boolean) {
    super(message);
    this.name = "InternalApiError";
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

let activeClient: InternalApiClient | null = null;

/** Register the host project's authorized internal API client. */
export function setInternalApiClient(client: InternalApiClient): void {
  activeClient = client;
}

export function getInternalApiClient(): InternalApiClient {
  if (!activeClient) {
    throw new InternalApiError(
      "No InternalApiClient registered. Call setInternalApiClient() with your authorized client.",
      null,
      false
    );
  }
  return activeClient;
}

function isRetryableStatus(status: number): boolean {
  if (PERMANENT_HTTP_STATUS.has(status)) return false;
  return RETRYABLE_HTTP_STATUS.has(status);
}

function backoffDelayMs(attempt: number, cfg: ResolverConfig): number {
  // attempt is 1-based; exponential growth with a hard ceiling.
  const exponential = cfg.retryBaseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, cfg.retryMaxMs);
  // Full jitter avoids synchronized retry storms across concurrent requests.
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Query one track from the authorized internal API, applying a per-attempt
 * timeout, retry of temporary failures, and exponential backoff.
 *
 * @returns the raw response body and HTTP status.
 * @throws {InternalApiError} when all attempts fail.
 */
export async function queryTrackFromInternalApi(
  identifier: TrackIdentifier,
  token: string,
  cfg: ResolverConfig
): Promise<{ status: number; body: InternalApiTrackResponse; attempts: number }> {
  const client = getInternalApiClient();
  const maxAttempts = Math.max(1, cfg.maxRetries + 1);
  let lastError: InternalApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const started = Date.now();
    try {
      const { status, body } = await client.lookupTrack(
        identifier,
        token,
        controller.signal
      );

      if (status >= 200 && status < 300) {
        logger.debug({
          event: "internal_api_ok",
          trackId: identifier.value,
          identifierType: identifier.type ?? "trackId",
          httpStatus: status,
          requestStatus: "success",
          retryAttempt: attempt,
          durationMs: Date.now() - started,
        });
        return { status, body, attempts: attempt };
      }

      // Non-2xx: classify and decide whether to retry.
      const retryable = isRetryableStatus(status);
      lastError = new InternalApiError(
        `Internal API returned HTTP ${status}.`,
        status,
        retryable
      );
      logger.warn({
        event: "internal_api_http_error",
        trackId: identifier.value,
        httpStatus: status,
        requestStatus: "failed",
        retryAttempt: attempt,
        errorCategory: retryable ? "retryable" : "permanent",
        durationMs: Date.now() - started,
      });
      if (!retryable) break;
    } catch (err) {
      // Transport-level failure (network error, timeout/abort). Treat as
      // temporary and retry unless the client marked it permanent.
      const aborted =
        controller.signal.aborted ||
        (err as Error)?.name === "AbortError" ||
        (err as Error)?.message === "aborted";
      const retryable =
        err instanceof InternalApiError ? err.retryable : true;
      lastError =
        err instanceof InternalApiError
          ? err
          : new InternalApiError(
              aborted
                ? `Internal API request timed out after ${cfg.timeoutMs}ms.`
                : `Internal API transport error: ${(err as Error).message}`,
              null,
              retryable
            );
      logger.warn({
        event: aborted ? "internal_api_timeout" : "internal_api_transport_error",
        trackId: identifier.value,
        requestStatus: "failed",
        retryAttempt: attempt,
        errorCategory: retryable ? "retryable" : "permanent",
        durationMs: Date.now() - started,
      });
      if (!retryable) break;
    } finally {
      clearTimeout(timeout);
    }

    // Backoff before the next attempt (if any remain).
    if (attempt < maxAttempts) {
      await sleep(backoffDelayMs(attempt, cfg)).catch(() => undefined);
    }
  }

  const finalError =
    lastError ?? new InternalApiError("Internal API track lookup failed.", null, false);
  finalError.attempts = maxAttempts;
  throw finalError;
}
