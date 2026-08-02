/**
 * Demo upstream provider — exercises the full Spotify -> ISRC -> licensor -> UUID
 * flow with deterministic mock data (no network). Enabled only via DEMO_MODE.
 * The licensor UUIDs below are real entries from json/uuid's.json so lookups
 * produce genuine matches, plus edge cases.
 */

import { LicensorResolution, LicensorUuidProvider, TrackIdentifier } from "../types";
import { parseSpotifyTrackId } from "../spotify";
import { InternalApiError } from "../internalApi";

type DemoEntry = {
  isrc: string | null;
  licensorUuid: string | null;
  title: string;
  artist: string;
  releaseTitle?: string;
  label?: string;
};

/** Demo inputs may be given as a bare key, a Spotify-style URL, or an ISRC. */
const DEMO: Record<string, DemoEntry> = {
  "demo-tunecore": {
    isrc: "US1234500001", licensorUuid: "a830a34f35844bd784eac9a7fb395996",
    title: "Neon Skyline", artist: "Aurora Vale", releaseTitle: "Skyline EP", label: "Vale Records",
  },
  "demo-distrokid": {
    isrc: "GBX9Y2100002", licensorUuid: "18fbcef4fb624fc58d4a7fdd230bd523",
    title: "Midnight Static", artist: "The Paper Kites",
  },
  "demo-orchard": {
    isrc: "USABC2100003", licensorUuid: "ede63b46782e46e19045255f32c0ff0f",
    title: "Golden Hour", artist: "Marisol",
  },
  "demo-unknown": {
    isrc: "QZTEST2100004", licensorUuid: "deadbeefdeadbeefdeadbeefdeadbeef",
    title: "Ghost Frequency", artist: "Unknown Signal",
  },
  "demo-missing": {
    isrc: null, licensorUuid: null, // Spotify returns no ISRC
    title: "No ISRC Attached", artist: "Orphan Track",
  },
  "demo-conflict": {
    isrc: "USCON2100006", licensorUuid: "60315a5bfaa04520a1ee142e2df5b8ca",
    title: "Disputed Ownership", artist: "Two Owners",
  },
};

/** Map several demo id forms (bare, spotify url/uri) to a demo key. */
function resolveDemoKey(identifier: TrackIdentifier): string | null {
  const raw = identifier.value.trim().toLowerCase();
  if (DEMO[raw]) return raw;
  // Allow a spotify url whose id contains a demo key fragment is overkill;
  // instead accept "demo-*" appearing anywhere in the input.
  const m = raw.match(/demo-[a-z]+/);
  if (m && DEMO[m[0]]) return m[0];
  return null;
}

export const demoProvider: LicensorUuidProvider = {
  async resolve(identifier: TrackIdentifier): Promise<LicensorResolution> {
    if (identifier.value.trim() === "demo-error") {
      throw new InternalApiError("Simulated upstream failure.", 503, true);
    }

    // ISRC-typed demo input: find the entry by ISRC.
    if (identifier.type === "isrc") {
      const entry = Object.values(DEMO).find(
        (e) => e.isrc && e.isrc.toUpperCase() === identifier.value.trim().toUpperCase()
      );
      if (!entry) throw new InternalApiError("Unknown demo ISRC (HTTP 404).", 404, false);
      return {
        licensorUuid: entry.licensorUuid,
        metadata: {
          title: entry.title, artist: entry.artist, isrc: entry.isrc,
          upc: null, releaseTitle: entry.releaseTitle ?? null,
          label: entry.label ?? null, artworkUrl: null,
        },
        httpStatus: 200,
        attempts: 1,
        isrc: entry.isrc,
      };
    }

    const key = resolveDemoKey(identifier);
    if (!key) {
      // Unknown spotify id -> simulate a 404 from Spotify.
      throw new InternalApiError("Unknown demo track (HTTP 404).", 404, false);
    }
    const entry = DEMO[key];
    const spotifyTrackId = parseSpotifyTrackId(identifier.value) ?? key;
    return {
      licensorUuid: entry.licensorUuid,
      metadata: {
        title: entry.title, artist: entry.artist, isrc: entry.isrc,
        upc: null, releaseTitle: entry.releaseTitle ?? null,
        label: entry.label ?? null, artworkUrl: null,
      },
      httpStatus: 200,
      attempts: 1,
      spotifyTrackId,
      isrc: entry.isrc,
    };
  },
};

export const DEMO_SAMPLE_INPUTS = [
  "demo-tunecore",
  "demo-distrokid",
  "demo-orchard",
  "demo-unknown",
  "demo-missing",
  "demo-conflict",
  "demo-error",
];
