/**
 * Spotify Web API pacing.
 *
 * This module is now ONLY a token bucket. Cooldowns belong to the credential
 * pool (`src/credentialPool.ts`), which parks the individual key that was
 * throttled and fails over to the next one — a process-wide cooldown here
 * would defeat that by blocking healthy keys too.
 *
 * Pacing still matters: failover is a safety net, not a licence to burn every
 * key's quota at once, so outgoing calls stay under a conservative ceiling.
 */

import { getSpotifyPool } from "./spotifyAuth";
import { formatWait } from "./credentialPool";

/** Requests per rolling minute across the whole process. */
const MAX_PER_MINUTE = Number.parseInt(process.env.SPOTIFY_MAX_REQUESTS_PER_MINUTE ?? "", 10) || 90;
const WINDOW_MS = 60_000;

let timestamps: number[] = [];

/**
 * Cooldown state derived from the credential pool: "active" only when EVERY
 * key is parked, with the earliest key's remaining wait.
 */
export function spotifyCooldownInfo(): { active: boolean; remainingMs: number; retryAfterSec: number } {
  const status = getSpotifyPool().status();
  const active = status.total > 0 && status.available === 0 && status.cooling > 0;
  const remainingMs = active ? status.recoversInMs : 0;
  return { active, remainingMs, retryAfterSec: Math.ceil(remainingMs / 1000) };
}

export function spotifyCooldownRemainingMs(): number {
  return spotifyCooldownInfo().remainingMs;
}

/**
 * Kept for callers that used to record a global 429. Parking is now handled by
 * the pool at the point of failure, so this is a no-op retained for API
 * compatibility.
 */
export function noteSpotifyRateLimit(_retryAfterSeconds: number | null): void {
  void _retryAfterSeconds;
}

/** Reset pacing state (tests). */
export function clearSpotifyCooldown(): void {
  timestamps = [];
}

export class SpotifyCooldownError extends Error {
  readonly code = "SPOTIFY_RATE_LIMITED";
  readonly httpStatus = 429;
  readonly remainingMs: number;
  constructor(remainingMs: number) {
    super(
      `Every Spotify API key is rate-limited. The next one frees up in about ${formatWait(remainingMs)}. ` +
      `Distributor lookups from your own Spotify client are unaffected.`
    );
    this.name = "SpotifyCooldownError";
    this.remainingMs = remainingMs;
  }
}

export { formatWait as formatDuration };

/**
 * Wait just long enough to stay under the per-minute ceiling.
 * Never throws for a cooldown — an exhausted pool raises `PoolUnavailableError`
 * from the pool itself, which carries the accurate per-key ETA.
 */
export async function acquireSpotifySlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    timestamps = timestamps.filter((t) => now - t < WINDOW_MS);
    if (timestamps.length < MAX_PER_MINUTE) {
      timestamps.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - timestamps[0]) + 5;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 2000)));
  }
}
