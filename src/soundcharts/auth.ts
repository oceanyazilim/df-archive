/**
 * Soundcharts OAuth (client credentials) with credential-pool failover.
 * Server-only.
 *
 * - Basic auth: username=CLIENT_ID, password=CLIENT_SECRET
 * - Body: grant_type=client_credentials (+ team_id when set)
 * - Each credential slot owns its own cached token and single-flight promise,
 *   so a throttled account never poisons another's cache.
 * - A 429 parks that account for its Retry-After and the next call uses the
 *   next account; a 400/401/403 disables the slot and reports it.
 * - The Basic header and the bearer token are NEVER logged or returned.
 *
 * Extra accounts are configured with numbered environment variables; slot 1 is
 * the unsuffixed pair so existing setups keep working:
 *
 *   SOUNDCHARTS_CLIENT_ID   / SOUNDCHARTS_CLIENT_SECRET   [ / SOUNDCHARTS_TEAM_ID ]
 *   SOUNDCHARTS_CLIENT_ID_2 / SOUNDCHARTS_CLIENT_SECRET_2 [ / SOUNDCHARTS_TEAM_ID_2 ]
 *   …up to _10
 */

import { getSoundchartsConfig, SoundchartsConfig } from "./config";
import { SoundchartsError } from "./errors";
import {
  CredentialPool, PoolStatus, PoolUnavailableError, loadCredentialsFromEnv, SlotHandle,
} from "../credentialPool";

const SAFETY_MS = 60 * 1000; // refresh 60s before expiry

let pool: CredentialPool | null = null;

function buildPool(): CredentialPool {
  return new CredentialPool(
    "soundcharts",
    loadCredentialsFromEnv("SOUNDCHARTS_CLIENT_ID", "SOUNDCHARTS_CLIENT_SECRET", {
      // Team id is per slot, falling back to the shared value when omitted.
      extraVars: { teamId: "SOUNDCHARTS_TEAM_ID" },
      // Legacy header auth is a SEPARATE credential pair on the same account.
      // Both the project's existing name (…_API_KEY) and the newer …_TOKEN name
      // are accepted so either spelling works.
      legacyVars: {
        idVars: ["SOUNDCHARTS_LEGACY_APP_ID"],
        secretVars: ["SOUNDCHARTS_LEGACY_API_KEY", "SOUNDCHARTS_LEGACY_TOKEN"],
      },
    })
  );
}

/**
 * The legacy (App ID + token) credential for a slot, when one is configured.
 *
 * Nothing in the current integration uses legacy auth — every Soundcharts
 * endpoint we call speaks OAuth — so these are loaded and validated but never
 * mixed into a modern request. This accessor exists so a future legacy-only
 * endpoint can pick the right pair explicitly rather than by guesswork.
 */
export function soundchartsLegacyCredential(slotLabel: string): { id: string; secret: string } | null {
  return getSoundchartsPool().legacyCredentialFor(slotLabel);
}

/** Every slot that has a usable legacy pair (label + masked-safe values). */
export function soundchartsLegacyCredentials(): { label: string; id: string; secret: string }[] {
  return getSoundchartsPool().legacyCredentials();
}

export function getSoundchartsPool(): CredentialPool {
  if (!pool) pool = buildPool();
  return pool;
}

/** Re-read the environment (after a config change and in tests). */
export function reloadSoundchartsPool(): void {
  pool = buildPool();
}

export function soundchartsPoolStatus(): PoolStatus {
  return getSoundchartsPool().status();
}

/** Force a token refresh on the next call (used after a legitimate 401). */
export function invalidateSoundchartsToken(): void {
  // Dropping every slot's token is cheap and unambiguous; each is re-fetched
  // on demand.
  getSoundchartsPool().reset();
}

async function requestToken(cfg: SoundchartsConfig, handle: SlotHandle): Promise<{ token: string; ttlMs: number }> {
  const { id, secret, extra } = handle.credential;
  const basic = Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  const params = new URLSearchParams({ grant_type: "client_credentials" });
  const teamId = extra?.teamId ?? cfg.teamId;
  if (teamId) params.set("team_id", teamId);

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`, // never logged
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      // Next.js patches fetch with a persistent data cache; without no-store it
      // can replay a days-old token response from .next/cache/fetch-cache.
      cache: "no-store",
    });
  } catch (err) {
    throw new SoundchartsError("SOUNDCHARTS_AUTH_FAILED", `Could not reach the Soundcharts token endpoint: ${(err as Error).message}`, { retryable: true });
  }

  if (res.status === 429) {
    handle.rateLimited(Number(res.headers.get("retry-after")));
    throw new SoundchartsError("SOUNDCHARTS_RATE_LIMITED", "Soundcharts rate-limited the token request.", { httpStatus: 429, retryable: true });
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    handle.rejected("bad_credentials");
    throw new SoundchartsError("SOUNDCHARTS_AUTH_FAILED", `Soundcharts rejected the credentials in slot ${handle.label} (HTTP ${res.status}).`, { httpStatus: res.status, retryable: false });
  }
  if (!res.ok) {
    throw new SoundchartsError("SOUNDCHARTS_AUTH_FAILED", `Soundcharts token request failed (HTTP ${res.status}).`, { httpStatus: res.status, retryable: res.status >= 500 });
  }

  const json = (await res.json().catch(() => ({}))) as { access_token?: string; token?: string; expires_in?: number };
  const token = json.access_token ?? json.token;
  if (!token) throw new SoundchartsError("SOUNDCHARTS_AUTH_FAILED", "Soundcharts token response did not contain an access token.");
  return { token, ttlMs: (json.expires_in ?? 3600) * 1000 - SAFETY_MS };
}

/**
 * Get a valid Soundcharts bearer token from a healthy account.
 * @throws {SoundchartsError} SOUNDCHARTS_NOT_CONFIGURED / SOUNDCHARTS_AUTH_FAILED / SOUNDCHARTS_RATE_LIMITED
 */
export async function getSoundchartsAccessToken(): Promise<string> {
  const cfg = getSoundchartsConfig();
  const p = getSoundchartsPool();
  if (!p.configured) {
    throw new SoundchartsError("SOUNDCHARTS_NOT_CONFIGURED", "Soundcharts client credentials are not configured.");
  }
  try {
    return await p.run((handle) => handle.withToken(() => requestToken(cfg, handle)));
  } catch (err) {
    if (err instanceof PoolUnavailableError) {
      throw new SoundchartsError(
        err.reason === "not_configured" ? "SOUNDCHARTS_NOT_CONFIGURED" : "SOUNDCHARTS_RATE_LIMITED",
        err.message,
        { httpStatus: err.httpStatus, retryable: err.reason === "all_cooling" }
      );
    }
    throw err;
  }
}

/**
 * Tell the pool that a Soundcharts DATA request (not the token request) was
 * throttled, so the account is parked and the next call uses another one.
 */
export function noteSoundchartsRateLimit(retryAfterSeconds: number | null): void {
  const p = getSoundchartsPool();
  const status = p.status();
  const active = status.slots.find((s) => s.state === "available");
  if (!active) return;
  // Park by running a no-op through the pool so the handle belongs to the slot
  // that just served the throttled request.
  void p.run(async (handle) => {
    if (handle.label === active.label) handle.rateLimited(retryAfterSeconds);
    return null;
  }).catch(() => { /* parking is best-effort */ });
}
