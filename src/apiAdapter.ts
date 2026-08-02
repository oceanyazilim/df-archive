/**
 * Adapter that converts internal {@link DistributorLookupResult} objects into
 * the flat panel API response shape and computes the batch summary.
 *
 * Kept separate so the core resolver stays presentation-agnostic and the route
 * handlers stay thin.
 */

import { DistributorLookupResult } from "./types";

export type PanelMatchStatus =
  | "matched"
  | "unmatched"
  | "uuid_missing"
  | "conflict"
  | "invalid"
  | "failed";

export type PanelResult = {
  success: boolean;
  trackId: string;
  identifierType: string;
  spotifyTrackId: string | null;
  trackTitle: string | null;
  artistName: string | null;
  isrc: string | null;
  upc: string | null;
  releaseTitle: string | null;
  label: string | null;
  artworkUrl: string | null;
  licensorUuid: string | null;
  distributor: string | null;
  matchStatus: PanelMatchStatus;
  requestStatus: "success" | "failed";
  httpStatus: number | null;
  attempts: number;
  durationMs: number;
  cached: boolean;
  error: {
    code: string;
    message: string;
    distributors?: string[];
  } | null;
};

export type PanelSummary = {
  totalTracks: number;
  processedTracks: number;
  successfulApiRequests: number;
  matchedDistributors: number;
  unmatchedUuids: number;
  missingUuids: number;
  mappingConflicts: number;
  failedRequests: number;
};

/** Map the core (matchStatus + error.code) pair to the panel's status enum. */
function toPanelStatus(r: DistributorLookupResult): PanelMatchStatus {
  if (r.matchStatus === "matched") return "matched";
  if (r.matchStatus === "unmatched") return "unmatched";
  switch (r.error?.code) {
    case "LICENSOR_UUID_MISSING":
      return "uuid_missing";
    case "UUID_MAPPING_CONFLICT":
      return "conflict";
    case "INVALID_TRACK_IDENTIFIER":
      return "invalid";
    default:
      return "failed";
  }
}

export function toPanelResult(r: DistributorLookupResult): PanelResult {
  const meta = r.meta ?? {};
  const conflictDistributors = (r.error?.details?.distributors as string[]) ?? undefined;
  return {
    success: r.success,
    trackId: r.trackId,
    identifierType: r.identifierType,
    spotifyTrackId: meta.spotifyTrackId ?? null,
    trackTitle: meta.title ?? null,
    artistName: meta.artist ?? null,
    isrc: meta.isrc ?? null,
    upc: meta.upc ?? null,
    releaseTitle: meta.releaseTitle ?? null,
    label: meta.label ?? null,
    artworkUrl: meta.artworkUrl ?? null,
    licensorUuid: r.licensorUuid,
    distributor: r.distributor,
    matchStatus: toPanelStatus(r),
    requestStatus: r.requestStatus,
    httpStatus: meta.httpStatus ?? null,
    attempts: meta.attempts ?? 1,
    durationMs: meta.durationMs ?? 0,
    cached: meta.cached ?? false,
    error: r.error
      ? { code: r.error.code, message: r.error.message, distributors: conflictDistributors }
      : null,
  };
}

export function summarize(results: PanelResult[]): PanelSummary {
  const summary: PanelSummary = {
    totalTracks: results.length,
    processedTracks: results.length,
    successfulApiRequests: 0,
    matchedDistributors: 0,
    unmatchedUuids: 0,
    missingUuids: 0,
    mappingConflicts: 0,
    failedRequests: 0,
  };
  for (const r of results) {
    if (r.requestStatus === "success") summary.successfulApiRequests++;
    else summary.failedRequests++;
    switch (r.matchStatus) {
      case "matched":
        summary.matchedDistributors++;
        break;
      case "unmatched":
        summary.unmatchedUuids++;
        break;
      case "uuid_missing":
        summary.missingUuids++;
        break;
      case "conflict":
        summary.mappingConflicts++;
        break;
    }
  }
  return summary;
}
