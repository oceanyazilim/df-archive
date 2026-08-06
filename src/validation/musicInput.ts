/**
 * parseMusicLookupInput — detects and normalizes the supported lookup inputs:
 * Spotify track / album / artist (URL, URI or bare id), ISRC, UPC, or a
 * Soundcharts song UUID. Rejects playlist/episode/show URLs and malformed
 * values.
 *
 * UPC vs ISRC: an ISRC is 2 letters + 3 alphanumerics + 7 digits, a UPC/EAN is
 * 12–14 digits only, so the two never collide.
 */

import { extractSpotifyTrackId } from "../spotifyMetadata";

export type MusicInputType =
  | "spotify_track" | "spotify_album" | "spotify_artist" | "spotify_playlist"
  | "isrc" | "upc" | "soundcharts_song_uuid" | "invalid";
export type ParsedMusicInput = {
  type: MusicInputType;
  normalizedValue: string;
  originalValue: string;
  reason?: string;
};

const MAX_LEN = 512;
const ISRC_RE = /^[A-Za-z]{2}[A-Za-z0-9]{3}[0-9]{7}$/;
/** UPC-A (12), EAN-13, or 14-digit GTIN — barcodes are digits only. */
const UPC_RE = /^[0-9]{12,14}$/;
const UUID_HYPHEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_HEX32_RE = /^[0-9a-f]{32}$/i;

function invalid(originalValue: string, reason: string): ParsedMusicInput {
  return { type: "invalid", normalizedValue: "", originalValue, reason };
}

/** Extract a Spotify ALBUM id from a URL/URI. Query params + intl paths handled. */
export function extractSpotifyAlbumId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  const uri = v.match(/^spotify:album:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
      const m = url.pathname.match(/\/album\/([A-Za-z0-9]{22})(?:\/|$)/);
      return m ? m[1] : null;
    } catch { return null; }
  }
  return null;
}

/** Extract a Spotify PLAYLIST id from a URL/URI. Query params + intl paths handled. */
export function extractSpotifyPlaylistId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  const uri = v.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
      const m = url.pathname.match(/\/playlist\/([A-Za-z0-9]{22})(?:\/|$)/);
      return m ? m[1] : null;
    } catch { return null; }
  }
  return null;
}

/** Extract a Spotify ARTIST id from a URL/URI. Query params + intl paths handled. */
export function extractSpotifyArtistId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const v = String(input).trim();
  const uri = v.match(/^spotify:artist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;
      const m = url.pathname.match(/\/artist\/([A-Za-z0-9]{22})(?:\/|$)/);
      return m ? m[1] : null;
    } catch { return null; }
  }
  return null;
}

export function parseMusicLookupInput(input: unknown): ParsedMusicInput {
  if (typeof input !== "string") return invalid(String(input ?? ""), "Input must be a string.");
  const raw = input.trim();
  if (!raw) return invalid(raw, "Empty input.");
  if (raw.length > MAX_LEN) return invalid(raw.slice(0, 64) + "…", "Input is too long.");

  // Spotify ALBUM (URL / URI) — supported; must be checked before rejection.
  const albumId = extractSpotifyAlbumId(raw);
  if (albumId) return { type: "spotify_album", normalizedValue: albumId, originalValue: raw };

  // Spotify ARTIST (URL / URI) — opens the full catalog view.
  const artistId = extractSpotifyArtistId(raw);
  if (artistId) return { type: "spotify_artist", normalizedValue: artistId, originalValue: raw };

  // Spotify PLAYLIST (URL / URI) — opens the playlist catalog view (admin-only).
  const playlistId = extractSpotifyPlaylistId(raw);
  if (playlistId) return { type: "spotify_playlist", normalizedValue: playlistId, originalValue: raw };

  // Reject the resource types we genuinely cannot analyze.
  if (/^spotify:(episode|show|user):/i.test(raw)) return invalid(raw, "Supported: Spotify track, album, artist or playlist.");
  if (/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(episode|show)\//i.test(raw)) {
    return invalid(raw, "Supported: Spotify track, album, artist or playlist.");
  }

  // Spotify track (URL / URI / bare id) — handles localized paths + ?si=.
  const spotifyId = extractSpotifyTrackId(raw);
  if (spotifyId) return { type: "spotify_track", normalizedValue: spotifyId, originalValue: raw };

  // ISRC (strip spaces/hyphens, uppercase).
  const isrcCandidate = raw.replace(/[-\s]/g, "").toUpperCase();
  if (ISRC_RE.test(isrcCandidate)) return { type: "isrc", normalizedValue: isrcCandidate, originalValue: raw };

  // UPC / EAN barcode — digits only, so it cannot be confused with an ISRC.
  const upcCandidate = raw.replace(/[-\s]/g, "");
  if (UPC_RE.test(upcCandidate)) return { type: "upc", normalizedValue: upcCandidate, originalValue: raw };

  // Soundcharts song UUID (hyphenated or bare 32-hex).
  if (UUID_HYPHEN_RE.test(raw)) return { type: "soundcharts_song_uuid", normalizedValue: raw.toLowerCase(), originalValue: raw };
  if (UUID_HEX32_RE.test(raw)) return { type: "soundcharts_song_uuid", normalizedValue: raw.toLowerCase(), originalValue: raw };

  return invalid(raw, "Unrecognized input. Provide a Spotify track, album or artist URL/URI, an ISRC, a UPC, or a Soundcharts song UUID.");
}
