/**
 * Shared client-side types + small helpers for the dashboard. These mirror the
 * server responses — they never invent fields the backend does not return.
 */

export type View =
  | "lookup" | "history"
  | "uuid" | "distributors" | "artists" | "albums" | "tracks"
  | "analytics" | "reports"
  | "status" | "settings";

export type SourceState = "operational" | "not_configured" | "failed" | "not_found" | "plan_restricted" | "not_applicable";

export type Workspace = {
  success: boolean;
  input: { original: string; type: string; normalized: string };
  identity: {
    spotifyTrackId: string | null; spotifyTrackGid: string | null; spotifyAlbumGid: string | null; spotifyAlbumId: string | null;
    soundchartsSongUuid: string | null; licensorUuid: string | null; distributorUuid: string | null; originalAudioUuid: string | null;
    isrc: string | null; upc: string | null;
  };
  metadata: {
    trackTitle: string | null; artists: string[]; albumTitle: string | null; releaseDate: string | null;
    durationMs: number | null; explicit: boolean | null; genres: string[]; label: string | null; artworkUrl: string | null;
    popularity: number | null;
  };
  distributor: { name: string | null; uuid: string | null; status: string };
  sourceStatus: { spotify: SourceState; soundcharts: SourceState; uuidMapping: string };
  soundchartsUrl: string | null; spotifyUrl: string | null; freshness: string;
  errors: { code: string; message: string }[];
};

export type Health = {
  status: string; primaryLookupReady: boolean; uuidMappingCount: number; uuidMappingConflicts: number;
  components: Record<string, string>; spotifyFallbackEnabled: boolean; soundchartsConfigured: boolean;
  /** Present while Spotify is rate-limiting this app; drives the panel banner. */
  spotifyCooldown?: { active: boolean; remainingMs: number; retryAfterSec: number };
  /** Per-provider credential pools — counts and masked fingerprints only. */
  credentialPools?: Record<string, PoolStatus>;
};

export type PoolSlot = {
  label: string;
  fingerprint: string;
  secretFingerprint: string;
  state: "available" | "active" | "cooling" | "disabled" | "invalid";
  cooldownRemainingMs: number;
  cooldownEndsAt: string | null;
  disabledReason: string | null;
  requests: number;
  failovers: number;
  lastUsedAt: string | null;
  lastErrorCode: string | null;
  tokenExpiresAt: string | null;
  account: string | null;
  legacy: { present: boolean; fingerprint: string; secretFingerprint: string; issue: string | null } | null;
};

export type PoolStatus = {
  provider: string;
  total: number; available: number; cooling: number; disabled: number; invalid: number;
  legacyAvailable: number;
  recoversInMs: number;
  slots: PoolSlot[];
  issues: { slot: number; reason: string; message: string }[];
};

export type ReleaseTrack = {
  spotifyTrackId: string; title: string; artists: string[]; trackNumber: number; discNumber: number;
  durationMs: number; explicit: boolean; spotifyUrl: string; isrc: string | null; analysisStatus: string;
};
export type AlbumRelease = {
  spotifyAlbumId: string; title: string; artists: string[]; artworkUrl: string | null; releaseType: string;
  releaseDate: string | null; upc: string | null; label: string | null; totalTracks: number; discCount: number; tracks: ReleaseTrack[];
};

export type TrackStatus = "not_loaded" | "loading" | "ready" | "partial" | "failed";

export type HistoryItem = {
  id?: string; at: string; input: string; inputType?: string;
  soundchartsSongUuid?: string | null; trackTitle: string | null; artists?: string[]; isrc?: string | null;
  distributor: string | null; resolutionStatus: string; durationMs?: number;
  artworkUrl?: string | null; albumTitle?: string | null; spotifyTrackId?: string | null; spotifyAlbumId?: string | null;
  label?: string | null; releaseDate?: string | null;
};

export const NA = "Not available";
export const ALBUM_ID_RE = /^[A-Za-z0-9]{22}$/;

export async function jget<T>(u: string): Promise<T> { const r = await fetch(u); return r.json(); }

export function dur(ms: number | null | undefined): string | null {
  return ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : null;
}

export const fmtCompact = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`;

export function fmtDate(s: string | null | undefined): string {
  if (!s) return NA;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function deriveTrackStatus(ws: Workspace): TrackStatus {
  const hasCore = !!ws.metadata?.trackTitle || !!ws.identity?.soundchartsSongUuid;
  if (!hasCore) return "failed";
  return ws.errors?.length ? "partial" : "ready";
}

/** Build a one-track release from a single-track workspace (no album context). */
export function synthReleaseFromWorkspace(ws: Workspace): AlbumRelease {
  const tid = ws.identity.spotifyTrackId ?? ws.input.normalized;
  return {
    spotifyAlbumId: ws.identity.spotifyAlbumId ?? "",
    title: ws.metadata.albumTitle ?? ws.metadata.trackTitle ?? "Release",
    artists: ws.metadata.artists ?? [],
    artworkUrl: ws.metadata.artworkUrl ?? null,
    releaseType: "single",
    releaseDate: ws.metadata.releaseDate ?? null,
    upc: ws.identity.upc ?? null,
    label: ws.metadata.label ?? null,
    totalTracks: 1,
    discCount: 1,
    tracks: [{
      spotifyTrackId: tid, title: ws.metadata.trackTitle ?? "Untitled", artists: ws.metadata.artists ?? [],
      trackNumber: 1, discNumber: 1, durationMs: ws.metadata.durationMs ?? 0, explicit: ws.metadata.explicit ?? false,
      spotifyUrl: ws.spotifyUrl ?? (ws.identity.spotifyTrackId ? `https://open.spotify.com/track/${ws.identity.spotifyTrackId}` : ""),
      isrc: ws.identity.isrc ?? null, analysisStatus: "ready",
    }],
  };
}

/** Honest overall status — never claims full operation when the mapping is unavailable. */
export function overallStatus(health: Health | null): { label: string; cls: string } {
  if (!health) return { label: "Checking…", cls: "warn" };
  const distributorReady = health.uuidMappingCount > 0;
  if (health.primaryLookupReady && distributorReady) return { label: "Operational", cls: "ok" };
  if (!distributorReady) return { label: "Distributor lookup unavailable", cls: "warn" };
  if (!health.primaryLookupReady) return { label: "Degraded", cls: "warn" };
  return { label: "Partially operational", cls: "warn" };
}
