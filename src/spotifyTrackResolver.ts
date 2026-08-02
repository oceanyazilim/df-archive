/**
 * Full distributor resolver driven by a Spotify track URL/URI/ID.
 *
 *   Spotify input
 *     -> parse Spotify track id
 *     -> Spotify Web API: title / artist / album / artwork / external_ids.isrc  (optional, best-effort)
 *     -> local track catalog (json/tracks.json): (spotifyTrackId | ISRC) -> licensor UUID
 *     -> json/uuid's.json: licensor UUID -> distributor
 *
 * The distributor is determined ONLY by the exact licensor-UUID match. Spotify
 * label / artist / title / ISRC prefix are never used to decide the distributor.
 */

import { defaultResolverConfig, isSpotifyConfigured } from "./config";
import {
  parseSpotifyTrackId,
  getSpotifyTrack,
  extractIsrc,
  extractSpotifyMetadata,
} from "./spotify";
import {
  loadTrackCatalog,
  findUuidForTrack,
  findTrackConflict,
} from "./trackMapping";
import { resolveUuid } from "./uuidResolver";
import { InternalApiError } from "./internalApi";
import { logger } from "./logger";

export type TrackResolutionStatus =
  | "resolved"
  | "distributor_conflict"
  | "uuid_unmatched"
  | "track_not_in_catalog"
  | "track_mapping_conflict"
  | "invalid_input"
  | "spotify_error";

export type TrackResolution = {
  success: boolean;
  input: string;
  spotifyTrackId: string | null;
  trackTitle: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  isrc: string | null;
  upc: string | null;
  licensorUuid: string | null;
  distributor: string | null;
  status: TrackResolutionStatus;
  matchedBy: "spotifyTrackId" | "isrc" | null;
  spotifyMetadataAvailable: boolean;
  error: { code: string; message: string; distributors?: string[] } | null;
};

function base(input: string): TrackResolution {
  return {
    success: false,
    input,
    spotifyTrackId: null,
    trackTitle: null,
    artist: null,
    album: null,
    artworkUrl: null,
    isrc: null,
    upc: null,
    licensorUuid: null,
    distributor: null,
    status: "invalid_input",
    matchedBy: null,
    spotifyMetadataAvailable: false,
    error: null,
  };
}

/**
 * Resolve the distributor for a single Spotify track input. Never throws.
 */
export async function resolveDistributorForSpotifyTrack(
  input: string,
  signal?: AbortSignal
): Promise<TrackResolution> {
  const result = base(input);
  const cfg = defaultResolverConfig();

  // 1. Parse the Spotify track id.
  const trackId = parseSpotifyTrackId(String(input ?? ""));
  if (!trackId) {
    result.status = "invalid_input";
    result.error = {
      code: "INVALID_SPOTIFY_INPUT",
      message: "Could not parse a Spotify track id from the input (expected a track URL, URI, or 22-char id).",
    };
    return result;
  }
  result.spotifyTrackId = trackId;

  // 2. Spotify metadata + ISRC (best-effort; optional). Never blocks resolution
  //    when the track id itself is present in the local catalog.
  if (isSpotifyConfigured()) {
    try {
      const track = await getSpotifyTrack(trackId, cfg, signal);
      const meta = extractSpotifyMetadata(track.body);
      result.trackTitle = meta.title;
      result.artist = meta.artist;
      result.album = meta.releaseTitle;
      result.artworkUrl = meta.artworkUrl;
      result.upc = meta.upc;
      result.isrc = extractIsrc(track.body);
      result.spotifyMetadataAvailable = true;
    } catch (err) {
      const httpStatus = err instanceof InternalApiError ? err.httpStatus : null;
      logger.warn({
        event: "spotify_metadata_failed",
        trackId,
        httpStatus,
        errorCategory: "spotify_error",
      });
      // Keep going — the catalog may still resolve by spotify track id.
    }
  }

  // 3. Local catalog: track -> licensor UUID.
  const catalog = loadTrackCatalog();

  const conflict = findTrackConflict(catalog, trackId, result.isrc);
  if (conflict) {
    result.status = "track_mapping_conflict";
    result.error = {
      code: "TRACK_MAPPING_CONFLICT",
      message: "This track maps to multiple licensor UUIDs in the local catalog.",
      distributors: conflict.uuids,
    };
    return result;
  }

  const match = findUuidForTrack(catalog, trackId, result.isrc);
  if (!match) {
    result.status = "track_not_in_catalog";
    const spotifyNote = !isSpotifyConfigured()
      ? " Spotify is not configured, so ISRC-based matching was unavailable."
      : result.spotifyMetadataAvailable
        ? ""
        : " Spotify metadata could not be retrieved.";
    result.error = {
      code: "TRACK_UUID_NOT_FOUND",
      message:
        "No licensor UUID is known for this track. Add it to json/tracks.json (spotifyTrackId or ISRC -> licensorUuid)." +
        spotifyNote,
    };
    return result;
  }
  result.licensorUuid = match.licensorUuid;
  result.matchedBy = match.matchedBy;

  // 4. UUID -> distributor (json/uuid's.json).
  const dist = resolveUuid(match.licensorUuid);
  if (dist.matchStatus === "matched") {
    result.success = true;
    result.status = "resolved";
    result.distributor = dist.distributor;
    result.error = null;
    logger.info({
      event: "track_resolved",
      trackId,
      licensorUuid: match.licensorUuid,
      matchStatus: "resolved",
    });
  } else if (dist.matchStatus === "mapping_conflict") {
    result.status = "distributor_conflict";
    result.error = dist.error;
  } else {
    // UUID from catalog is not present in uuid's.json.
    result.status = "uuid_unmatched";
    result.error = {
      code: "UUID_NOT_FOUND",
      message: "The licensor UUID from the catalog was not found in json/uuid's.json.",
    };
  }
  return result;
}

/** Resolve many Spotify inputs, preserving order. */
export async function resolveDistributorsForSpotifyTracks(
  inputs: string[],
  signal?: AbortSignal
): Promise<TrackResolution[]> {
  // Sequential is fine here (Spotify calls are light + optional); keeps it simple
  // and avoids hammering the Spotify API.
  const out: TrackResolution[] = [];
  for (const input of inputs) {
    out.push(await resolveDistributorForSpotifyTrack(input, signal));
  }
  return out;
}
