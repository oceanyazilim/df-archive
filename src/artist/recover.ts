/**
 * Removed-track recovery.
 *
 * A track that is no longer on the artist's Spotify profile arrives from the
 * Soundcharts history with only a uuid, a title, and (sometimes) an ISRC.
 * This service recovers the identifiers a "removed" release needs to be as
 * complete as a live one:
 *
 *   ISRC / UPC / label  — Soundcharts song metadata + song albums.
 *   Spotify track id    — Soundcharts platform identifiers, or a Spotify
 *                         catalogue search by ISRC (re-releases under a new id
 *                         still match on the recording).
 *
 * With a Spotify id recovered, the normal connector pipeline resolves the
 * distributor exactly like any live track. Soundcharts itself is NEVER used as
 * a distributor source (see src/soundcharts/types.ts) — it only supplies
 * public identifiers here.
 */

import { defaultResolverConfig } from "../config";
import { findTrackByIsrc, getSpotifyAlbum } from "../spotify";
import { isSoundchartsConfigured } from "../soundcharts/config";
import { getSongMetadata, getSongIdentifiers, getSongAlbums } from "../soundcharts/song";
import { logger } from "../logger";

export type RecoveredTrack = {
  soundchartsSongUuid: string;
  spotifyTrackId: string | null;
  spotifyAlbumId: string | null;
  isrc: string | null;
  upc: string | null;
  albumTitle: string | null;
  label: string | null;
  releaseDate: string | null;
  /** Which sources actually produced identifiers — honest UI reporting. */
  sources: string[];
};

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A Soundcharts identifier row may carry the raw id or only a platform URL. */
function spotifyIdFromIdentifier(identifier: string | null, url: string | null): string | null {
  if (identifier && SPOTIFY_ID_RE.test(identifier)) return identifier;
  const m = url?.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

export async function recoverRemovedTrack(songUuid: string, knownIsrc?: string | null): Promise<RecoveredTrack> {
  if (!isSoundchartsConfigured()) throw new Error("Analytics are not configured on the server.");

  const out: RecoveredTrack = {
    soundchartsSongUuid: songUuid,
    spotifyTrackId: null,
    spotifyAlbumId: null,
    isrc: null,
    upc: null,
    albumTitle: null,
    label: null,
    releaseDate: null,
    sources: [],
  };

  // The three Soundcharts reads are independent but run SEQUENTIALLY: firing
  // them together trips Soundcharts' per-account rate limit and parks pool
  // slots for nothing (observed: 3 parallel calls → 3 slots cooling down).
  // Individual failures are tolerated — a song with no album entry is normal.
  const settle = async <T>(p: Promise<T>): Promise<PromiseSettledResult<T>> =>
    p.then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason }));
  const meta = await settle(getSongMetadata(songUuid));
  const ids = await settle(getSongIdentifiers(songUuid));
  const albums = await settle(getSongAlbums(songUuid));

  if (meta.status === "fulfilled" && meta.value) {
    out.isrc = str(meta.value.isrc)?.toUpperCase() ?? null;
    out.label = str(meta.value.label);
    out.releaseDate = str(meta.value.releaseDate);
    if (out.isrc || out.label) out.sources.push("soundcharts_metadata");
  }
  // The artist-catalogue history often already carries the ISRC — use it when
  // the metadata read failed (rate limit) or came back without one, so the
  // Spotify search below still has something to work with.
  if (!out.isrc && str(knownIsrc)) {
    out.isrc = str(knownIsrc)!.toUpperCase();
    out.sources.push("catalog_history");
  }
  if (ids.status === "fulfilled") {
    for (const id of ids.value) {
      const code = (str(id.platformCode) ?? str(id.platformName) ?? "").toLowerCase();
      if (code !== "spotify") continue;
      const recovered = spotifyIdFromIdentifier(str(id.identifier), str(id.url));
      if (recovered) { out.spotifyTrackId = recovered; out.sources.push("soundcharts_identifiers"); break; }
    }
  }
  if (albums.status === "fulfilled") {
    // Prefer the album entry that actually carries a barcode.
    const withUpc = albums.value.find((a) => str(a.upc)) ?? albums.value[0];
    if (withUpc) {
      out.upc = str(withUpc.upc);
      out.albumTitle = str(withUpc.name);
      out.label = out.label ?? str(withUpc.label);
      out.releaseDate = out.releaseDate ?? str(withUpc.releaseDate);
      if (out.upc || out.albumTitle) out.sources.push("soundcharts_albums");
    }
  }

  // Spotify fallback/confirmation: an ISRC search finds the recording even
  // when it was re-released under a different track id.
  const cfg = defaultResolverConfig();
  if (!out.spotifyTrackId && out.isrc) {
    try {
      const track = await findTrackByIsrc(out.isrc, cfg);
      if (track) {
        out.spotifyTrackId = str(track.id);
        const album = track.album as Record<string, unknown> | undefined;
        const albumId = str(album?.id);
        out.spotifyAlbumId = albumId && SPOTIFY_ID_RE.test(albumId) ? albumId : null;
        out.albumTitle = out.albumTitle ?? str(album?.name);
        out.sources.push("spotify_isrc_search");
      }
    } catch { /* search is best-effort; Soundcharts data stands on its own */ }
  }

  // If the barcode is still missing but a Spotify album is known, one album
  // read fills it (external_ids.upc is only on the album object).
  if (!out.upc && out.spotifyAlbumId) {
    try {
      const full = await getSpotifyAlbum(out.spotifyAlbumId, cfg);
      const body = full.body as Record<string, unknown>;
      out.upc = str((body.external_ids as Record<string, unknown> | undefined)?.upc);
      out.albumTitle = out.albumTitle ?? str(body.name);
      if (out.upc) out.sources.push("spotify_album");
    } catch { /* best-effort */ }
  }

  logger.info({
    event: "removed_track_recovered",
    matchStatus: `uuid=${songUuid};spotifyId=${out.spotifyTrackId ? "yes" : "no"};isrc=${out.isrc ? "yes" : "no"};upc=${out.upc ? "yes" : "no"}`,
  });
  return out;
}
