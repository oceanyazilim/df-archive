/**
 * Licensor UUID extraction from an internal API response.
 *
 * The exact field is not assumed. The extractor probes an ordered list of
 * candidate paths (flat and nested) and returns the first present value. It is
 * fully defensive: missing nested fields never throw.
 *
 * Parsing is intentionally kept separate from distributor matching.
 */

import { InternalApiTrackResponse } from "./types";

/**
 * Candidate paths where the licensor UUID may live, in priority order.
 * Dotted segments denote nested object traversal.
 */
const CANDIDATE_PATHS: string[] = [
  "licensorUuid",
  "licensor_uuid",
  "licensorUUID",
  "licensor.id",
  "licensor.uuid",
  "licensorId",
  "rightsHolder.uuid",
  "rightsHolder.id",
  "owner.uuid",
  "owner.id",
  "distributor.uuid",
  // Some APIs nest the track payload one level down.
  "data.licensorUuid",
  "data.licensor.uuid",
  "data.licensor.id",
  "track.licensorUuid",
  "track.licensor.uuid",
  "track.licensor.id",
];

function getPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Extract the raw licensor UUID from the API response.
 *
 * @returns the raw (un-normalized) UUID string/number, or `null` when no
 *          candidate field is present. Normalization happens in the resolver.
 */
export function extractLicensorUuid(
  apiResponse: InternalApiTrackResponse | null | undefined,
  extraPaths: string[] = []
): string | null {
  if (apiResponse === null || apiResponse === undefined) return null;
  if (typeof apiResponse !== "object") return null;

  // Operator-configured paths (LICENSOR_API_UUID_PATHS) are tried first, then
  // the built-in candidates.
  for (const path of [...extraPaths, ...CANDIDATE_PATHS]) {
    const value = getPath(apiResponse, path);
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export type TrackMetadata = {
  title: string | null;
  artist: string | null;
  isrc: string | null;
  upc: string | null;
  releaseTitle: string | null;
  label: string | null;
  artworkUrl: string | null;
};

/** First path (from a candidate list) that resolves to a non-empty string. */
function firstString(
  apiResponse: InternalApiTrackResponse | null | undefined,
  paths: string[]
): string | null {
  for (const p of paths) {
    const v = getPath(apiResponse, p);
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Extract non-sensitive display metadata when available. These fields are for
 * display ONLY and are never used to determine the distributor. Never returns
 * credential-like fields.
 */
export function extractTrackMetadata(
  apiResponse: InternalApiTrackResponse | null | undefined
): TrackMetadata {
  return {
    title: firstString(apiResponse, [
      "title", "name", "trackTitle", "track.title", "data.title", "track.name",
    ]),
    artist: firstString(apiResponse, [
      "artist", "artistName", "artist.name", "track.artist", "data.artist", "artists.0.name",
    ]),
    isrc: firstString(apiResponse, ["isrc", "ISRC", "track.isrc", "data.isrc"]),
    upc: firstString(apiResponse, ["upc", "UPC", "release.upc", "data.upc"]),
    releaseTitle: firstString(apiResponse, [
      "releaseTitle", "release.title", "album", "album.title", "data.releaseTitle",
    ]),
    label: firstString(apiResponse, [
      "label", "labelName", "licensorName", "licensor.name", "data.label",
    ]),
    artworkUrl: firstString(apiResponse, [
      "artworkUrl", "artwork", "coverUrl", "cover.url", "image", "release.artworkUrl", "data.artworkUrl",
    ]),
  };
}

/** @deprecated retained for the standalone library; use {@link extractTrackMetadata}. */
export function extractDisplayMeta(
  apiResponse: InternalApiTrackResponse | null | undefined
): { title: string | null; artist: string | null } {
  const m = extractTrackMetadata(apiResponse);
  return { title: m.title, artist: m.artist };
}
