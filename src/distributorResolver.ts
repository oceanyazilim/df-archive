/**
 * Distributor resolution service — the intermediary orchestration layer.
 *
 * Pipeline for a single track:
 *   validate identifier
 *     -> acquire authorized token
 *     -> query internal API (with retry/timeout/backoff)
 *     -> extract licensor UUID
 *     -> normalize UUID
 *     -> look up distributor in the local mapping
 *     -> return a structured result
 *
 * CORE RULE: the distributor is determined ONLY by matching the exact licensor
 * UUID from the API against the local mapping. Track title, artist, or any
 * other guessed metadata is never used to determine the distributor.
 */

import {
  BatchLookupResult,
  BatchSummary,
  DistributorLookupResult,
  LicensorResolution,
  LicensorUuidProvider,
  LoadedMapping,
  TrackIdentifier,
  TrackIdentifierType,
} from "./types";
import { ResolverConfig, UUID_MAPPING_PATH, defaultResolverConfig } from "./config";
import { loadUuidMapping, findDistributorByUuid, findConflictByUuid } from "./uuidMapping";
import { normalizeUuid } from "./normalizeUuid";
import { TokenMissingError } from "./token";
import { InternalApiError } from "./internalApi";
import { InvalidIdentifierError } from "./errors";
import { createLegacyProvider } from "./providers/legacyProvider";
import { LookupCache, CachedLookup } from "./cache";
import { runWithConcurrency } from "./pool";
import { logger } from "./logger";

export type ResolverOptions = {
  config?: Partial<ResolverConfig>;
  mappingPath?: string;
  /** Provide a pre-loaded mapping to avoid re-reading the file. */
  mapping?: LoadedMapping;
  /** Share a cache instance across calls; created internally if omitted. */
  cache?: LookupCache;
  /**
   * Upstream provider that turns an identifier into a raw licensor UUID.
   * Defaults to the legacy injectable-client provider for backward compat.
   */
  provider?: LicensorUuidProvider;
};

export class DistributorResolver {
  private readonly config: ResolverConfig;
  private readonly mappingPath: string;
  private readonly mapping: LoadedMapping;
  private readonly cache: LookupCache;
  private readonly provider: LicensorUuidProvider;

  constructor(options: ResolverOptions = {}) {
    this.config = { ...defaultResolverConfig(), ...(options.config ?? {}) };
    this.mappingPath = options.mappingPath ?? UUID_MAPPING_PATH;
    this.mapping = options.mapping ?? loadUuidMapping(this.mappingPath);
    this.cache = options.cache ?? new LookupCache(this.config.cacheTtlMs);
    this.provider = options.provider ?? createLegacyProvider(this.config);
  }

  /** Force a reload of the mapping file (manual refresh / hot reload). */
  refreshMapping(): LoadedMapping {
    return loadUuidMapping(this.mappingPath, true);
  }

  get loadedMapping(): LoadedMapping {
    return this.mapping;
  }

  /** Resolve the distributor for a single track. Never throws. */
  async resolveDistributorForTrack(
    input: TrackIdentifier | string
  ): Promise<DistributorLookupResult> {
    const started = Date.now();
    const identifier = normalizeIdentifier(input);
    const identifierType: TrackIdentifierType = identifier?.type ?? "trackId";
    const trackId = identifier?.value ?? String((input as TrackIdentifier)?.value ?? input ?? "");

    // 1. Validate the track identifier.
    if (!identifier) {
      return finalize(
        {
          success: false,
          trackId,
          identifierType,
          licensorUuid: null,
          distributor: null,
          matchStatus: "unresolved",
          requestStatus: "failed",
          error: {
            code: "INVALID_TRACK_IDENTIFIER",
            message: "The track identifier is missing or invalid.",
          },
        },
        started
      );
    }

    // Short-term cache lookup (never stores tokens).
    const cacheKey = LookupCache.key(identifierType, normalizeUuid(identifier.value) ?? identifier.value);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return finalize(this.fromCache(identifier, identifierType, cached), started, true);
    }

