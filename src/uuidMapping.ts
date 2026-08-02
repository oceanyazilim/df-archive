/**
 * Loads, validates, and indexes the licensor-UUID -> distributor mapping.
 *
 * Supported on-disk formats (auto-detected, file is never rewritten):
 *   1. [{ "uuid": "...", "name": "..." }]              <- the current file
 *   2. [{ "uuid": "...", "distributor": "..." }]
 *   3. [{ "licensorUuid": "...", "distributorName": "..." }]
 *   4. { "<uuid>": "<distributor>" }                   <- object map form
 *
 * Everything downstream consumes a single normalized shape via
 * {@link LicensorDistributorRecord} and the in-memory {@link Map}.
 */

import * as fs from "fs";
import { normalizeUuid } from "./normalizeUuid";
import { logger } from "./logger";
import {
  LicensorDistributorRecord,
  LoadedMapping,
  MappingConflict,
  MappingWarning,
} from "./types";

const UUID_KEYS = ["uuid", "licensorUuid", "licensor_uuid", "id"];
const DISTRIBUTOR_KEYS = ["distributor", "name", "distributorName", "distributor_name"];

function firstStringField(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== null && obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}

/**
 * Convert an arbitrary parsed JSON value into a flat list of raw
 * (uuid, distributor) pairs, detecting which of the supported shapes it is.
 */
function toRawRecords(
  parsed: unknown,
  warnings: MappingWarning[]
): Array<{ rawUuid: unknown; rawDistributor: unknown; index: number }> {
  const out: Array<{ rawUuid: unknown; rawDistributor: unknown; index: number }> = [];

  if (Array.isArray(parsed)) {
    parsed.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        warnings.push({
          code: "INVALID_RECORD",
          message: `Record at index ${index} is not an object.`,
          index,
        });
        return;
      }
      const obj = entry as Record<string, unknown>;
      out.push({
        rawUuid: firstStringField(obj, UUID_KEYS),
        rawDistributor: firstStringField(obj, DISTRIBUTOR_KEYS),
        index,
      });
    });
    return out;
  }

  if (parsed !== null && typeof parsed === "object") {
    // Object-map form: { "<uuid>": "<distributor>" }
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value], index) => {
      out.push({ rawUuid: key, rawDistributor: value, index });
    });
    return out;
  }

  throw new Error("UUID mapping file must contain a JSON array or object.");
}

/**
 * Parse + validate raw JSON text into a normalized, indexed mapping.
 * Exposed separately from disk I/O so it is unit-testable.
 */
export function buildMappingFromJson(jsonText: string): LoadedMapping {
  const trimmed = jsonText.trim();
  if (trimmed.length === 0) {
    throw new Error("UUID mapping file is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `UUID mapping file contains invalid JSON: ${(err as Error).message}`
    );
  }

  const warnings: MappingWarning[] = [];
  const rawRecords = toRawRecords(parsed, warnings);

  // uuid -> set of distinct distributor names seen for that uuid
  const distributorsByUuid = new Map<string, Set<string>>();

  for (const { rawUuid, rawDistributor, index } of rawRecords) {
    const uuid = normalizeUuid(rawUuid);
    const distributor =
      rawDistributor === null || rawDistributor === undefined
        ? ""
        : String(rawDistributor).trim();

    if (uuid === null) {
      warnings.push({
        code: "MISSING_UUID",
        message: `Record at index ${index} has a missing or empty UUID.`,
        index,
      });
      continue;
    }
    if (distributor.length === 0) {
      warnings.push({
        code: "MISSING_DISTRIBUTOR",
        message: `Record for UUID ${uuid} has a missing distributor name.`,
        uuid,
        index,
      });
      continue;
    }

    let set = distributorsByUuid.get(uuid);
    if (!set) {
      set = new Set<string>();
      distributorsByUuid.set(uuid, set);
    }
    if (set.has(distributor)) {
      warnings.push({
        code: "DUPLICATE_UUID_SAME_DISTRIBUTOR",
        message: `UUID ${uuid} appears multiple times mapping to "${distributor}".`,
        uuid,
      });
    }
    set.add(distributor);
  }

  const distributorByUuid = new Map<string, string>();
  const conflicts: MappingConflict[] = [];

  for (const [uuid, set] of distributorsByUuid) {
    const distributors = [...set];
    if (distributors.length === 1) {
      distributorByUuid.set(uuid, distributors[0]);
    } else {
      // Same UUID -> different distributors. Never guess; record a conflict and
      // exclude the UUID from the lookup map so it resolves as a conflict later.
      conflicts.push({
        code: "UUID_MAPPING_CONFLICT",
        uuid,
        distributors,
      });
    }
  }

  return {
    distributorByUuid,
    conflicts,
    warnings,
    recordCount: distributorByUuid.size,
    totalRecords: rawRecords.length,
  };
}

/** Normalized record view, primarily for callers that want the array form. */
export function toRecordList(mapping: LoadedMapping): LicensorDistributorRecord[] {
  return [...mapping.distributorByUuid.entries()].map(([uuid, distributor]) => ({
    uuid,
    distributor,
  }));
}

/**
 * Caches the loaded mapping keyed by absolute file path + mtime so repeated
 * loads are cheap but a changed file is automatically picked up.
 */
type CacheEntry = { mtimeMs: number; mapping: LoadedMapping; loadedAt: string };
const fileCache = new Map<string, CacheEntry>();

/** ISO timestamp of the most recent actual (non-cached) load, per path. */
export function getMappingLoadedAt(path: string): string | null {
  return fileCache.get(path)?.loadedAt ?? null;
}

/**
 * Load (and validate) the UUID mapping from disk.
 *
 * @param path      absolute path to the mapping file
 * @param forceRefresh  bypass the in-memory cache (manual refresh / hot reload)
 */
export function loadUuidMapping(path: string, forceRefresh = false): LoadedMapping {
  const stat = fs.statSync(path);
  const cached = fileCache.get(path);
  if (!forceRefresh && cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.mapping;
  }

  const text = fs.readFileSync(path, "utf8");
  const mapping = buildMappingFromJson(text);
  fileCache.set(path, {
    mtimeMs: stat.mtimeMs,
    mapping,
    loadedAt: new Date().toISOString(),
  });

  logger.info({
    event: "uuid_mapping_loaded",
    // recordCount / conflict counts are non-sensitive operational metrics.
    matchStatus: `records=${mapping.recordCount};conflicts=${mapping.conflicts.length};warnings=${mapping.warnings.length}`,
  });
  for (const conflict of mapping.conflicts) {
    logger.warn({
      event: "uuid_mapping_conflict",
      licensorUuid: conflict.uuid,
      errorCategory: "UUID_MAPPING_CONFLICT",
      matchStatus: conflict.distributors.join(" | "),
    });
  }

  return mapping;
}

/** Clears the in-memory file cache (e.g. for tests or forced reload). */
export function clearMappingCache(): void {
  fileCache.clear();
}

/**
 * Look up a distributor for an already-normalized UUID.
 * Returns `undefined` when the UUID is not present in the mapping.
 */
export function findDistributorByUuid(
  mapping: LoadedMapping,
  normalizedUuid: string
): string | undefined {
  return mapping.distributorByUuid.get(normalizedUuid);
}

/** Returns the conflict record for a UUID, if one exists. */
export function findConflictByUuid(
  mapping: LoadedMapping,
  normalizedUuid: string
): MappingConflict | undefined {
  return mapping.conflicts.find((c) => c.uuid === normalizedUuid);
}
