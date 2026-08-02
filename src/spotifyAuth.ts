/**
 * Spotify credential pool + request execution.
 *
 * Every Spotify Web API call in the app goes through `spotifyRequest`, which
 * borrows a healthy credential from the pool, attaches its own cached token,
 * and reports the outcome so the pool can fail over:
 *
 *   429 → that app is parked for its Retry-After; the next call uses the next
 *         app immediately (a 13-hour lockout on one app no longer stops work).
 *   401/403 on the TOKEN request → that app's credentials are wrong, so the
 *         slot is disabled and reported instead of retried forever.
 *
 * Configure extra apps with numbered environment variables; slot 1 stays the
 * unsuffixed pair so existing setups keep working:
 *
 *   SPOTIFY_CLIENT_ID    / SPOTIFY_CLIENT_SECRET
 *   SPOTIFY_CLIENT_ID_2  / SPOTIFY_CLIENT_SECRET_2
 *   SPOTIFY_CLIENT_ID_3  / SPOTIFY_CLIENT_SECRET_3   … up to _10
 *
 * SECURITY: ids and secrets never leave this module; only slot labels and a
 * 4-character fingerprint appear in logs or status output.
 */

import { SPOTIFY } from "./config";
import { CredentialPool, PoolStatus, PoolUnavailableError, loadCredentialsFromEnv } from "./credentialPool";
import { acquireSpotifySlot } from "./spotifyRateGuard";
import { logger, maskSecret } from "./logger";

let pool: CredentialPool | null = null;

function base64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

export function getSpotifyPool(): CredentialPool {
  if (!pool) pool = new CredentialPool("spotify", loadCredentialsFromEnv("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"));
  return pool;
}

/** Re-read the environment (used after a config change and by tests). */
export function reloadSpotifyPool(): void {
  pool = new CredentialPool("spotify", loadCredentialsFromEnv("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"));
}

export function spotifyPoolStatus(): PoolStatus {
  return getSpotifyPool().status();
}

/** True when at least one Spotify app is configured. */
export function isSpotifyPoolConfigured(): boolean {
  return getSpotifyPool().configured;
}

export type SpotifyCall = { status: number; body: Record<string, unknown>; headers: Headers };

/**
 * Perform one Spotify Web API request through the pool.
 *
 * `url` must already be absolute. Returns the raw status/body so callers keep
 * their existing handling; a 429 is surfaced to the caller too, but the slot
 * has already been parked and the next call will use a different app.
 *
 * @throws {PoolUnavailableError} when no app is currently usable.
 */
export async function spotifyRequest(url: string, signal?: AbortSignal): Promise<SpotifyCall> {
  const p = getSpotifyPool();
  return p.run(async (handle) => {
    // Per-process pacing still applies: failover is a safety net, not a licence
    // to burn every app's quota at once.
    await acquireSpotifySlot();

    const token = await handle.withToken(async () => {
      const { id, secret } = handle.credential;
      const res = await fetch(SPOTIFY.tokenUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${base64(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
        cache: "no-store",
      }).catch((err) => { throw new Error(`Spotify token transport error: ${(err as Error).message}`); });

      if (res.status === 429) {
        handle.rateLimited(Number(res.headers.get("retry-after")));
        throw new Error("Spotify token request was rate-limited.");
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        // The token endpoint judges the client id/secret themselves, so this is
        // never a stale-token problem — disable the slot immediately.
        handle.rejected("bad_credentials");
        throw new Error(`Spotify rejected the credentials in slot ${handle.label} (HTTP ${res.status}).`);
      }
      if (!res.ok) throw new Error(`Spotify token request failed (HTTP ${res.status}).`);

      const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error("Spotify token response missing access_token.");
      logger.debug({ event: "spotify_token_acquired", matchStatus: `slot=${handle.label};${maskSecret(json.access_token)}` });
      return { token: json.access_token, ttlMs: (json.expires_in ?? 3600) * 1000 };
    });

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal,
      cache: "no-store",
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      // Park THIS key only; the pool immediately retries on the next one.
      handle.rateLimited(retryAfter);
      throw new Error("Spotify rate-limited this request.");
    }
    if (res.status === 401 || res.status === 403) {
      // Could be an expired token rather than a bad app: refresh once on the
      // same slot, and only disable it if the retry fails too.
      handle.authFailure(`http_${res.status}`);
      throw new Error(`Spotify returned HTTP ${res.status} for slot ${handle.label}.`);
    }

    let body: Record<string, unknown> = {};
    const text = await res.text();
    if (text) { try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; } }
    return { status: res.status, body, headers: res.headers };
  });
}

export { PoolUnavailableError };