    // 2-5. Upstream resolution (token + query + UUID extraction) is delegated
    // to the injected provider. For the panel this is the Spotify -> ISRC ->
    // licensor API pipeline; for the standalone library it is the legacy client.
    let resolution: LicensorResolution;
    try {
      resolution = await this.provider.resolve(identifier);
    } catch (err) {
      // Structurally invalid input (e.g. malformed ISRC or unparseable Spotify
      // link) is a client error, not an upstream API failure.
      if (err instanceof InvalidIdentifierError) {
        return finalize(
          {
            success: false,
            trackId: identifier.value,
            identifierType,
            licensorUuid: null,
            distributor: null,
            matchStatus: "unresolved",
            requestStatus: "failed",
            error: { code: "INVALID_TRACK_IDENTIFIER", message: err.message },
            meta: { attempts: 1 },
          },
          started
        );
      }
      const isMissing = err instanceof TokenMissingError;
      const httpStatus = err instanceof InternalApiError ? err.httpStatus : null;
      const failAttempts = err instanceof InternalApiError ? err.attempts : 1;
      logger.error({
        event: "resolve_api_failed",
        trackId: identifier.value,
        identifierType,
        httpStatus,
        requestStatus: "failed",
        retryAttempt: failAttempts,
        errorCategory: isMissing ? "TOKEN_MISSING" : "INTERNAL_API_ERROR",
      });
      // Surface a safe, specific reason. The messages thrown by the upstream
      // layers name missing configuration (e.g. "LICENSOR_API_URL is not
      // configured") or HTTP status only — never tokens or secrets.
      const safeMessage =
        (err instanceof TokenMissingError || err instanceof InternalApiError) && err.message
          ? err.message
          : isMissing
            ? "The authorized API token is not available."
            : "The internal API track lookup failed.";
      return finalize(
        {
          success: false,
          trackId: identifier.value,
          identifierType,
          licensorUuid: null,
          distributor: null,
          matchStatus: "unresolved",
          requestStatus: "failed",
          error: {
            code: isMissing ? "TOKEN_MISSING" : "INTERNAL_API_ERROR",
            message: safeMessage,
            details: httpStatus !== null ? { httpStatus } : undefined,
          },
          meta: { httpStatus, attempts: failAttempts },
        },
        started
      );
    }

    // 5. Raw licensor UUID + non-sensitive display metadata from the provider.
    const rawUuid = resolution.licensorUuid;
    const status = resolution.httpStatus;
    const displayMeta = {
      ...resolution.metadata,
      spotifyTrackId: resolution.spotifyTrackId ?? null,
      httpStatus: resolution.httpStatus,
      attempts: resolution.attempts,
    };

    // 6. Normalize the UUID.
    const licensorUuid = normalizeUuid(rawUuid);

    if (licensorUuid === null) {
      // API succeeded but returned no usable UUID -> "missing", not "unmatched".
      return finalize(
        {
          success: false,
          trackId: identifier.value,
          identifierType,
          licensorUuid: null,
          distributor: null,
          matchStatus: "unresolved",
          requestStatus: "success",
          error: {
            code: "LICENSOR_UUID_MISSING",
            message: "The API response did not contain a licensor UUID.",
          },
          meta: displayMeta,
        },
        started
      );
    }

    // 7. Look up the distributor in the local mapping.
    // First check for a known mapping conflict for this exact UUID.
    const conflict = findConflictByUuid(this.mapping, licensorUuid);
    if (conflict) {
      return finalize(
        {
          success: false,
          trackId: identifier.value,
          identifierType,
          licensorUuid,
          distributor: null,
          matchStatus: "unresolved",
          requestStatus: "success",
          error: {
            code: "UUID_MAPPING_CONFLICT",
            message:
              "The licensor UUID maps to multiple distributors in the local mapping.",
            details: { uuid: conflict.uuid, distributors: conflict.distributors },
          },
          meta: displayMeta,
        },
        started
      );
    }

    const distributor = findDistributorByUuid(this.mapping, licensorUuid);

    if (distributor === undefined) {
      // API returned a UUID, but it is not in the local mapping -> "unmatched".
      const result: DistributorLookupResult = {
        success: true,
        trackId: identifier.value,
        identifierType,
        licensorUuid,
        distributor: null,
        matchStatus: "unmatched",
        requestStatus: "success",
        error: {
          code: "UUID_NOT_FOUND",
          message: "The licensor UUID was not found in the local distributor mapping.",
        },
        meta: displayMeta,
      };
      this.cache.set(cacheKey, toCache(result));
      return finalize(result, started);
    }

    // 8. Matched.
    const result: DistributorLookupResult = {
      success: true,
      trackId: identifier.value,
      identifierType,
      licensorUuid,
      distributor,
      matchStatus: "matched",
      requestStatus: "success",
      error: null,
      meta: displayMeta,
    };
    this.cache.set(cacheKey, toCache(result));

