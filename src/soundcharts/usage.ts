/**
 * API usage + quota summary for the API Usage page.
 *
 * Soundcharts exposes billing quota / rate-limit consumption; the exact route
 * is verified per plan. To avoid guessing a wrong path we (a) always report our
 * own conservative internal metrics, and (b) surface quota values only if the
 * official quota endpoint (configurable) returns them. Never exposes credentials.
 */

import { soundchartsRequest, unwrapObject } from "./client";
import { usageMetrics, averageResponseMs } from "./rate-limit";
import { cacheMetrics, cacheSize } from "./cache";
import { isSoundchartsConfigured } from "./config";

export function internalUsage() {
  return {
    soundchartsRequests: usageMetrics.requests,
    failedRequests: usageMetrics.failures,
    planRestricted403: usageMetrics.planRestricted,
    rateLimited429: usageMetrics.rateLimited,
    averageResponseMs: averageResponseMs(),
    byStatus: usageMetrics.byStatus,
    cacheHits: cacheMetrics.hits,
    cacheMisses: cacheMetrics.misses,
    cacheEntries: cacheSize(),
    cacheHitRate: cacheMetrics.hits + cacheMetrics.misses > 0
      ? Math.round((cacheMetrics.hits / (cacheMetrics.hits + cacheMetrics.misses)) * 100)
      : 0,
  };
}

/**
 * Attempt to read official quota from Soundcharts (only if configured). Returns
 * null (not an error) when the plan/route does not expose it.
 */
export async function getOfficialQuota(): Promise<Record<string, unknown> | null> {
  if (!isSoundchartsConfigured()) return null;
  const path = process.env.SOUNDCHARTS_QUOTA_PATH ?? "";
  if (!path) return null; // not configured — avoid guessing a wrong endpoint
  try {
    const body = await soundchartsRequest(path, { cacheTtlMs: 60000 });
    return unwrapObject<Record<string, unknown>>(body);
  } catch {
    return null;
  }
}
