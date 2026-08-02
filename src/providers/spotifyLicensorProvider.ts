/**
 * Live upstream provider implementing the required workflow:
 *
 *   Spotify URL/ID  -> official Spotify Web API -> external_ids.isrc
 *   ISRC            -> authorized licensor API  -> licensor UUID
 *
 * A bare ISRC input skips the Spotify stage. Spotify metadata (title, artist,
 * album, label) is carried for DISPLAY ONLY and never used for matching.
 */

import { LicensorResolution, LicensorUuidProvider, TrackIdentifier } from "../types";
import { LICENSOR_API, ResolverConfig } from "../config";
import { InvalidIdentifierError } from "../errors";
import { extractLicensorUuid } from "../extractLicensorUuid";
import {
  extractIsrc,
  extractSpotifyMetadata,
  getSpotifyTrack,
  parseSpotifyTrackId,
} from "../spotify";
import { lookupLicensorByIsrc } from "../licensorApi";
import { TrackMetadataFields } from "../types";

const EMPTY_META: TrackMetadataFields = {
  title: null, artist: null, isrc: null, upc: null,
  releaseTitle: null, label: null, artworkUrl: null,
};

const ISRC_RE = /^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/;

function normalizeIsrc(raw: string): string | null {
  const v = raw.replace(/[-\s]/g, "").toUpperCase();
  return ISRC_RE.test(v) ? v : null;
}

export function createSpotifyLicensorProvider(cfg: ResolverConfig): LicensorUuidProvider {
  return {
    async resolve(identifier: TrackIdentifier, signal?: AbortSignal): Promise<LicensorResolution> {
      let isrc: string | null;
      let metadata: TrackMetadataFields = { ...EMPTY_META };
      let spotifyTrackId: string | null = null;
      let attempts = 0;
      let lastStatus: number | null = null;

      if (identifier.type === "isrc") {
        // Direct ISRC input: skip Spotify, go straight to the licensor API.
        isrc = normalizeIsrc(identifier.value);
        if (!isrc) {
          throw new InvalidIdentifierError("The provided value is not a valid ISRC.");
        }
        metadata = { ...EMPTY_META, isrc };
      } else {
        // Spotify URL / URI / id -> official Web API -> ISRC.
        spotifyTrackId = parseSpotifyTrackId(identifier.value);
        if (!spotifyTrackId) {
          throw new InvalidIdentifierError(
            "Could not parse a Spotify track id from the input."
          );
        }
        const spotify = await getSpotifyTrack(spotifyTrackId, cfg, signal);
        attempts += spotify.attempts;
        lastStatus = spotify.status;
        metadata = extractSpotifyMetadata(spotify.body);
        isrc = extractIsrc(spotify.body);
        if (!isrc) {
          // Spotify succeeded but no ISRC -> cannot reach the licensor UUID.
          return {
            licensorUuid: null,
            metadata,
            httpStatus: lastStatus,
            attempts,
            spotifyTrackId,
            isrc: null,
          };
        }
      }

      // ISRC -> authorized licensor API -> licensor UUID.
      const licensor = await lookupLicensorByIsrc(isrc, cfg, signal);
      attempts += licensor.attempts;
      lastStatus = licensor.status;
      const licensorUuid = extractLicensorUuid(licensor.body, LICENSOR_API.uuidPaths);

      return {
        licensorUuid,
        metadata: { ...metadata, isrc },
        httpStatus: lastStatus,
        attempts,
        spotifyTrackId,
        isrc,
      };
    },
  };
}
