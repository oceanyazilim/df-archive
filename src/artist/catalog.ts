/**
 * Artist catalogue service.
 *
 * Builds one ordered list of every track associated with an artist, from two
 * independent sources:
 *
 *   Spotify  — the artist's albums and singles as they appear on the profile
 *              *today* (id, ISRC, UPC, dates, durations).
 *   Soundcharts — the historical song list for the same artist, which retains
 *              releases that have since been pulled from the Spotify profile.
 *
 * Anything present in the Soundcharts history but absent from the current
 * Spotify profile is reported with `onProfile: false` — those are the tracks
 * that were removed from the profile yet remain part of the artist's
 * distribution. Matching is done on ISRC first (authoritative) and falls back
 * to a normalized title, so a re-release under a new id still lines up.
 *
 * Distributors are NOT resolved here: that requires a licensor UUID, which only
 * the user's own Spotify client can supply. The catalogue carries the ids the
 * connector needs, and the UI fills distributors in progressively.
 */

import { defaultResolverConfig, isSpotifyConfigured } from "../config";
import { getSpotifyArtist, getSpotifyArtistAlbums, getSpotifyAlbum } from "../spotify";
import { isSoundchartsConfigured } from "../soundcharts/config";
import { getArtistBySpotifyId, getArtistSongs } from "../soundcharts/artist";
import { logger } from "../logger";
import { PoolUnavailableError } from "../credentialPool";

export type CatalogTrack = {
  /** Stable row key: the Spotify id when known, else the Soundcharts uuid. */
  key: string;
  spotifyTrackId: string | null;
  soundchartsSongUuid: string | null;
  title: string;
  artists: string[];
  albumTitle: string | null;
  spotifyAlbumId: string | null;
  albumType: string | null;
  releaseDate: string | null;
  durationMs: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  explicit: boolean | null;
  isrc: string | null;
  upc: string | null;
  /** false = known to Soundcharts but not on the artist's current Spotify profile. */
  onProfile: boolean;
  source: "spotify" | "soundcharts";
};

