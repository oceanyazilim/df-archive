/**
 * Ocean Analyzer data service.
 *
 * Assembles everything the in-Spotify analyzer modal shows, for a track, album,
 * artist or playlist. Every field is either REAL (from the Spotify Web API, the
 * canonical UUID mapping, or Soundcharts) or explicitly absent — nothing is
 * estimated, interpolated, or invented. Sections whose upstream data is missing
 * come back with an availability marker so the UI can say so honestly.
 *
 * Distributor rule is unchanged: a licensor UUID matched exactly against
 * json/uuid's.json. Labels, ISRC/UPC prefixes and titles are never used.
 */

import {
  getSpotifyTrack, getSpotifyAlbum, getSpotifyArtist, getSpotifyArtistTopTracks,
  getSpotifyArtistAlbums, getSpotifyPlaylist,
} from "../spotify";
import { defaultResolverConfig, isSpotifyConfigured } from "../config";
import { resolveDistributorByLicensorUuid } from "../distributor/resolver";
import { getSongBySpotifyId, getSongIdentifiers } from "../soundcharts/song";
import { getSongStreams } from "../soundcharts/analytics";
import { isSoundchartsConfigured } from "../soundcharts/config";
import { logger } from "../logger";
import { spotifyCooldownInfo, formatDuration } from "../spotifyRateGuard";
import { PoolUnavailableError } from "../credentialPool";

export type AnalyzerKind = "track" | "album" | "artist" | "playlist";

/** Why a section has no data — drives the UI's honest empty states. */
export type Availability = "available" | "empty" | "not_configured" | "plan_restricted" | "unavailable";

export type StreamSeries = { state: Availability; points: { date: string; value: number }[]; platform: string };

export type AnalyzerDistributor = {
  name: string | null;
  licensorUuid: string | null;
  status: "verified" | "uuid_not_mapped" | "uuid_unavailable" | "invalid_uuid" | "conflict";
};

export type AnalyzerTrack = {
  kind: "track";
  spotifyTrackId: string;
  title: string | null;
  artists: { id: string | null; name: string }[];
  albumTitle: string | null;
  albumId: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  explicit: boolean | null;
  popularity: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  releaseDate: string | null;
  isrc: string | null;
  upc: string | null;
  label: string | null;
  copyrights: string[];
  availableMarkets: number | null;
  distributor: AnalyzerDistributor;
  soundchartsSongUuid: string | null;
  streams: StreamSeries;
  links: { name: string; url: string }[];
  spotifyUrl: string;
};

export type AnalyzerAlbumTrack = {
  spotifyTrackId: string; title: string; artists: string[];
  trackNumber: number; discNumber: number; durationMs: number | null; explicit: boolean;
  isrc: string | null;
};

export type AnalyzerAlbum = {
  kind: "album";
  spotifyAlbumId: string;
  title: string | null;
  artists: { id: string | null; name: string }[];
  artworkUrl: string | null;
  releaseDate: string | null;
  releaseType: string | null;
  totalTracks: number;
  totalDurationMs: number;
  popularity: number | null;
  upc: string | null;
  label: string | null;
  copyrights: string[];
  tracks: AnalyzerAlbumTrack[];
  spotifyUrl: string;
};

export type AnalyzerArtist = {
  kind: "artist";
  spotifyArtistId: string;
  name: string | null;
  imageUrl: string | null;
  followers: number | null;
  popularity: number | null;
  genres: string[];
  topTracks: { spotifyTrackId: string; title: string; albumTitle: string | null; popularity: number | null; durationMs: number | null; artworkUrl: string | null }[];
  releases: { spotifyAlbumId: string; title: string; releaseDate: string | null; releaseType: string | null; totalTracks: number; artworkUrl: string | null }[];
  /** Sections Spotify no longer exposes to this app, so the UI can say why. */
  restricted: { topTracks: boolean; profileStats: boolean };
  spotifyUrl: string;
};

