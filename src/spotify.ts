/**
 * Official Spotify Web API integration (server-side only).
 *
 * Uses ONLY the public Web API (api.spotify.com) with a Client Credentials
 * token. It never touches the private Web Player endpoints (spclient.wg.spotify.com)
 * and never reads or reuses Web Player session tokens. The client id/secret and
 * the access token stay on the server and are never logged or returned.
 */

import { SPOTIFY, ResolverConfig, defaultResolverConfig } from "./config";
import { InternalApiError } from "./internalApi";
import { executeWithRetry } from "./retry";
import { TrackMetadataFields } from "./types";
import { logger, maskSecret } from "./logger";
import { spotifyRequest, getSpotifyPool, reloadSpotifyPool } from "./spotifyAuth";

const SPOTIFY_ID = /[A-Za-z0-9]{22}/;

/**
 * Parse a Spotify track id from a URL, URI, or bare id.
 * Accepts:
 *   https://open.spotify.com/track/{id}[?si=...]
 *   https://open.spotify.com/intl-xx/track/{id}
 *   spotify:track:{id}
 *   {id}  (22-char base62)
 * @returns the track id, or null if the input is not a Spotify track reference.
 */
export function parseSpotifyTrackId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  // spotify:track:{id}
  const uri = value.match(/spotify:track:([A-Za-z0-9]{22})/);
  if (uri) return uri[1];

  // any URL containing /track/{id}
  const url = value.match(/\/track\/([A-Za-z0-9]{22})/);
  if (url) return url[1];

  // bare id
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value;

  // last resort: a 22-char token embedded in the string, but only if it also
  // mentions spotify/track to avoid misinterpreting unrelated ids.
  if (/spotif|track/i.test(value)) {
    const loose = value.match(SPOTIFY_ID);
    if (loose) return loose[0];
  }
  return null;
}

// ---------- Client Credentials tokens ----------
// Tokens are owned per credential slot by the pool (src/spotifyAuth.ts) so one
// throttled app cannot poison another's cache.

export function clearSpotifyTokenCache(): void {
  reloadSpotifyPool();
}

/**
 * A usable Spotify access token from the credential pool.
 * Kept for callers that only need a bearer token; all HTTP traffic should use
 * `spotifyRequest` so rate-limit failover applies.
 */
