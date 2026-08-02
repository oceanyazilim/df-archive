/**
 * Centralized, overridable configuration.
 *
 * Every tunable lives here so values are not scattered across the codebase.
 * Numeric defaults can be overridden via environment variables.
 */

import * as path from "path";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolFromEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

// Accept both DISTRO_* (library) and LOOKUP_* (panel) names for the shared knobs.
export const DEFAULT_CONCURRENCY = intFromEnv("LOOKUP_CONCURRENCY", intFromEnv("DISTRO_CONCURRENCY", 10));
export const DEFAULT_TIMEOUT_MS = intFromEnv("LOOKUP_TIMEOUT_MS", intFromEnv("DISTRO_TIMEOUT_MS", 15000));
export const DEFAULT_MAX_RETRIES = intFromEnv("LOOKUP_MAX_RETRIES", intFromEnv("DISTRO_MAX_RETRIES", 3));

/** Base delay for exponential backoff between retries, in milliseconds. */
export const DEFAULT_RETRY_BASE_MS = intFromEnv("DISTRO_RETRY_BASE_MS", 300);
/** Upper bound for a single backoff wait, in milliseconds. */
export const DEFAULT_RETRY_MAX_MS = intFromEnv("DISTRO_RETRY_MAX_MS", 5000);

/** Short-term cache time-to-live, in milliseconds (0 disables caching). */
export const DEFAULT_CACHE_TTL_MS = intFromEnv("LOOKUP_CACHE_TTL_MS", intFromEnv("DISTRO_CACHE_TTL_MS", 60000));

/** Maximum number of tracks accepted in a single batch request. */
export const MAX_TRACKS_PER_BATCH = intFromEnv("LOOKUP_MAX_BATCH", 500);

/** Demo mode: use mock track responses instead of the live internal API. */
export const DEMO_MODE = boolFromEnv("DEMO_MODE", false);

/**
 * Absolute path to the UUID mapping file.
 * Resolved from the project working directory so it works both in the compiled
 * library and inside the Next.js server runtime.
 */
export const UUID_MAPPING_PATH =
  process.env.DISTRO_UUID_MAPPING_PATH ??
  path.join(process.cwd(), "json", "uuid's.json");

/**
 * Absolute path to the local track catalog: Spotify-track-id / ISRC -> licensor
 * UUID. This is the authorized track-to-UUID source for local resolution.
 */
export const TRACKS_MAPPING_PATH =
  process.env.DISTRO_TRACKS_MAPPING_PATH ??
  path.join(process.cwd(), "json", "tracks.json");

/** HTTP status codes that are safe to retry (temporary failures). */
export const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * HTTP status codes that are permanent and must never be retried.
 * 404 is treated as permanent by default (existing API can override).
 */
export const PERMANENT_HTTP_STATUS = new Set([400, 401, 403, 404]);

/**
 * Legacy internal API wiring (kept for the standalone library path). The Next
 * panel uses the Spotify + licensor two-stage flow below instead.
 */
export const INTERNAL_API = {
  url: process.env.INTERNAL_API_URL ?? "",
  tokenHeader: process.env.INTERNAL_API_TOKEN_HEADER ?? "Authorization",
  tokenPrefix: process.env.INTERNAL_API_TOKEN_PREFIX ?? "Bearer",
  trackField: process.env.INTERNAL_API_TRACK_FIELD ?? "trackId",
  method: (process.env.INTERNAL_API_METHOD ?? "GET").toUpperCase(),
};

/**
 * Official Spotify Web API (Client Credentials). Read entirely on the server.
 * Client id/secret are never exposed to the browser. We use ONLY the public
 * Web API — never the private Web Player (spclient) endpoints or its tokens.
 */
export const SPOTIFY = {
  clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  tokenUrl: process.env.SPOTIFY_TOKEN_URL ?? "https://accounts.spotify.com/api/token",
  apiBase: process.env.SPOTIFY_API_BASE ?? "https://api.spotify.com/v1",
  market: process.env.SPOTIFY_MARKET ?? "",
};

/**
 * The separate authorized licensor API that maps an ISRC to a licensor UUID.
 * Server-side only; the token is never exposed to the client.
 */
export const LICENSOR_API = {
  url: process.env.LICENSOR_API_URL ?? "",
  tokenHeader: process.env.LICENSOR_API_TOKEN_HEADER ?? "Authorization",
  tokenPrefix: process.env.LICENSOR_API_TOKEN_PREFIX ?? "Bearer",
  /**
   * The request field/query-param name the licensor API expects for the ISRC.
   * Accepts LICENSOR_API_ISRC_FIELD or the canonical LICENSOR_API_TRACK_FIELD.
   */
  isrcField:
    process.env.LICENSOR_API_ISRC_FIELD ??
    process.env.LICENSOR_API_TRACK_FIELD ??
    "isrc",
  /** "GET" appends the ISRC as a query param; "POST" sends it as a JSON body. */
  method: (process.env.LICENSOR_API_METHOD ?? "GET").toUpperCase(),
  /**
   * Optional comma-separated dotted paths to try FIRST when extracting the
   * licensor UUID from the response, e.g. "data.licensor.uuid,licensorUuid".
   */
  uuidPaths: (process.env.LICENSOR_API_UUID_PATHS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
};

/** True when the official Spotify Web API credentials are present. */
export function isSpotifyConfigured(): boolean {
  return Boolean(SPOTIFY.clientId && SPOTIFY.clientSecret);
}

/** True when the authorized licensor API URL + token are present. */
export function isLicensorConfigured(): boolean {
  return Boolean(LICENSOR_API.url && (process.env.LICENSOR_API_TOKEN ?? "").trim());
}

/**
 * True when the full live pipeline (Spotify + licensor) is configured.
 * Note: Spotify is optional for ISRC-only lookups — see distributorResolutionReady.
 */
export function isLivePipelineConfigured(): boolean {
  return isSpotifyConfigured() && isLicensorConfigured();
}

export type ResolverConfig = {
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  cacheTtlMs: number;
};

export function defaultResolverConfig(): ResolverConfig {
  return {
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    retryMaxMs: DEFAULT_RETRY_MAX_MS,
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  };
}
