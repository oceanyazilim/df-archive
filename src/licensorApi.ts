/**
 * Authorized licensor API integration (server-side only).
 *
 * Given an ISRC, this calls the separate authorized licensor/internal API and
 * returns its response, from which the licensor UUID is extracted. Endpoint,
 * auth header/prefix, ISRC field, and method are all environment-driven. The
 * token stays on the server and is never logged or returned.
 */

import { LICENSOR_API, ResolverConfig } from "./config";
import { InternalApiError } from "./internalApi";
import { executeWithRetry } from "./retry";
import { TokenMissingError } from "./token";
import { InternalApiTrackResponse } from "./types";

/** Read the licensor API token from the server environment. */
export function getLicensorApiToken(): string {
  const token = process.env.LICENSOR_API_TOKEN;
  if (!token || token.trim().length === 0) {
    throw new TokenMissingError("LICENSOR_API_TOKEN is not configured on the server.");
  }
  return token.trim();
}

/**
 * Look up licensor information for an ISRC via the authorized licensor API,
 * with retry/timeout/backoff.
 */
export async function lookupLicensorByIsrc(
  isrc: string,
  cfg: ResolverConfig,
  signal?: AbortSignal
): Promise<{ status: number; body: InternalApiTrackResponse; attempts: number }> {
  if (!LICENSOR_API.url) {
    throw new InternalApiError("LICENSOR_API_URL is not configured.", null, false);
  }
  const token = getLicensorApiToken();

  return executeWithRetry("Licensor API lookup", cfg, signal, async (s) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    headers[LICENSOR_API.tokenHeader] = LICENSOR_API.tokenPrefix
      ? `${LICENSOR_API.tokenPrefix} ${token}`
      : token;

    const init: RequestInit = { method: LICENSOR_API.method, headers, signal: s, cache: "no-store" };
    let url = LICENSOR_API.url;
    if (LICENSOR_API.method === "GET") {
      const u = new URL(LICENSOR_API.url);
      u.searchParams.set(LICENSOR_API.isrcField, isrc);
      url = u.toString();
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ [LICENSOR_API.isrcField]: isrc });
    }

    const res = await fetch(url, init);
    let body: InternalApiTrackResponse = {};
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text) as InternalApiTrackResponse;
      } catch {
        body = {};
      }
    }
    return { status: res.status, body };
  });
}
