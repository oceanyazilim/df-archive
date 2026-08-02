/**
 * THE canonical distributor-UUID normalizer + resolver. One source of truth.
 *
 * A licensor/distributor UUID is a normalized 32-char hex value. The stored
 * distributor `name` is returned EXACTLY as in json/uuid's.json — never
 * re-cased, shortened, translated, fuzzy-matched, or merged with any other
 * source. Only a valid 32-hex UUID is ever looked up in the local mapping.
 */

import { loadUuidMapping, findDistributorByUuid, findConflictByUuid, getMappingLoadedAt } from "../uuidMapping";
import { getAppConfig } from "../soundcharts/config";

const HEX32 = /^[a-f0-9]{32}$/;

/** Normalize to canonical 32-hex, or null. Trim, unquote, lowercase, de-hyphen. */
export function normalizeDistributorUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let v = String(value).trim();
  if (v.length >= 2) {
    const f = v[0], l = v[v.length - 1];
    if ((f === '"' && l === '"') || (f === "'" && l === "'")) v = v.slice(1, -1).trim();
  }
  v = v.toLowerCase().replace(/-/g, "");
  return HEX32.test(v) ? v : null;
}

export type DistributorUuidResolution = {
  inputUuid: string;
  normalizedUuid: string | null;
  matched: boolean;
  name: string | null;
  matchType: "exact" | "none" | "invalid" | "conflict";
  source: "local_uuid_mapping";
  conflictNames?: string[];
};

/**
 * Resolve a UUID against the canonical local mapping. Exact match only.
 * The `name` returned is the exact stored `record.name` (unmodified).
 */
export function resolveDistributorByUuid(rawUuid: unknown): DistributorUuidResolution {
  const inputUuid = rawUuid === null || rawUuid === undefined ? "" : String(rawUuid);
  const normalizedUuid = normalizeDistributorUuid(rawUuid);
  const base = { inputUuid, normalizedUuid, source: "local_uuid_mapping" as const };

  if (normalizedUuid === null) return { ...base, matched: false, name: null, matchType: "invalid" };

  const mapping = loadUuidMapping(getAppConfig().uuidMappingPath);
  const conflict = findConflictByUuid(mapping, normalizedUuid);
  if (conflict) return { ...base, matched: false, name: null, matchType: "conflict", conflictNames: conflict.distributors };

  const name = findDistributorByUuid(mapping, normalizedUuid);
  if (name === undefined) return { ...base, matched: false, name: null, matchType: "none" };

  // Exact stored name — returned verbatim.
  return { ...base, matched: true, name, matchType: "exact" };
}

/** Safe mapping health (never dumps the full list). */
export function distributorMappingHealth() {
  const path = getAppConfig().uuidMappingPath;
  try {
    const m = loadUuidMapping(path);
    const duplicates = m.warnings.filter((w) => w.code === "DUPLICATE_UUID_SAME_DISTRIBUTOR").length;
    return {
      loaded: true,
      filePath: "json/uuid's.json",
      totalRecords: m.totalRecords,
      validRecords: m.recordCount,
      duplicateRecords: duplicates,
      conflicts: m.conflicts.length,
      conflictDetails: m.conflicts.map((c) => ({ uuid: c.uuid, distributors: c.distributors })),
      lastLoadedAt: getMappingLoadedAt(path),
    };
  } catch (err) {
    return { loaded: false, filePath: "json/uuid's.json", totalRecords: 0, validRecords: 0, duplicateRecords: 0, conflicts: 0, conflictDetails: [], lastLoadedAt: null, error: (err as Error).message };
  }
}

/** Dev-only resolver diagnostics (never exposed in production routes). */
export function resolverDebug(rawUuid: unknown) {
  const m = loadUuidMapping(getAppConfig().uuidMappingPath);
  const normalizedUuid = normalizeDistributorUuid(rawUuid);
  return {
    receivedUuid: rawUuid === null || rawUuid === undefined ? null : String(rawUuid),
    normalizedUuid,
    mappingLoaded: true,
    mappingCount: m.recordCount,
    exactMatch: normalizedUuid ? findDistributorByUuid(m, normalizedUuid) !== undefined : false,
    matchedName: normalizedUuid ? findDistributorByUuid(m, normalizedUuid) ?? null : null,
  };
}