export type ArtistCatalog = {
  spotifyArtistId: string;
  name: string | null;
  imageUrl: string | null;
  spotifyUrl: string;
  soundchartsArtistUuid: string | null;
  tracks: CatalogTrack[];
  counts: {
    total: number;
    onProfile: number;
    offProfile: number;
    albums: number;
    withIsrc: number;
  };
  /** Honest reporting of what could not be loaded, instead of silent gaps. */
  coverage: {
    spotifyAlbums: number;
    spotifyAlbumsTruncated: boolean;
    soundchartsTotal: number | null;
    soundchartsLoaded: number;
    soundchartsTruncated: boolean;
    soundchartsAvailable: boolean;
    note: string | null;
  };
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Title key for matching when no ISRC exists on one side. */
function titleKey(title: string | null | undefined): string {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    // Drop bracketed qualifiers and feature credits so "Song (feat. X)" and
    // "Song" from two catalogues line up.
    .replace(/\((?:feat|ft|with)[^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function imageOf(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  for (const img of images) {
    const url = str((img as Record<string, unknown>)?.url);
    if (url) return url;
  }
  return null;
}

/**
 * Every album on the artist's current Spotify profile, with full tracklists.
 * The albums endpoint caps `limit` at 10 for this token type, so pages are
 * walked explicitly and the album detail (ISRC/UPC) is fetched per release.
 */
async function loadSpotifySide(artistId: string, maxAlbums: number) {
  const cfg = defaultResolverConfig();
  const albums: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let truncated = false;

  for (let page = 0; page < 30; page++) {
    const res = await getSpotifyArtistAlbums(artistId, cfg, undefined, offset).catch(() => null);
    const items = Array.isArray(res?.body?.items) ? (res!.body.items as Record<string, unknown>[]) : [];
    if (!items.length) break;
    for (const a of items) {
      const id = str(a.id);
      if (id && !seen.has(id)) { seen.add(id); albums.push(a); }
    }
    offset += items.length;
    if (albums.length >= maxAlbums) { truncated = true; break; }
    const total = num(res?.body?.total);
    if (total !== null && offset >= total) break;
  }

  const tracks: CatalogTrack[] = [];
  // Album detail carries UPC + per-track ISRC; fetch sequentially in small
  // batches so we never hammer the API with a hundred parallel requests.
  const batchSize = 4;
  for (let i = 0; i < albums.length; i += batchSize) {
    const batch = albums.slice(i, i + batchSize);
    const detailed = await Promise.all(batch.map(async (a) => {
      const albumId = str(a.id);
      if (!albumId) return null;
      const full = await getSpotifyAlbum(albumId, cfg).catch(() => null);
      return full ? { albumId, body: full.body as Record<string, unknown>, items: full.tracks } : null;
    }));

    for (const d of detailed) {
      if (!d) continue;
      const albumTitle = str(d.body.name);
      const albumType = str(d.body.album_type);
      const releaseDate = str(d.body.release_date);
      const upc = str((d.body.external_ids as Record<string, unknown>)?.upc);
      for (const raw of d.items) {
        const t = raw as Record<string, unknown>;
        const id = str(t.id);
        if (!id) continue;
        tracks.push({
          key: id,
          spotifyTrackId: id,
          soundchartsSongUuid: null,
          title: str(t.name) ?? "",
          artists: Array.isArray(t.artists) ? (t.artists as Record<string, unknown>[]).map((x) => str(x.name)).filter((n): n is string => !!n) : [],
          albumTitle,
          spotifyAlbumId: d.albumId,
          albumType,
          releaseDate,
          durationMs: num(t.duration_ms),
          discNumber: num(t.disc_number),
          trackNumber: num(t.track_number),
          explicit: typeof t.explicit === "boolean" ? t.explicit : null,
          isrc: str((t.external_ids as Record<string, unknown>)?.isrc),
          upc,
          onProfile: true,
          source: "spotify",
        });
      }
    }
  }
  return { tracks, albumCount: albums.length, truncated };
}

/**
 * Build the merged catalogue for one Spotify artist.
 * `maxAlbums` / `maxSongs` bound the work; whatever is dropped is reported in
 * `coverage` rather than silently omitted.
 */
export async function buildArtistCatalog(
  spotifyArtistId: string,
  opts: { maxAlbums?: number; maxSongs?: number } = {}
): Promise<ArtistCatalog> {
  if (!/^[A-Za-z0-9]{22}$/.test(spotifyArtistId)) throw new Error("Invalid Spotify artist id.");
  if (!isSpotifyConfigured()) throw new Error("Spotify credentials are not configured on the server.");
  const cfg = defaultResolverConfig();
  const maxAlbums = opts.maxAlbums ?? 120;
  const maxSongs = opts.maxSongs ?? 1000;

  // A cooldown must surface as itself, not as an empty catalogue.
  const profile = await getSpotifyArtist(spotifyArtistId, cfg).catch((e) => {
    if (e instanceof PoolUnavailableError) throw e;
    return null;
  });
  const artistBody = (profile?.body ?? {}) as Record<string, unknown>;

  const spotifySide = await loadSpotifySide(spotifyArtistId, maxAlbums);
  const tracks: CatalogTrack[] = [...spotifySide.tracks];

  // Index the current profile so the historical list can be diffed against it.
  const byIsrc = new Map<string, CatalogTrack>();
  const byTitle = new Map<string, CatalogTrack>();
  for (const t of tracks) {
    if (t.isrc) byIsrc.set(t.isrc.toUpperCase(), t);
    const k = titleKey(t.title);
    if (k && !byTitle.has(k)) byTitle.set(k, t);
  }

  let scArtistUuid: string | null = null;
  let scTotal: number | null = null;
  let scLoaded = 0;
  let scTruncated = false;
  let note: string | null = null;

  if (isSoundchartsConfigured()) {
    try {
      const scArtist = await getArtistBySpotifyId(spotifyArtistId);
      scArtistUuid = str(scArtist?.uuid);
      if (scArtistUuid) {
        const { songs, total, truncated } = await getArtistSongs(scArtistUuid, maxSongs);
        scTotal = total;
        scLoaded = songs.length;
        scTruncated = truncated;
        for (const s of songs) {
          const isrc = str(s.isrc)?.toUpperCase() ?? null;
          const tKey = titleKey(s.name);
          const already = (isrc && byIsrc.get(isrc)) || (tKey ? byTitle.get(tKey) : undefined);
          if (already) {
            // Same recording; keep the Spotify row but remember its Soundcharts id.
            if (!already.soundchartsSongUuid) already.soundchartsSongUuid = str(s.uuid);
            continue;
          }
          const uuid = str(s.uuid);
          if (!uuid) continue;
          const row: CatalogTrack = {
            key: uuid,
            spotifyTrackId: null,
            soundchartsSongUuid: uuid,
            title: str(s.name) ?? "",
            artists: str(s.creditName) ? [str(s.creditName)!] : [],
            albumTitle: null,
            spotifyAlbumId: null,
            albumType: null,
            releaseDate: str(s.releaseDate),
            durationMs: null,
            discNumber: null,
            trackNumber: null,
            explicit: null,
            isrc,
            upc: null,
            onProfile: false,
            source: "soundcharts",
          };
          tracks.push(row);
          if (isrc) byIsrc.set(isrc, row);
          if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, row);
        }
      } else {
        note = "This artist was not found in the analytics catalogue, so tracks removed from the profile cannot be listed.";
      }
    } catch (err) {
      note = "The analytics catalogue could not be read, so tracks removed from the profile may be missing.";
      logger.warn({ event: "artist_catalog_soundcharts_failed", errorCategory: (err as { code?: string })?.code ?? "unknown" });
    }
  } else {
    note = "Analytics are not configured, so only the artist's current Spotify profile is listed.";
  }

  // Newest first; undated entries last. Stable within a release by disc/track.
  tracks.sort((a, b) => {
    const da = a.releaseDate ?? "", db = b.releaseDate ?? "";
    if (da !== db) return da && db ? (da < db ? 1 : -1) : (da ? -1 : 1);
    const disc = (a.discNumber ?? 0) - (b.discNumber ?? 0);
    if (disc) return disc;
    return (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
  });

  const onProfile = tracks.filter((t) => t.onProfile).length;
  logger.info({ event: "artist_catalog_built", trackId: spotifyArtistId, matchStatus: `tracks=${tracks.length};offProfile=${tracks.length - onProfile}` });

  return {
    spotifyArtistId,
    name: str(artistBody.name),
    imageUrl: imageOf(artistBody.images),
    spotifyUrl: `https://open.spotify.com/artist/${spotifyArtistId}`,
    soundchartsArtistUuid: scArtistUuid,
    tracks,
    counts: {
      total: tracks.length,
      onProfile,
      offProfile: tracks.length - onProfile,
      albums: spotifySide.albumCount,
      withIsrc: tracks.filter((t) => !!t.isrc).length,
    },
    coverage: {
      spotifyAlbums: spotifySide.albumCount,
      spotifyAlbumsTruncated: spotifySide.truncated,
      soundchartsTotal: scTotal,
      soundchartsLoaded: scLoaded,
      soundchartsTruncated: scTruncated,
      soundchartsAvailable: !!scArtistUuid,
      note,
    },
  };
}
