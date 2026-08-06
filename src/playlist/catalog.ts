/**
 * Playlist catalogue service — the artist-catalogue treatment for a playlist.
 *
 * Spotify's client-credentials tokens stopped returning playlist TRACKS
 * entirely (measured 2026-08: the playlist response no longer even carries a
 * `tracks` field; /playlists/{id}/tracks was already 403). Two sources still
 * work, in order:
 *
 *   1. The linked Spotify account (OAuth user token) — full paging.
 *   2. The user's own Spotify desktop client via the connector bridge — the
 *      panel queues a fetch and the desktop shell answers it over CDP.
 *
 * Tracks that are still listed in the playlist but no longer playable on
 * Spotify (delisted / withdrawn / entry gone) are flagged `onProfile: false`
 * — the same "removed" contract the artist catalogue uses, so the panel's
 * release table, recovery pipeline (ISRC/UPC), and distributor resolution
 * work on playlists unchanged.
 */

import { SPOTIFY, defaultResolverConfig, isSpotifyConfigured } from "../config";
import { getSpotifyPlaylist } from "../spotify";
import { userSpotifyRequest } from "../spotifyAccount";
import { createPlaylistFetch, getPlaylistFetch } from "../connectorStore";
import { logger } from "../logger";
import type { CatalogTrack, ArtistCatalog } from "../artist/catalog";

export type PlaylistCatalog = Omit<ArtistCatalog, "spotifyArtistId" | "soundchartsArtistUuid"> & {
  kind: "playlist_catalog";
  spotifyPlaylistId: string;
  owner: string | null;
  followers: number | null;
  totalTracks: number | null;
  /** Which source produced the tracks — shown honestly in the UI. */
  trackSource: "spotify_account" | "spotify_client" | null;
};

const ID_RE = /^[A-Za-z0-9]{22}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Normalized item shape shared by both sources (mirrors the bridge's slim items). */
type SlimItem = {
  gone?: boolean;
  addedAt: string | null;
  id: string | null;
  title: string;
  artists: string[];
  albumId: string | null;
  albumTitle: string | null;
  albumType: string | null;
  releaseDate: string | null;
  durationMs: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  explicit: boolean | null;
  isrc: string | null;
  isPlayable: boolean | null;
  restriction: string | null;
};

function slimFromRawItem(item: Record<string, unknown>): SlimItem | null {
  const t = item.track as Record<string, unknown> | null | undefined;
  if (t && t.is_local === true) return null; // local files are not distribution
  if (!t) return { gone: true, addedAt: str(item.added_at), id: null, title: "", artists: [], albumId: null, albumTitle: null, albumType: null, releaseDate: null, durationMs: null, discNumber: null, trackNumber: null, explicit: null, isrc: null, isPlayable: null, restriction: null };
  const alb = (t.album as Record<string, unknown>) ?? {};
  return {
    addedAt: str(item.added_at),
    id: str(t.id),
    title: str(t.name) ?? "",
    artists: Array.isArray(t.artists) ? (t.artists as Record<string, unknown>[]).map((a) => str(a?.name)).filter((n): n is string => !!n) : [],
    albumId: str(alb.id),
    albumTitle: str(alb.name),
    albumType: str(alb.album_type),
    releaseDate: str(alb.release_date),
    durationMs: num(t.duration_ms),
    discNumber: num(t.disc_number),
    trackNumber: num(t.track_number),
    explicit: typeof t.explicit === "boolean" ? t.explicit : null,
    isrc: str((t.external_ids as Record<string, unknown> | undefined)?.isrc),
    isPlayable: typeof t.is_playable === "boolean" ? t.is_playable : null,
    restriction: str((t.restrictions as Record<string, unknown> | undefined)?.reason),
  };
}

function slimFromBridgeItem(raw: unknown): SlimItem | null {
  const it = raw as Record<string, unknown> | null;
  if (!it) return null;
  if (it.gone === true) return { gone: true, addedAt: str(it.addedAt), id: null, title: "", artists: [], albumId: null, albumTitle: null, albumType: null, releaseDate: null, durationMs: null, discNumber: null, trackNumber: null, explicit: null, isrc: null, isPlayable: null, restriction: null };
  return {
    addedAt: str(it.addedAt),
    id: str(it.id),
    title: str(it.title) ?? "",
    artists: Array.isArray(it.artists) ? (it.artists as unknown[]).map((a) => str(a)).filter((n): n is string => !!n) : [],
    albumId: str(it.albumId),
    albumTitle: str(it.albumTitle),
    albumType: str(it.albumType),
    releaseDate: str(it.releaseDate),
    durationMs: num(it.durationMs),
    discNumber: num(it.discNumber),
    trackNumber: num(it.trackNumber),
    explicit: typeof it.explicit === "boolean" ? it.explicit : null,
    isrc: str(it.isrc),
    isPlayable: typeof it.isPlayable === "boolean" ? it.isPlayable : null,
    restriction: str(it.restriction),
  };
}

/** Try the linked account first — full Web API paging on the user's own consent. */
async function loadViaUserAccount(playlistId: string, maxTracks: number): Promise<{ items: SlimItem[]; total: number | null } | null> {
  let url: string | null = `${SPOTIFY.apiBase}/playlists/${playlistId}/tracks?limit=100&market=from_token&additional_types=track`;
  const items: SlimItem[] = [];
  let total: number | null = null;
  for (let page = 0; page < Math.ceil(maxTracks / 100) && url; page++) {
    const res = await userSpotifyRequest(url);
    if (!res) return null; // no linked account / token unusable
    if (res.status < 200 || res.status >= 300) return items.length ? { items, total } : null;
    total = num(res.body.total) ?? total;
    const raw = Array.isArray(res.body.items) ? (res.body.items as Record<string, unknown>[]) : [];
    for (const item of raw) {
      const slim = slimFromRawItem(item);
      if (slim) items.push(slim);
      if (items.length >= maxTracks) break;
    }
    url = items.length >= maxTracks ? null : (str(res.body.next) as string | null);
  }
  return items.length ? { items, total } : null;
}

/** Fall back to the desktop bridge: queue a fetch, wait for the shell to answer. */
async function loadViaBridge(playlistId: string, waitMs: number): Promise<{ items: SlimItem[]; total: number | null; name: string | null; viaPlatform: boolean } | null> {
  const req = createPlaylistFetch(playlistId);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const f = getPlaylistFetch(req.requestId);
    if (!f) return null;
    if (f.status === "completed" && Array.isArray(f.items)) {
      const items = f.items.map(slimFromBridgeItem).filter((s): s is SlimItem => !!s);
      return { items, total: f.total, name: f.playlistName, viaPlatform: f.viaPlatform };
    }
    if (f.status === "failed") throw new Error(f.error ?? "The Spotify client could not read this playlist.");
  }
  throw new Error("The desktop app did not answer in time — is it running and connected to Spotify?");
}

