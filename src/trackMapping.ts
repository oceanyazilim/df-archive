/**
 * Local track catalog loader: (Spotify track id | ISRC) -> licensor UUID.
 *
 * This is the authorized track-to-UUID source for local resolution. It is
 * SEPARATE from json/uuid's.json (which is UUID -> distributor). Matching is
 * exact after normalization; a track key mapped to two different UUIDs is a
 * conflict and is never silently resolved.
 *
 * File shape (json/tracks.json):
 *   [{ "spotifyTrackId": "...", "isrc": "...", "licensorUuid": "..." }]
 * Each record may provide spotifyTrackId, isrc, or both.
 */

import * as fs from "fs";
import { normalizeUuid } from "./normalizeUuid";
import { TRACKS_MAPPING_PATH } from "./config";
import { logger } from "./logger";

/** Spotify track ids are case-sensitive base62: trim + unquote, preserve case. */
export function normalizeSpotifyTrackId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return /^[A-Za-z0-9]{22}$/.test(v) ? v : null;
}

/** ISRCs are case-insensitive: uppercase, strip hyphens/whitespace. */
export function normalizeIsrc(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  v = v.replace(/[-\s]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(v) ? v : null;
}

export type TrackCatalog = {
  /** normalized spotify track id -> licensor UUID */
  uuidBySpotifyId: Map<string, string>;
  /** normalized ISRC -> licensor UUID */
  uuidByIsrc: Map<string, string>;
  totalRecords: number;
  validRecords: number;
  conflicts: { key: string; keyType: "spotifyTrackId" | "isrc"; uuids: string[] }[];
  warnings: string[];
};

export function buildTrackCatalogFromJson(jsonText: string): TrackCatalog {
  const trimmed = jsonText.trim();
  if (trimmed.length === 0) throw new Error("Track catalog file is empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Track catalog contains invalid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Track catalog must be a JSON array of records.");
  }

  const warnings: string[] = [];
  // key -> set of distinct UUIDs seen, per key space.
  const bySpotify = new Map<string, Set<string>>();
  const byIsrc = new Map<string, Set<string>>();
  let validRecords = 0;

  parsed.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`Record ${index} is not an object.`);
      return;
    }
    const obj = entry as Record<string, unknown>;
    const uuid = normalizeUuid(obj.licensorUuid ?? obj.uuid);
    if (uuid === null) {
      warnings.push(`Record ${index} has a missing/invalid licensorUuid.`);
      return;
    }
    const sid = normalizeSpotifyTrackId(obj.spotifyTrackId ?? obj.trackId);
    const isrc = normalizeIsrc(obj.isrc);
    if (!sid && !isrc) {
      warnings.push(`Record ${index} has neither a valid spotifyTrackId nor isrc.`);
      return;
    }
    if (sid) {
      if (!bySpotify.has(sid)) bySpotify.set(sid, new Set());
      bySpotify.get(sid)!.add(uuid);
    }
    if (isrc) {
      if (!byIsrc.has(isrc)) byIsrc.set(isrc, new Set());
      byIsrc.get(isrc)!.add(uuid);
    }
    validRecords++;
  });

  const conflicts: TrackCatalog["conflicts"] = [];
  const uuidBySpotifyId = new Map<string, string>();
  for (const [key, set] of bySpotify) {
    if (set.size === 1) uuidBySpotifyId.set(key, [...set][0]);
    else conflicts.push({ key, keyType: "spotifyTrackId", uuids: [...set] });
  }
  const uuidByIsrc = new Map<string, string>();
  for (const [key, set] of byIsrc) {
    if (set.size === 1) uuidByIsrc.set(key, [...set][0]);
    else conflicts.push({ key, keyType: "isrc", uuids: [...set] });
  }

  return {
    uuidBySpotifyId,
    uuidByIsrc,
    totalRecords: parsed.length,
    validRecords,
    conflicts,
    warnings,
  };
}

type CacheEntry = { mtimeMs: number; catalog: TrackCatalog; loadedAt: string };
const fileCache = new Map<string, CacheEntry>();