export type AnalyzerPlaylist = {
  kind: "playlist";
  spotifyPlaylistId: string;
  name: string | null;
  description: string | null;
  owner: string | null;
  isPublic: boolean | null;
  followers: number | null;
  artworkUrl: string | null;
  totalTracks: number;
  totalDurationMs: number;
  tracks: { spotifyTrackId: string; title: string; artists: string[]; albumTitle: string | null; durationMs: number | null; popularity: number | null; addedAt: string | null; releaseDate: string | null }[];
  topArtists: { name: string; count: number }[];
  spotifyUrl: string;
};

export type AnalyzerResult = AnalyzerTrack | AnalyzerAlbum | AnalyzerArtist | AnalyzerPlaylist;

const ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * Turn an upstream Spotify failure into a message the user can act on.
 *
 * `executeWithRetry` throws on any non-2xx (permanent statuses immediately),
 * carrying the status on the error — so both the thrown case and a defensive
 * status check route through here. Spotify withdrew API access to its own
 * editorial/algorithmic playlists in late 2024, so a 404 there is expected
 * rather than a bug; say so plainly instead of "Analysis failed".
 */
function spotifyFailure(status: number | null | undefined, kind: AnalyzerKind): AnalyzerError {
  if (status === 404) {
    return new AnalyzerError("NOT_FOUND", kind === "playlist"
      ? "This playlist is not readable through the Spotify API. Spotify-owned editorial and algorithmic playlists are not available."
      : `This ${kind} was not found on Spotify.`);
  }
  if (status === 401 || status === 403) return new AnalyzerError("SPOTIFY_FORBIDDEN", `Spotify refused access to this ${kind}.`);
  if (status === 429) {
    const cd = spotifyCooldownInfo();
    return new AnalyzerError("SPOTIFY_RATE_LIMITED", cd.active
      ? `Spotify is rate-limiting this application. It becomes available again in about ${formatDuration(cd.remainingMs)}. Distributor lookups from your own Spotify client still work.`
      : "Spotify is rate-limiting requests — try again shortly.");
  }
  if (status === 400) return new AnalyzerError("SPOTIFY_BAD_REQUEST", `Spotify rejected the request for this ${kind}.`);
  return new AnalyzerError("SPOTIFY_UNAVAILABLE", `Spotify could not be reached for this ${kind}.`);
}

/** Run a Spotify call, converting any upstream failure into an AnalyzerError. */
async function spotifyCall<T>(kind: AnalyzerKind, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AnalyzerError) throw err;
    // A cooldown already knows exactly how long it lasts — pass that through
    // rather than flattening it into a generic "try again shortly".
    if (err instanceof PoolUnavailableError) throw new AnalyzerError(err.code, err.message);
    const status = (err as { httpStatus?: number | null })?.httpStatus ?? null;
    throw spotifyFailure(status, kind);
  }
}

function assertSpotifyOk(status: number, kind: AnalyzerKind): void {
  if (status >= 200 && status < 300) return;
  throw spotifyFailure(status, kind);
}

/** Carries a safe, user-facing message and an HTTP status for the API route. */
export class AnalyzerError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AnalyzerError";
    this.code = code;
    this.httpStatus = code === "NOT_FOUND" ? 404 : code === "SPOTIFY_RATE_LIMITED" ? 429 : 502;
  }
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function imageOf(images: unknown): string | null {
  if (!Array.isArray(images) || !images.length) return null;
  // Spotify returns images widest-first; take the first with a usable url.
  for (const img of images) {
    const url = str((img as Record<string, unknown>)?.url);
    if (url) return url;
  }
  return null;
}

function artistList(raw: unknown): { id: string | null; name: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      const o = a as Record<string, unknown>;
      const name = str(o?.name);
      return name ? { id: str(o?.id), name } : null;
    })
    .filter((a): a is { id: string | null; name: string } => !!a);
}

function copyrightsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => str((c as Record<string, unknown>)?.text)).filter((t): t is string => !!t).slice(0, 4);
}