export async function buildPlaylistCatalog(
  playlistId: string,
  opts: { maxTracks?: number; bridgeWaitMs?: number } = {}
): Promise<PlaylistCatalog> {
  if (!ID_RE.test(playlistId)) throw new Error("Invalid Spotify playlist id.");
  const maxTracks = opts.maxTracks ?? 1000;

  // Metadata via the app pool still works (name/owner/image/followers) —
  // best-effort so a metadata failure cannot kill a readable tracklist.
  let name: string | null = null;
  let owner: string | null = null;
  let imageUrl: string | null = null;
  let followers: number | null = null;
  if (isSpotifyConfigured()) {
    try {
      const { body } = await getSpotifyPlaylist(playlistId, defaultResolverConfig());
      const p = body as Record<string, unknown>;
      name = str(p.name);
      owner = str((p.owner as Record<string, unknown> | undefined)?.display_name);
      followers = num((p.followers as Record<string, unknown> | undefined)?.total);
      const images = Array.isArray(p.images) ? (p.images as { url?: string }[]) : [];
      imageUrl = str(images[0]?.url);
    } catch { /* metadata is cosmetic here */ }
  }

  let source: PlaylistCatalog["trackSource"] = null;
  let slim: SlimItem[] = [];
  let total: number | null = null;
  let viaPlatform = false;

  const viaAccount = await loadViaUserAccount(playlistId, maxTracks).catch(() => null);
  if (viaAccount) {
    source = "spotify_account";
    slim = viaAccount.items;
    total = viaAccount.total;
  } else {
    const viaBridge = await loadViaBridge(playlistId, opts.bridgeWaitMs ?? 40000);
    if (viaBridge) {
      source = "spotify_client";
      slim = viaBridge.items;
      total = viaBridge.total;
      name = name ?? viaBridge.name;
      viaPlatform = viaBridge.viaPlatform;
    }
  }
  if (!slim.length) throw new Error("No tracks could be read from this playlist.");

  let goneIdx = 0;
  const tracks: CatalogTrack[] = slim.map((s) => {
    // A playlist entry counts as removed when the recording is no longer
    // playable on Spotify: the entry is gone entirely, the track is flagged
    // unplayable, or it carries a restriction.
    const removed = s.gone === true || s.isPlayable === false || !!s.restriction;
    const id = s.id && ID_RE.test(s.id) ? s.id : null;
    return {
      key: id ?? `gone-${goneIdx++}`,
      spotifyTrackId: id,
      soundchartsSongUuid: null,
      title: s.gone ? "Removed track (entry no longer resolves on Spotify)" : s.title,
      artists: s.artists,
      albumTitle: s.albumTitle,
      spotifyAlbumId: s.albumId && ID_RE.test(s.albumId) ? s.albumId : null,
      albumType: s.albumType,
      releaseDate: s.releaseDate,
      durationMs: s.durationMs,
      discNumber: s.discNumber,
      trackNumber: s.trackNumber,
      explicit: s.explicit,
      isrc: s.isrc ? s.isrc.toUpperCase() : null,
      upc: null,
      onProfile: !removed,
      source: "spotify",
    };
  });

  const live = tracks.filter((t) => t.onProfile).length;
  const albums = new Set(tracks.map((t) => t.spotifyAlbumId).filter(Boolean)).size;
  const truncated = total !== null && tracks.length < total;
  logger.info({ event: "playlist_catalog_built", trackId: playlistId, matchStatus: `source=${source};tracks=${tracks.length};removed=${tracks.length - live}` });

  return {
    kind: "playlist_catalog",
    spotifyPlaylistId: playlistId,
    name,
    owner,
    followers,
    imageUrl,
    spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
    totalTracks: total,
    trackSource: source,
    tracks,
    counts: {
      total: tracks.length,
      onProfile: live,
      offProfile: tracks.length - live,
      albums,
      withIsrc: tracks.filter((t) => !!t.isrc).length,
    },
    coverage: {
      spotifyAlbums: albums,
      spotifyAlbumsTruncated: false,
      soundchartsTotal: null,
      soundchartsLoaded: 0,
      soundchartsTruncated: truncated,
      soundchartsAvailable: false,
      note: truncated
        ? `Loaded the first ${tracks.length} of ${total} tracks.`
        : viaPlatform
          ? "Tracks were read through your own Spotify app. Identifiers (ISRC/UPC) fill in as tracks are resolved."
          : source === "spotify_client"
            ? "Tracks were read through your own Spotify app (Spotify's public API no longer shares playlist tracks)."
            : null,
    },
  };
}