/** Load the track catalog. Returns null if the file does not exist (optional). */
export function loadTrackCatalog(
  path = TRACKS_MAPPING_PATH,
  forceRefresh = false
): TrackCatalog | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    return null; // Optional file — absence is not an error.
  }
  const cached = fileCache.get(path);
  if (!forceRefresh && cached && cached.mtimeMs === stat.mtimeMs) return cached.catalog;

  const catalog = buildTrackCatalogFromJson(fs.readFileSync(path, "utf8"));
  fileCache.set(path, { mtimeMs: stat.mtimeMs, catalog, loadedAt: new Date().toISOString() });
  logger.info({
    event: "track_catalog_loaded",
    matchStatus: `valid=${catalog.validRecords};conflicts=${catalog.conflicts.length}`,
  });
  return catalog;
}

export function getTrackCatalogLoadedAt(path = TRACKS_MAPPING_PATH): string | null {
  return fileCache.get(path)?.loadedAt ?? null;
}

export type TrackUuidMatch = {
  licensorUuid: string;
  matchedBy: "spotifyTrackId" | "isrc";
} | null;

/** Resolve a licensor UUID from the catalog by Spotify id first, then ISRC. */
export function findUuidForTrack(
  catalog: TrackCatalog | null,
  spotifyTrackId: string | null,
  isrc: string | null
): TrackUuidMatch {
  if (!catalog) return null;
  if (spotifyTrackId) {
    const sid = normalizeSpotifyTrackId(spotifyTrackId);
    if (sid) {
      const uuid = catalog.uuidBySpotifyId.get(sid);
      if (uuid) return { licensorUuid: uuid, matchedBy: "spotifyTrackId" };
    }
  }
  if (isrc) {
    const norm = normalizeIsrc(isrc);
    if (norm) {
      const uuid = catalog.uuidByIsrc.get(norm);
      if (uuid) return { licensorUuid: uuid, matchedBy: "isrc" };
    }
  }
  return null;
}

/** Is a track key in a conflicting state in the catalog? */
export function findTrackConflict(
  catalog: TrackCatalog | null,
  spotifyTrackId: string | null,
  isrc: string | null
) {
  if (!catalog) return undefined;
  const sid = normalizeSpotifyTrackId(spotifyTrackId ?? "");
  const norm = normalizeIsrc(isrc ?? "");
  return catalog.conflicts.find(
    (c) => (c.keyType === "spotifyTrackId" && c.key === sid) || (c.keyType === "isrc" && c.key === norm)
  );
}

/** Non-sensitive catalog status. */
export function trackCatalogStatus(path = TRACKS_MAPPING_PATH) {
  try {
    const catalog = loadTrackCatalog(path);
    if (!catalog) {
      return {
        loaded: false,
        filePath: "json/tracks.json",
        totalRecords: 0,
        validRecords: 0,
        conflicts: 0,
        spotifyIdMappings: 0,
        isrcMappings: 0,
        lastLoadedAt: null,
      };
    }
    return {
      loaded: true,
      filePath: "json/tracks.json",
      totalRecords: catalog.totalRecords,
      validRecords: catalog.validRecords,
      conflicts: catalog.conflicts.length,
      spotifyIdMappings: catalog.uuidBySpotifyId.size,
      isrcMappings: catalog.uuidByIsrc.size,
      lastLoadedAt: getTrackCatalogLoadedAt(path),
    };
  } catch (err) {
    return {
      loaded: false,
      filePath: "json/tracks.json",
      totalRecords: 0,
      validRecords: 0,
      conflicts: 0,
      spotifyIdMappings: 0,
      isrcMappings: 0,
      lastLoadedAt: null,
      error: (err as Error).message,
    };
  }
}

/** True when the catalog file loads with at least one usable mapping. */
export function isTrackCatalogAvailable(path = TRACKS_MAPPING_PATH): boolean {
  try {
    const c = loadTrackCatalog(path);
    return !!c && c.validRecords > 0;
  } catch {
    return false;
  }
}
