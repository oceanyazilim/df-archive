/**
 * Pure parsing + validation for the Spotify Web Player extended-metadata
 * response, plus strict identifier helpers. Shared by the backend (event
 * revalidation) and mirrored by the extension's plain-JS observer.
 *
 * SECURITY: this module only ever reads the allow-listed non-sensitive fields.
 * It never reads authorization headers, tokens, cookies, request bodies,
 * content_authorization_attributes, original_audio.uuid, cover images, etc.
 */

export type SanitizedSpotifyMetadata = {
  source: "spotify-web-player";
  capturedAt: string;
  spotifyTrackId: string;
  spotifyUri: string;
  trackGid: string | null;
  trackTitle: string;
  artists: string[];
  albumTitle: string | null;
  albumLabel: string | null;
  isrc: string | null;
  durationMs: number | null;
  licensorUuid: string;
};

/** Field limits used when validating an inbound sanitized payload. */
export const LIMITS = {
  maxString: 512,
  maxArtists: 32,
  maxPayloadBytes: 8 * 1024,
};

const BASE62_ID = /^[A-Za-z0-9]{22}$/;
const HEX32 = /^[a-f0-9]{32}$/;

/**
 * Normalize a licensor UUID to the canonical 32-hex form used in uuid's.json.
 * Returns null unless the value is a valid 32-char lowercase hex string.
 */
export function normalizeLicensorUuid(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (v.length >= 2) {
    const f = v[0], l = v[v.length - 1];
    if ((f === '"' && l === '"') || (f === "'" && l === "'")) v = v.slice(1, -1).trim();
  }
  v = v.toLowerCase().replace(/-/g, "");
  return HEX32.test(v) ? v : null;
}

/**
 * Extract a Spotify TRACK id from a URL, URI, or bare id. Query params are
 * ignored. Album/artist/playlist/episode/show URLs are rejected.
 */
export function extractSpotifyTrackId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const value = String(input).trim();
  if (!value) return null;

  // spotify:track:{id}
  const uri = value.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];

  // reject other spotify: URIs (album/artist/playlist/episode/show)
  if (/^spotify:(album|artist|playlist|episode|show|user):/i.test(value)) return null;

  // URL form
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!/(^|\.)spotify\.com$/i.test(url.hostname) && !/(^|\.)spotify\.link$/i.test(url.hostname)) {
        return null;
      }
      // path may be /track/{id} or /intl-xx/track/{id}
      const m = url.pathname.match(/\/track\/([A-Za-z0-9]{22})(?:\/|$)/);
      if (m) return m[1];
      // explicitly reject non-track resource URLs
      return null;
    } catch {
      return null;
    }
  }

  // bare id
  if (BASE62_ID.test(value)) return value;
  return null;
}