/** Real Soundcharts series for one platform, or an honest unavailable state. */
async function streamsFor(songUuid: string | null, platform: string, days: number): Promise<StreamSeries> {
  if (!isSoundchartsConfigured()) return { state: "not_configured", points: [], platform };
  if (!songUuid) return { state: "empty", points: [], platform };
  try {
    const points = await getSongStreams(songUuid, platform, days);
    return { state: points.length ? "available" : "empty", points, platform };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const state: Availability = code === "SOUNDCHARTS_PLAN_RESTRICTED" ? "plan_restricted"
      : code === "SOUNDCHARTS_NOT_FOUND" ? "empty" : "unavailable";
    return { state, points: [], platform };
  }
}

/** Store links from Soundcharts identifiers, deduplicated per platform. */
async function linksFor(songUuid: string | null, spotifyUrl: string): Promise<{ name: string; url: string }[]> {
  const out: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, url: string | null) => {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!url || !key || seen.has(key)) return;
    try { const u = new URL(url); if (u.protocol !== "https:" && u.protocol !== "http:") return; } catch { return; }
    seen.add(key);
    out.push({ name, url });
  };
  push("Spotify", spotifyUrl);
  if (!songUuid || !isSoundchartsConfigured()) return out;
  try {
    for (const id of await getSongIdentifiers(songUuid)) {
      push(str(id.platformName) ?? str(id.platformCode) ?? "Platform", str(id.url));
    }
  } catch { /* links are optional — never fail the whole analysis for them */ }
  return out;
}

/**
 * Track analysis. `licensorUuid` is the value captured from the user's own
 * Spotify client (the public Web API never exposes it); without it the
 * distributor is honestly reported as unavailable rather than guessed.
 */
export async function analyzeTrack(
  trackId: string,
  opts: { licensorUuid?: string | null; days?: number } = {}
): Promise<AnalyzerTrack> {
  if (!ID_RE.test(trackId)) throw new Error("Invalid Spotify track id.");
  const cfg = defaultResolverConfig();
  const days = opts.days ?? 30;

  if (!isSpotifyConfigured()) throw new AnalyzerError("SPOTIFY_NOT_CONFIGURED", "Spotify credentials are not configured on the server.");
  const trackRes = await spotifyCall("track", () => getSpotifyTrack(trackId, cfg));
  assertSpotifyOk(trackRes.status, "track");
  const t = trackRes.body as Record<string, unknown>;
  const album = (t.album as Record<string, unknown>) ?? {};
  const albumId = str(album.id);

  // Album-level detail (UPC, label, copyrights) needs the album resource.
  let albumFull: Record<string, unknown> = {};
  if (albumId) {
    albumFull = ((await getSpotifyAlbum(albumId, cfg).catch(() => null))?.body as Record<string, unknown>) ?? {};
  }

  const isrc = str((t.external_ids as Record<string, unknown>)?.isrc);
  const distributor = resolveDistributorByLicensorUuid(opts.licensorUuid ?? null);

  // Soundcharts song uuid drives every analytics section.
  let songUuid: string | null = null;
  if (isSoundchartsConfigured()) {
    try { songUuid = (await getSongBySpotifyId(trackId))?.uuid ?? null; } catch { songUuid = null; }
  }

  const [streams, links] = await Promise.all([
    streamsFor(songUuid, "spotify", days),
    linksFor(songUuid, `https://open.spotify.com/track/${trackId}`),
  ]);

  const markets = Array.isArray(t.available_markets) ? t.available_markets.length : null;

  return {
    kind: "track",
    spotifyTrackId: trackId,
    title: str(t.name),
    artists: artistList(t.artists),
    albumTitle: str(album.name),
    albumId,
    artworkUrl: imageOf(album.images),
    durationMs: num(t.duration_ms),
    explicit: typeof t.explicit === "boolean" ? t.explicit : null,
    popularity: num(t.popularity),
    trackNumber: num(t.track_number),
    discNumber: num(t.disc_number),
    releaseDate: str(album.release_date) ?? str(albumFull.release_date),
    isrc,
    upc: str((albumFull.external_ids as Record<string, unknown>)?.upc),
    label: str(albumFull.label),
    copyrights: copyrightsOf(albumFull.copyrights),
    availableMarkets: markets,
    distributor: { name: distributor.name, licensorUuid: distributor.uuid, status: distributor.status },
    soundchartsSongUuid: songUuid,
    streams,
    links,
    spotifyUrl: `https://open.spotify.com/track/${trackId}`,
  };
}

