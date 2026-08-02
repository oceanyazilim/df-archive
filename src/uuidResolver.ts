/**
 * Local licensor-UUID -> distributor resolution service.
 *
 * This is the project's licensor resolution API: it resolves a distributor name
 * directly from the local mapping file (json/uuid's.json) with NO external API.
 * Matching is exact after normalization; the distributor is never guessed.
 */

import { UUID_MAPPING_PATH } from "./config";
import {
  loadUuidMapping,
  findDistributorByUuid,
  findConflictByUuid,
  getMappingLoadedAt,
} from "./uuidMapping";
import { normalizeUuid } from "./normalizeUuid";

export type UuidMatchStatus = "matched" | "unmatched" | "mapping_conflict" | "invalid";

export type UuidLookupResult = {
  success: boolean;
  licensorUuid: string | null;
  distributor: string | null;
  matchStatus: UuidMatchStatus;
  error: {
    code: string;
    message: string;
    distributors?: string[];
  } | null;
};

export type UuidBatchSummary = {
  total: number;
  matched: number;
  unmatched: number;
  conflicts: number;
  invalid: number;
};

export type UuidBatchResult = {
  summary: UuidBatchSummary;
  results: UuidLookupResult[];
};

/** Resolve a single raw UUID value against the local mapping. Never throws. */
export function resolveUuid(rawUuid: unknown, mappingPath = UUID_MAPPING_PATH): UuidLookupResult {
  const normalized = normalizeUuid(rawUuid);

  if (normalized === null) {
    return {
      success: false,
      licensorUuid: null,
      distributor: null,
      matchStatus: "invalid",
      error: {
        code: "INVALID_UUID",
        message: "The provided value is empty or not a valid UUID.",
      },
    };
  }

  const mapping = loadUuidMapping(mappingPath);

  // Conflict takes precedence — never silently pick one distributor.
  const conflict = findConflictByUuid(mapping, normalized);
  if (conflict) {
    return {
      success: false,
      licensorUuid: normalized,
      distributor: null,
      matchStatus: "mapping_conflict",
      error: {
        code: "UUID_MAPPING_CONFLICT",
        message: "This UUID is assigned to multiple distributor names.",
        distributors: conflict.distributors,
      },
    };
  }

  const distributor = findDistributorByUuid(mapping, normalized);
  if (distributor === undefined) {
    return {
      success: false,
      licensorUuid: normalized,
      distributor: null,
      matchStatus: "unmatched",
      error: {
        code: "UUID_NOT_FOUND",
        message: "The UUID was not found in the local distributor mapping.",
      },
    };
  }

  return {
    success: true,
    licensorUuid: normalized,
    distributor,
    matchStatus: "matched",
    error: null,
  };
}

/** Resolve many UUIDs at once, preserving order and returning a summary. */
export function resolveUuidBatch(
  rawUuids: unknown[],
  mappingPath = UUID_MAPPING_PATH
): UuidBatchResult {
  const results = rawUuids.map((u) => resolveUuid(u, mappingPath));
  const summary: UuidBatchSummary = {
    total: results.length,
    matched: 0,
    unmatched: 0,
    conflicts: 0,
    invalid: 0,
  };
  for (const r of results) {
    if (r.matchStatus === "matched") summary.matched++;
    else if (r.matchStatus === "unmatched") summary.unmatched++;
    else if (r.matchStatus === "mapping_conflict") summary.conflicts++;
    else if (r.matchStatus === "invalid") summary.invalid++;
  }
  return { summary, results };
}

/** Force a reload of the mapping file (manual refresh / hot reload). */
export function reloadUuidMapping(mappingPath = UUID_MAPPING_PATH) {
  return loadUuidMapping(mappingPath, true);
}

/** Non-sensitive mapping status (never exposes the full list). */
export function uuidMappingStatus(mappingPath = UUID_MAPPING_PATH) {
  try {
    const mapping = loadUuidMapping(mappingPath);
    const duplicateRecords = mapping.warnings.filter(
      (w) => w.code === "DUPLICATE_UUID_SAME_DISTRIBUTOR"
    ).length;
    return {
      loaded: true,
      filePath: "json/uuid's.json",
      totalRecords: mapping.totalRecords,
      validMappings: mapping.recordCount,
      duplicateRecords,
      conflicts: mapping.conflicts.length,
      conflictDetails: mapping.conflicts.map((c) => ({
        uuid: c.uuid,
        distributors: c.distributors,
      })),
      lastLoadedAt: getMappingLoadedAt(mappingPath),
    };
  } catch (err) {
    return {
      loaded: false,
      filePath: "json/uuid's.json",
      totalRecords: 0,
      validMappings: 0,
      duplicateRecords: 0,
      conflicts: 0,
      conflictDetails: [] as { uuid: string; distributors: string[] }[],
      lastLoadedAt: null,
      error: (err as Error).message,
    };
  }
}
