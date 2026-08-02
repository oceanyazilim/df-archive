/**
 * Soundcharts + Spotify + app configuration, read from server environment.
 * All secrets stay server-side. Config is read lazily so tests can override env.
 */

import * as path from "path";

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export type SoundchartsConfig = {
  enabled: boolean;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  useLegacyAuth: boolean;
  legacyAppId: string;
  legacyApiKey: string;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  concurrency: number;
  maxRequestsPerMinute: number;
  songApiVersion: string;
  idApiVersion: string;
  spotifyPlatform: string;
};

export function getSoundchartsConfig(): SoundchartsConfig {
  return {
    enabled: bool("SOUNDCHARTS_ENABLED", true),
    baseUrl: str("SOUNDCHARTS_BASE_URL", "https://customer.api.soundcharts.com").replace(/\/+$/, ""),
    tokenUrl: str("SOUNDCHARTS_TOKEN_URL", "https://account.soundcharts.com/oauth/token"),
    clientId: str("SOUNDCHARTS_CLIENT_ID"),
    clientSecret: str("SOUNDCHARTS_CLIENT_SECRET"),
    teamId: str("SOUNDCHARTS_TEAM_ID", "fyapar-api"),
    useLegacyAuth: bool("SOUNDCHARTS_USE_LEGACY_AUTH", false),
    legacyAppId: str("SOUNDCHARTS_LEGACY_APP_ID"),
    legacyApiKey: str("SOUNDCHARTS_LEGACY_API_KEY"),
    timeoutMs: int("SOUNDCHARTS_REQUEST_TIMEOUT_MS", 15000),
    maxRetries: int("SOUNDCHARTS_MAX_RETRIES", 3),
    cacheTtlMs: int("SOUNDCHARTS_CACHE_TTL_SECONDS", 900) * 1000,
    concurrency: int("SOUNDCHARTS_CONCURRENCY", 5),
    maxRequestsPerMinute: int("SOUNDCHARTS_MAX_REQUESTS_PER_MINUTE", 1000),
    // Documented current versions; overridable without code changes.
    songApiVersion: str("SOUNDCHARTS_SONG_API_VERSION", "v2.25"),
    idApiVersion: str("SOUNDCHARTS_ID_API_VERSION", "v2"),
    spotifyPlatform: str("SOUNDCHARTS_SPOTIFY_PLATFORM", "spotify"),
  };
}

/** Bearer (client-credentials) configured. */
export function isBearerConfigured(c = getSoundchartsConfig()): boolean {
  return Boolean(c.clientId && c.clientSecret);
}
/** Legacy header auth explicitly enabled and configured. */
export function isLegacyConfigured(c = getSoundchartsConfig()): boolean {
  return Boolean(c.useLegacyAuth && c.legacyAppId && c.legacyApiKey);
}
/** Soundcharts is usable if enabled AND either auth mode is configured. */
export function isSoundchartsConfigured(c = getSoundchartsConfig()): boolean {
  return c.enabled && (isBearerConfigured(c) || isLegacyConfigured(c));
}

export type LookupConfig = { requestTimeoutMs: number; maxBatchSize: number };
export function getLookupConfig(): LookupConfig {
  return {
    requestTimeoutMs: int("LOOKUP_REQUEST_TIMEOUT_MS", 30000),
    maxBatchSize: int("LOOKUP_MAX_BATCH_SIZE", 100),
  };
}

export type SpotifyConfig = { enabled: boolean; clientId: string; clientSecret: string };
export function getSpotifyConfig(): SpotifyConfig {
  return {
    enabled: bool("SPOTIFY_API_ENABLED", true),
    clientId: str("SPOTIFY_CLIENT_ID"),
    clientSecret: str("SPOTIFY_CLIENT_SECRET"),
  };
}
export function isSpotifyFallbackConfigured(s = getSpotifyConfig()): boolean {
  return Boolean(s.enabled && s.clientId && s.clientSecret);
}

export type AppConfig = {
  appName: string;
  appUrl: string;
  uuidMappingPath: string;
  historyEnabled: boolean;
  historyMax: number;
};
export function getAppConfig(): AppConfig {
  const configured = str("UUID_MAPPING_PATH", "json/uuid's.json");
  return {
    appName: str("APP_NAME", "Ocean Distro Finder"),
    appUrl: str("APP_URL", "http://127.0.0.1:3000"),
    uuidMappingPath: path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured),
    historyEnabled: bool("LOOKUP_HISTORY_ENABLED", true),
    historyMax: int("LOOKUP_HISTORY_MAX_ITEMS", 100),
  };
}