export async function analyzeAlbum(albumId: string): Promise<AnalyzerAlbum> {
  if (!ID_RE.test(albumId)) throw new Error("Invalid Spotify album id.");
  const cfg = defaultResolverConfig();
  const { status, body, tracks } = await spotifyCall("album", () => getSpotifyAlbum(albumId, cfg));
  assertSpotifyOk(status, "album");
  const a = body as Record<string, unknown>;

  const list: AnalyzerAlbumTrack[] = tracks.map((raw) => {
    const o = raw as Record<string, unknown>;
    return {
      spotifyTrackId: str(o.id) ?? "",
      title: str(o.name) ?? "",
      artists: artistList(o.artists).map((x) => x.name),
      trackNumber: num(o.track_number) ?? 0,
      discNumber: num(o.disc_number) ?? 1,
      durationMs: num(o.duration_ms),
      explicit: o.explicit === true,
      isrc: str((o.external_ids as Record<string, unknown>)?.isrc),
    };
  }).filter((t) => ID_RE.test(t.spotifyTrackId));

  return {
    kind: "album",
    spotifyAlbumId: albumId,
    title: str(a.name),
    artists: artistList(a.artists),
    artworkUrl: imageOf(a.images),
    releaseDate: str(a.release_date),
    releaseType: str(a.album_type),
    totalTracks: num(a.total_tracks) ?? list.length,
    totalDurationMs: list.reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
    popularity: num(a.popularity),
    upc: str((a.external_ids as Record<string, unknown>)?.upc),
    label: str(a.label),
    copyrights: copyrightsOf(a.copyrights),
    tracks: list,
    spotifyUrl: `https://open.spotify.com/album/${albumId}`,
  };
}

export async function analyzeArtist(artistId: string): Promise<AnalyzerArtist> {
  if (!ID_RE.test(artistId)) throw new Error("Invalid Spotify artist id.");
  const cfg = defaultResolverConfig();
  // Top tracks are 403 for client-credentials tokens; a failure there must not
  // sink the whole artist view, so each optional call degrades on its own.
  const [artistRes, topRes, albumsRes] = await Promise.all([
    spotifyCall("artist", () => getSpotifyArtist(artistId, cfg)),
    getSpotifyArtistTopTracks(artistId, cfg).catch(() => ({ status: 403, body: {} as Record<string, unknown> })),
    getSpotifyArtistAlbums(artistId, cfg).catch(() => ({ status: 0, body: {} as Record<string, unknown> })),
  ]);
  assertSpotifyOk(artistRes.status, "artist");
  const a = artistRes.body;

  const topTracks = (Array.isArray(topRes.body.tracks) ? topRes.body.tracks : []).map((raw) => {
    const o = raw as Record<string, unknown>;
    const alb = (o.album as Record<string, unknown>) ?? {};
    return {
      spotifyTrackId: str(o.id) ?? "",
      title: str(o.name) ?? "",
      albumTitle: str(alb.name),
      popularity: num(o.popularity),
      durationMs: num(o.duration_ms),
      artworkUrl: imageOf(alb.images),
    };
  }).filter((t) => ID_RE.test(t.spotifyTrackId));

  // Deduplicate releases by id — the albums endpoint repeats across markets.
  const seenAlbums = new Set<string>();
  const releases = (Array.isArray(albumsRes.body.items) ? albumsRes.body.items : []).map((raw) => {
    const o = raw as Record<string, unknown>;
    const id = str(o.id);
    if (!id || seenAlbums.has(id)) return null;
    seenAlbums.add(id);
    return {
      spotifyAlbumId: id,
      title: str(o.name) ?? "",
      releaseDate: str(o.release_date),
      releaseType: str(o.album_type),
      totalTracks: num(o.total_tracks) ?? 0,
      artworkUrl: imageOf(o.images),
    };
  }).filter((r): r is NonNullable<typeof r> => !!r);

  return {
    kind: "artist",
    spotifyArtistId: artistId,
    name: str(a.name),
    imageUrl: imageOf(a.images),
    followers: num((a.followers as Record<string, unknown>)?.total),
    popularity: num(a.popularity),
    genres: Array.isArray(a.genres) ? a.genres.filter((g): g is string => typeof g === "string") : [],
    topTracks,
    releases,
    restricted: {
      topTracks: topTracks.length === 0,
      // Spotify stopped returning followers/popularity/genres to this token type.
      profileStats: num((a.followers as Record<string, unknown>)?.total) === null && num(a.popularity) === null,
    },
    spotifyUrl: `https://open.spotify.com/artist/${artistId}`,
  };
}