export async function getSpotifyAccessToken(): Promise<string> {
  const pool = getSpotifyPool();
  if (!pool.configured) throw new InternalApiError("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not configured.", null, false);
  return pool.run((handle) => handle.withToken(async () => {
    const { id, secret } = handle.credential;
    const res = await fetch(SPOTIFY.tokenUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (res.status === 429) { handle.rateLimited(Number(res.headers.get("retry-after"))); throw new InternalApiError("Spotify token request was rate-limited.", 429, true); }
    if (res.status === 400 || res.status === 401 || res.status === 403) { handle.rejected("bad_credentials"); throw new InternalApiError(`Spotify rejected the credentials in slot ${handle.label}.`, res.status, false); }
    if (!res.ok) throw new InternalApiError(`Spotify token request failed (HTTP ${res.status}).`, res.status, res.status >= 500);
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new InternalApiError("Spotify token response missing access_token.", res.status, false);
    logger.debug({ event: "spotify_token_acquired", matchStatus: `slot=${handle.label};${maskSecret(json.access_token)}` });
    return { token: json.access_token, ttlMs: (json.expires_in ?? 3600) * 1000 };
  }));
}

// ---------- Track fetch + extraction ----------
export type SpotifyTrackResponse = Record<string, unknown>;

/**
 * Fetch a track from the official Spotify Web API with retry/timeout/backoff.
 */
export async function getSpotifyTrack(
  trackId: string,
  cfg: ResolverConfig,
  signal?: AbortSignal
): Promise<{ status: number; body: SpotifyTrackResponse; attempts: number }> {
  const url = new URL(`${SPOTIFY.apiBase}/tracks/${encodeURIComponent(trackId)}`);
  if (SPOTIFY.market) url.searchParams.set("market", SPOTIFY.market);
  return executeWithRetry("Spotify track lookup", cfg, signal, async (s) => {
    const { status, body } = await spotifyRequest(url.toString(), s);
    return { status, body };
  });
}

/** The public Spotify album id a track belongs to (track.album.id). */
export function extractSpotifyAlbumIdFromTrack(track: SpotifyTrackResponse | null | undefined): string | null {
  const alb = (track as Record<string, unknown> | null | undefined)?.album as Record<string, unknown> | undefined;
  const id = alb?.id;
  return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

/**
 * Fetch a Spotify album with its full (paginated) tracklist, preserving disc +
 * track ordering. Used for album/EP/multi-track releases.
 */
export async function getSpotifyAlbum(
  albumId: string,
  cfg: ResolverConfig,
  signal?: AbortSignal
): Promise<{ status: number; body: SpotifyTrackResponse; tracks: Record<string, unknown>[] }> {
  const url = new URL(`${SPOTIFY.apiBase}/albums/${encodeURIComponent(albumId)}`);
  if (SPOTIFY.market) url.searchParams.set("market", SPOTIFY.market);

  const { status, body } = await executeWithRetry("Spotify album lookup", cfg, signal, async (s) => {
    const r = await spotifyRequest(url.toString(), s);
    return { status: r.status, body: r.body };
  });

  const tracksObj = (body as Record<string, unknown>).tracks as { items?: Record<string, unknown>[]; next?: string | null } | undefined;
  const tracks: Record<string, unknown>[] = Array.isArray(tracksObj?.items) ? [...tracksObj!.items!] : [];
  // Paginate remaining pages (albums with > 50 tracks).
  let next = tracksObj?.next ?? null;
  let guard = 0;
  while (next && guard++ < 20) {
    const page = await executeWithRetry("Spotify album tracks page", cfg, signal, async (s) => {
      const r = await spotifyRequest(next!, s);
      return { status: r.status, body: r.body };
    });
    const p = page.body as { items?: Record<string, unknown>[]; next?: string | null };
    if (Array.isArray(p.items)) tracks.push(...p.items);
    next = p.next ?? null;
  }
  return { status, body, tracks };
}

/**
 * Fetch any public Spotify API resource as JSON.
 *
 * `market` is NOT added automatically: `/artists/{id}` rejects it with 400,
 * while `/artists/{id}/top-tracks` requires it. Each caller states what it
 * needs via `params`.
 */
async function getSpotifyResource(
  resourcePath: string,
  label: string,
  cfg: ResolverConfig,
  signal?: AbortSignal,
  params?: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(`${SPOTIFY.apiBase}${resourcePath}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  return executeWithRetry(label, cfg, signal, async (s) => {
    const r = await spotifyRequest(url.toString(), s);
    return { status: r.status, body: r.body };
  });
}

/**
 * Find the Spotify album id for a UPC/EAN barcode via catalogue search.
 * Returns null when the barcode is not in Spotify's catalogue.
 */
export async function findAlbumIdByUpc(upc: string, cfg?: ResolverConfig, signal?: AbortSignal): Promise<string | null> {
  const params: Record<string, string> = { q: `upc:${upc}`, type: "album", limit: "5" };
  if (SPOTIFY.market) params.market = SPOTIFY.market;
  const { status, body } = await getSpotifyResource("/search", "Spotify UPC search", cfg ?? defaultResolverConfig(), signal, params);
  if (status < 200 || status >= 300) return null;
  const items = (body.albums as { items?: Record<string, unknown>[] } | undefined)?.items;
  const first = Array.isArray(items) ? items[0] : undefined;
  const id = first?.id;
  return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

/**
 * Find a track by ISRC via catalogue search. Returns the raw track object
 * (id, name, album, external_ids) or null when the recording is not in
 * Spotify's catalogue — the case for releases fully taken down.
 */
export async function findTrackByIsrc(isrc: string, cfg?: ResolverConfig, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const params: Record<string, string> = { q: `isrc:${isrc}`, type: "track", limit: "5" };
  if (SPOTIFY.market) params.market = SPOTIFY.market;
  const { status, body } = await getSpotifyResource("/search", "Spotify ISRC search", cfg ?? defaultResolverConfig(), signal, params);
  if (status < 200 || status >= 300) return null;
  const items = (body.tracks as { items?: Record<string, unknown>[] } | undefined)?.items;
  const first = Array.isArray(items) ? items[0] : undefined;
  const id = first?.id;
  return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? first! : null;
}

/** Artist profile: name, followers, popularity, genres, images. No market param. */
export function getSpotifyArtist(artistId: string, cfg: ResolverConfig, signal?: AbortSignal) {
  return getSpotifyResource(`/artists/${encodeURIComponent(artistId)}`, "Spotify artist lookup", cfg, signal);
}

/** An artist's top tracks (up to 10). The market parameter is mandatory here. */
export function getSpotifyArtistTopTracks(artistId: string, cfg: ResolverConfig, signal?: AbortSignal) {
  return getSpotifyResource(
    `/artists/${encodeURIComponent(artistId)}/top-tracks`,
    "Spotify artist top tracks",
    cfg, signal,
    { market: SPOTIFY.market || "US" }
  );
}

/**
 * An artist's releases (albums + singles), newest first.
 *
 * Measured 2026-07: this endpoint now rejects `limit` above 10 with
 * "Invalid limit" — the documented maximum of 50 no longer applies to
 * client-credentials tokens.
 */
export function getSpotifyArtistAlbums(artistId: string, cfg: ResolverConfig, signal?: AbortSignal, offset = 0) {
  const params: Record<string, string> = { include_groups: "album,single", limit: "10", offset: String(Math.max(0, offset)) };
  if (SPOTIFY.market) params.market = SPOTIFY.market;
  return getSpotifyResource(`/artists/${encodeURIComponent(artistId)}/albums`, "Spotify artist albums", cfg, signal, params);
}

/**
 * Playlist metadata plus its first page of tracks.
 *
 * The separate `/playlists/{id}/tracks` paging endpoint answers 403 for
 * client-credentials tokens, so only the page embedded in this response is
 * available. Callers must present the result as a partial list rather than
 * pretending it is the whole playlist.
 */
export function getSpotifyPlaylist(playlistId: string, cfg: ResolverConfig, signal?: AbortSignal) {
  const params: Record<string, string> = { additional_types: "track" };
  if (SPOTIFY.market) params.market = SPOTIFY.market;
  return getSpotifyResource(`/playlists/${encodeURIComponent(playlistId)}`, "Spotify playlist lookup", cfg, signal, params);
}

/**
 * Extract the licensor UUID from a Spotify track metadata response.
 *
 * Reads ONLY the licensor UUID property: track-level `metadata.licensor.uuid`
 * is preferred; album-level `metadata.album.licensor.uuid` is the defined
 * fallback. Returns the raw, unmodified value (normalization happens later), or
 * null. It NEVER returns any other identifier (spotify track id, track gid,
 * album id, album gid, soundcharts uuid, original audio uuid, artist id,
 * artwork id, ISRC, or UPC).
 *
 * IMPORTANT (verified at runtime): the official Spotify PUBLIC Web API
 * (api.spotify.com/v1/tracks/{id}) does NOT include a licensor field, so this
 * returns null for those responses. It reads the value only when a Spotify
 * metadata model that actually carries it is passed (e.g. a Web Player metadata
 * body). The licensor UUID for public-API tracks comes from the local track
 * catalog (json/tracks.json), not from this function.
 */
export function extractLicensorUuidFromSpotifyMetadata(
  metadata: SpotifyTrackResponse | null | undefined
): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const trackLicensor = (m.licensor as Record<string, unknown> | undefined)?.uuid;
  if (typeof trackLicensor === "string" && trackLicensor.trim().length > 0) return trackLicensor.trim();
  const album = (m.album as Record<string, unknown> | undefined) ?? {};
  const albumLicensor = (album.licensor as Record<string, unknown> | undefined)?.uuid;
  if (typeof albumLicensor === "string" && albumLicensor.trim().length > 0) return albumLicensor.trim();
  return null;
}

/** Extract the ISRC from a Spotify track response: external_ids.isrc. */
export function extractIsrc(track: SpotifyTrackResponse | null | undefined): string | null {
  const ext = (track as Record<string, unknown> | null | undefined)?.external_ids as
    | Record<string, unknown>
    | undefined;
  const isrc = ext?.isrc;
  return typeof isrc === "string" && isrc.trim().length > 0 ? isrc.trim() : null;
}

/** Extract non-sensitive display metadata. Never used to determine distributor. */
export function extractSpotifyMetadata(
  track: SpotifyTrackResponse | null | undefined
): TrackMetadataFields {
  const t = (track ?? {}) as Record<string, unknown>;
  const album = (t.album ?? {}) as Record<string, unknown>;
  const artists = Array.isArray(t.artists) ? (t.artists as Record<string, unknown>[]) : [];
  const images = Array.isArray(album.images) ? (album.images as Record<string, unknown>[]) : [];
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  return {
    title: str(t.name),
    artist: artists.map((a) => str(a.name)).filter(Boolean).join(", ") || null,
    isrc: extractIsrc(track),
    upc: str((album.external_ids as Record<string, unknown> | undefined)?.upc),
    releaseTitle: str(album.name),
    // NOTE: display only. Spotify label/copyrights are NOT used for matching.
    label: str(album.label),
    artworkUrl: images.length > 0 ? str(images[0].url) : null,
  };
}