/** Strict matcher for the extended-metadata REQUEST url. */
export function parseMetadataRequestUrl(value: unknown): { trackGid: string } | null {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "spclient.wg.spotify.com") return null;
    const match = url.pathname.match(/^\/metadata\/4\/track\/([a-f0-9]{32})$/);
    if (!match) return null;
    return { trackGid: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

function firstString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Parse the extended-metadata RESPONSE body into a sanitized object, or null.
 *
 * The licensor UUID is taken from response.licensor.uuid, falling back to
 * response.album.licensor.uuid. It NEVER falls back to original_audio.uuid,
 * gid, album.gid, artist gid, ISRC, or any other field. If no valid licensor
 * UUID exists, the event is rejected (returns null).
 */
export function parseSpotifyExtendedMetadata(
  response: unknown,
  capturedAt = ""
): SanitizedSpotifyMetadata | null {
  if (response === null || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;

  const canonical = firstString(r.canonical_uri);
  if (!canonical || !canonical.startsWith("spotify:track:")) return null;
  const spotifyTrackId = extractSpotifyTrackId(canonical);
  if (!spotifyTrackId) return null;

  // Licensor UUID: top-level first, then album-level. Never anything else.
  const album = (r.album && typeof r.album === "object" ? (r.album as Record<string, unknown>) : {}) as Record<string, unknown>;
  const topLicensor = (r.licensor as Record<string, unknown> | undefined)?.uuid;
  const albLicensor = (album.licensor as Record<string, unknown> | undefined)?.uuid;
  const licensorUuid = normalizeLicensorUuid(topLicensor) ?? normalizeLicensorUuid(albLicensor);
  if (!licensorUuid) return null;

  const artists = Array.isArray(r.artist)
    ? (r.artist as unknown[])
        .map((a) => (a && typeof a === "object" ? firstString((a as Record<string, unknown>).name) : null))
        .filter((n): n is string => !!n)
        .slice(0, LIMITS.maxArtists)
    : [];

  let isrc: string | null = null;
  if (Array.isArray(r.external_id)) {
    for (const e of r.external_id as unknown[]) {
      if (e && typeof e === "object") {
        const eo = e as Record<string, unknown>;
        if (eo.type === "isrc" && firstString(eo.id)) { isrc = String(eo.id).trim(); break; }
      }
    }
  }

  const gid = firstString(r.gid);
  const trackGid = gid && /^[a-f0-9]{32}$/i.test(gid) ? gid.toLowerCase() : null;

  return {
    source: "spotify-web-player",
    capturedAt,
    spotifyTrackId,
    spotifyUri: `spotify:track:${spotifyTrackId}`,
    trackGid,
    trackTitle: firstString(r.name) ?? "",
    artists,
    albumTitle: firstString(album.name),
    albumLabel: firstString(album.label),
    isrc,
    durationMs: typeof r.duration === "number" && Number.isFinite(r.duration) ? r.duration : null,
    licensorUuid,
  };
}

const ALLOWED_KEYS = new Set([
  "source", "capturedAt", "spotifyTrackId", "spotifyUri", "trackGid",
  "trackTitle", "artists", "albumTitle", "albumLabel", "isrc",
  "durationMs", "licensorUuid",
]);

/**
 * Re-validate an inbound sanitized payload from the extension: allow-list keys,
 * enforce formats, lengths, and size. Returns a clean, minimal object or an
 * error. Rejects any unexpected property (e.g. a smuggled token field).
 */
export function validateSanitizedPayload(
  input: unknown
): { ok: true; value: SanitizedSpotifyMetadata } | { ok: false; code: string; message: string } {
  if (input === null || typeof input !== "object") {
    return { ok: false, code: "INVALID_PAYLOAD", message: "Payload must be an object." };
  }
  const size = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (size > LIMITS.maxPayloadBytes) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Payload exceeds the size limit." };
  }
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, code: "UNEXPECTED_FIELD", message: `Unexpected field: ${key}` };
    }
  }
  const trackId = extractSpotifyTrackId(obj.spotifyTrackId);
  if (!trackId) return { ok: false, code: "INVALID_TRACK_ID", message: "Invalid spotifyTrackId." };
  const licensorUuid = normalizeLicensorUuid(obj.licensorUuid);
  if (!licensorUuid) return { ok: false, code: "INVALID_UUID", message: "Invalid licensorUuid." };

  const str = (v: unknown, max = LIMITS.maxString): string | null => {
    if (typeof v !== "string") return null;
    return v.length <= max ? v : v.slice(0, max);
  };
  const artists = Array.isArray(obj.artists)
    ? (obj.artists as unknown[]).filter((a) => typeof a === "string").slice(0, LIMITS.maxArtists).map((a) => String(a).slice(0, LIMITS.maxString))
    : [];

  const trackGidRaw = typeof obj.trackGid === "string" && /^[a-f0-9]{32}$/i.test(obj.trackGid) ? obj.trackGid.toLowerCase() : null;

  return {
    ok: true,
    value: {
      source: "spotify-web-player",
      capturedAt: str(obj.capturedAt) ?? "",
      spotifyTrackId: trackId,
      spotifyUri: `spotify:track:${trackId}`,
      trackGid: trackGidRaw,
      trackTitle: str(obj.trackTitle) ?? "",
      artists,
      albumTitle: str(obj.albumTitle),
      albumLabel: str(obj.albumLabel),
      isrc: str(obj.isrc, 32),
      durationMs: typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs) ? obj.durationMs : null,
      licensorUuid,
    },
  };
}