    logger.info({
      event: "resolve_matched",
      trackId: identifier.value,
      identifierType,
      httpStatus: status,
      requestStatus: "success",
      licensorUuid,
      matchStatus: "matched",
    });
    return finalize(result, started);
  }

  /**
   * Resolve distributors for a batch of tracks.
   *  - loads the mapping once (already held on the instance)
   *  - deduplicates identical identifiers before querying
   *  - uses bounded concurrency
   *  - continues on individual failures
   *  - preserves input order, one result per input track
   */
  async resolveDistributorsForTracks(
    inputs: Array<TrackIdentifier | string>
  ): Promise<BatchLookupResult> {
    const identifiers = inputs.map((i) => normalizeIdentifier(i));

    // Deduplicate by (type + normalized value); invalid entries handled per-item.
    const dedupKey = (id: TrackIdentifier) =>
      LookupCache.key(id.type ?? "trackId", normalizeUuid(id.value) ?? id.value);

    const uniqueByKey = new Map<string, TrackIdentifier>();
    for (const id of identifiers) {
      if (!id) continue;
      const key = dedupKey(id);
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, id);
    }

    const uniqueList = [...uniqueByKey.entries()];
    const settled = await runWithConcurrency(
      uniqueList,
      this.config.concurrency,
      async ([, id]) => this.resolveDistributorForTrack(id)
    );

    // Map unique results back by key for order-preserving fan-out.
    const resultByKey = new Map<string, DistributorLookupResult>();
    uniqueList.forEach(([key], i) => {
      const s = settled[i];
      if (s.ok) resultByKey.set(key, s.value);
    });

    const results: DistributorLookupResult[] = inputs.map((raw, idx) => {
      const id = identifiers[idx];
      if (!id) {
        return {
          success: false,
          trackId: String((raw as TrackIdentifier)?.value ?? raw ?? ""),
          identifierType: "trackId",
          licensorUuid: null,
          distributor: null,
          matchStatus: "unresolved",
          requestStatus: "failed",
          error: {
            code: "INVALID_TRACK_IDENTIFIER",
            message: "The track identifier is missing or invalid.",
          },
        };
      }
      const key = dedupKey(id);
      const found = resultByKey.get(key);
      // Re-clone so repeated identifiers each get their own object.
      return found
        ? { ...found, meta: { ...found.meta, cached: found.meta?.cached ?? undefined } }
        : {
            success: false,
            trackId: id.value,
            identifierType: id.type ?? "trackId",
            licensorUuid: null,
            distributor: null,
            matchStatus: "unresolved",
            requestStatus: "failed",
            error: {
              code: "INTERNAL_API_ERROR",
              message: "The internal API track lookup failed.",
            },
          };
    });

    return { summary: summarize(results), results };
  }

  private fromCache(
    identifier: TrackIdentifier,
    identifierType: TrackIdentifierType,
    cached: CachedLookup
  ): DistributorLookupResult {
    const matched = cached.matchStatus === "matched";
    const unmatched = cached.matchStatus === "unmatched";
    return {
      success: matched || unmatched,
      trackId: identifier.value,
      identifierType,
      licensorUuid: cached.licensorUuid,
      distributor: cached.distributor,
      matchStatus: cached.matchStatus,
      requestStatus: "success",
      error: unmatched
        ? {
            code: "UUID_NOT_FOUND",
            message: "The licensor UUID was not found in the local distributor mapping.",
          }
        : null,
      meta: { cached: true },
    };
  }
}

function toCache(result: DistributorLookupResult): CachedLookup {
  return {
    licensorUuid: result.licensorUuid,
    distributor: result.distributor,
    matchStatus: result.matchStatus,
  };
}

function finalize(
  result: DistributorLookupResult,
  started: number,
  cached = false
): DistributorLookupResult {
  const durationMs = Date.now() - started;
  return {
    ...result,
    meta: { ...(result.meta ?? {}), durationMs, cached: cached || result.meta?.cached || false },
  };
}

/** Coerce assorted input shapes into a validated TrackIdentifier, or null. */
export function normalizeIdentifier(
  input: TrackIdentifier | string | null | undefined
): TrackIdentifier | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") {
    const value = input.trim();
    return value.length > 0 ? { value, type: "trackId" } : null;
  }
  if (typeof input === "object") {
    const value = input.value;
    if (typeof value !== "string" || value.trim().length === 0) return null;
    return { value: value.trim(), type: input.type ?? "trackId" };
  }
  return null;
}

function summarize(results: DistributorLookupResult[]): BatchSummary {
  const summary: BatchSummary = {
    totalTracks: results.length,
    successfulApiRequests: 0,
    matchedDistributors: 0,
    unmatchedUuids: 0,
    missingUuids: 0,
    failedRequests: 0,
  };
  for (const r of results) {
    if (r.requestStatus === "success") summary.successfulApiRequests++;
    else summary.failedRequests++;

    if (r.matchStatus === "matched") summary.matchedDistributors++;
    else if (r.matchStatus === "unmatched") summary.unmatchedUuids++;
    else if (r.error?.code === "LICENSOR_UUID_MISSING") summary.missingUuids++;
  }
  return summary;
}