export async function analyzePlaylist(playlistId: string): Promise<AnalyzerPlaylist> {
  if (!ID_RE.test(playlistId)) throw new Error("Invalid Spotify playlist id.");
  const cfg = defaultResolverConfig();
  const { status, body } = await spotifyCall("playlist", () => getSpotifyPlaylist(playlistId, cfg));
  assertSpotifyOk(status, "playlist");
  const p = body as Record<string, unknown>;

  const tracksObj = (p.tracks as Record<string, unknown>) ?? {};
  // Only the page embedded in the playlist response is readable: the separate
  // /playlists/{id}/tracks endpoint answers 403 for client-credentials tokens,
  // so a long playlist is reported as partial rather than silently truncated.
  const items: Record<string, unknown>[] = Array.isArray(tracksObj.items) ? [...(tracksObj.items as Record<string, unknown>[])] : [];
  const total = num(tracksObj.total) ?? items.length;

  const tracks = items.map((item) => {
    const t = (item.track as Record<string, unknown>) ?? {};
    const id = str(t.id);
    if (!id || !ID_RE.test(id)) return null; // local files / episodes
    const alb = (t.album as Record<string, unknown>) ?? {};
    return {
      spotifyTrackId: id,
      title: str(t.name) ?? "",
      artists: artistList(t.artists).map((x) => x.name),
      albumTitle: str(alb.name),
      durationMs: num(t.duration_ms),
      popularity: num(t.popularity),
      addedAt: str(item.added_at),
      releaseDate: str(alb.release_date),
    };
  }).filter((t): t is NonNullable<typeof t> => !!t);

  const counts = new Map<string, number>();
  for (const t of tracks) for (const a of t.artists) counts.set(a, (counts.get(a) ?? 0) + 1);
  const topArtists = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, count]) => ({ name, count }));

  return {
    kind: "playlist",
    spotifyPlaylistId: playlistId,
    name: str(p.name),
    description: str(p.description),
    owner: str((p.owner as Record<string, unknown>)?.display_name),
    isPublic: typeof p.public === "boolean" ? p.public : null,
    followers: num((p.followers as Record<string, unknown>)?.total),
    artworkUrl: imageOf(p.images),
    totalTracks: total,
    totalDurationMs: tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
    tracks,
    topArtists,
    spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
  };
}

export async function analyze(kind: AnalyzerKind, id: string, opts: { licensorUuid?: string | null; days?: number } = {}): Promise<AnalyzerResult> {
  logger.info({ event: "analyzer_request", identifierType: kind, trackId: id });
  switch (kind) {
    case "track": return analyzeTrack(id, opts);
    case "album": return analyzeAlbum(id);
    case "artist": return analyzeArtist(id);
    case "playlist": return analyzePlaylist(id);
  }
}
