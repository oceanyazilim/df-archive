/**
 * Spotify account link (OAuth 2.0 Authorization Code + PKCE).
 *
 * Lets the user connect THEIR OWN Spotify account to the app with explicit
 * consent on Spotify's official authorization page. No password ever touches
 * this app; Spotify redirects back to the local server with a one-time code.
 *
 * PKCE means no client secret is required, so installed copies of the desktop
 * app can authorize with only the public client id — exactly what a
 * distributable build needs. When an account is connected, its token is also
 * offered to the Web API layer as the preferred credential (each user runs on
 * their own authorization instead of shared app keys).
 *
 * SECURITY: the refresh/access tokens are persisted only to a local file
 * (0600) and are never returned by any API route, logged, or sent anywhere
 * except accounts.spotify.com / api.spotify.com.
 */

import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SPOTIFY } from "./config";
import { logger } from "./logger";

const ACCOUNT_PATH =
  process.env.DISTRO_SPOTIFY_ACCOUNT_PATH ?? path.join(process.cwd(), ".data", "spotify-account.json");

const AUTHORIZE_URL = process.env.SPOTIFY_AUTHORIZE_URL ?? "https://accounts.spotify.com/authorize";
const PENDING_TTL_MS = 10 * 60 * 1000;
// Refresh a little early so a request never leaves with a token about to die.
const TOKEN_SKEW_MS = 60 * 1000;

/** Public client id used for the user-consent flow (PKCE, no secret needed). */
export function oauthClientId(): string {
  return process.env.SPOTIFY_OAUTH_CLIENT_ID || SPOTIFY.clientId;
}

/**
 * Scopes are deliberately minimal: an empty scope still grants the basic
 * profile (display name) and normal Web API catalog access — the user is not
 * asked for anything the app does not use. Override with SPOTIFY_OAUTH_SCOPES.
 */
function oauthScopes(): string {
  return process.env.SPOTIFY_OAUTH_SCOPES ?? "";
}

function redirectUri(origin: string): string {
  // Spotify requires an exact, pre-registered redirect URI. Loopback HTTP is
  // allowed; we bind to whatever origin the panel was reached on (127.0.0.1).
  return process.env.SPOTIFY_OAUTH_REDIRECT_URI || `${origin}/api/spotify-auth/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// ---------------- Pending authorizations (state → verifier) ----------------
type PendingAuth = { verifier: string; redirectUri: string; createdAt: number };
const pending = new Map<string, PendingAuth>();

function sweepPending(): void {
  const t = Date.now();
  for (const [k, v] of pending) if (t - v.createdAt > PENDING_TTL_MS) pending.delete(k);
}

// ---------------- Persisted account ----------------
type StoredAccount = {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: number;
  scope: string;
  connectedAt: number;
  profile: { id: string; displayName: string | null; avatarUrl: string | null };
};

let account: StoredAccount | null = null;
let loaded = false;
// Set when a refresh is rejected — the UI shows "reconnect", requests fall
// back to the app-key pool, and a successful reconnect clears it.
let needsReauth = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(ACCOUNT_PATH, "utf8"));
    if (j && typeof j.refreshToken === "string" && j.profile && typeof j.profile.id === "string") {
      account = {
        refreshToken: j.refreshToken,
        accessToken: typeof j.accessToken === "string" ? j.accessToken : "",
        accessExpiresAt: typeof j.accessExpiresAt === "number" ? j.accessExpiresAt : 0,
        scope: typeof j.scope === "string" ? j.scope : "",
        connectedAt: typeof j.connectedAt === "number" ? j.connectedAt : Date.now(),
        profile: {
          id: j.profile.id,
          displayName: typeof j.profile.displayName === "string" ? j.profile.displayName : null,
          avatarUrl: typeof j.profile.avatarUrl === "string" ? j.profile.avatarUrl : null,
        },
      };
    }
  } catch { /* no account linked yet */ }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(ACCOUNT_PATH), { recursive: true });
    if (!account) {
      fs.rmSync(ACCOUNT_PATH, { force: true });
      return;
    }
    fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(account, null, 2), { mode: 0o600 });
  } catch (err) {
    logger.warn({ event: "spotify_account_persist_failed", matchStatus: (err as Error).message });
  }
}

// ---------------- Flow ----------------
/** Step 1: build the consent URL the user's browser is sent to. */
export function beginAuth(origin: string): { ok: true; url: string } | { ok: false; code: string; message: string } {
  sweepPending();
  const clientId = oauthClientId();
  if (!clientId) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "No Spotify client id is configured (SPOTIFY_OAUTH_CLIENT_ID or SPOTIFY_CLIENT_ID).",
    };
  }
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const uri = redirectUri(origin);
  pending.set(state, { verifier, redirectUri: uri, createdAt: Date.now() });

  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: uri,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const scope = oauthScopes();
  if (scope) q.set("scope", scope);
  return { ok: true, url: `${AUTHORIZE_URL}?${q.toString()}` };
}

/** Step 2: the callback exchanges the one-time code and stores the account. */
export async function completeAuth(
  code: unknown,
  state: unknown
): Promise<{ ok: true; displayName: string | null } | { ok: false; code: string; message: string }> {
  sweepPending();
  if (typeof code !== "string" || !code || typeof state !== "string") {
    return { ok: false, code: "INVALID_CALLBACK", message: "Missing authorization code or state." };
  }
  const p = pending.get(state);
  if (!p) return { ok: false, code: "STATE_MISMATCH", message: "This authorization link expired or was already used. Start again from the app." };
  pending.delete(state); // single-use

  const res = await fetch(SPOTIFY.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirectUri,
      client_id: oauthClientId(),
      code_verifier: p.verifier,
    }).toString(),
    cache: "no-store",
  }).catch((err) => { throw new Error(`Spotify token transport error: ${(err as Error).message}`); });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
    const why = typeof json.error_description === "string" ? json.error_description : `HTTP ${res.status}`;
    logger.warn({ event: "spotify_account_exchange_failed", matchStatus: why });
    return { ok: false, code: "EXCHANGE_FAILED", message: `Spotify did not accept the authorization (${why}).` };
  }

  // Who connected? Only safe display fields are kept.
  let profile: StoredAccount["profile"] = { id: "", displayName: null, avatarUrl: null };
  try {
    const me = await fetch(`${SPOTIFY.apiBase}/me`, {
      headers: { Authorization: `Bearer ${json.access_token}` },
      cache: "no-store",
    });
    const mj = (await me.json().catch(() => ({}))) as Record<string, unknown>;
    if (me.ok && typeof mj.id === "string") {
      const images = Array.isArray(mj.images) ? (mj.images as { url?: string }[]) : [];
      profile = {
        id: mj.id,
        displayName: typeof mj.display_name === "string" ? mj.display_name : null,
        avatarUrl: images[0]?.url ?? null,
      };
    }
  } catch { /* profile is cosmetic — the link still works without it */ }

  ensureLoaded();
  account = {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    accessExpiresAt: Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000,
    scope: typeof json.scope === "string" ? json.scope : "",
    connectedAt: Date.now(),
    profile,
  };
  needsReauth = false;
  persist();
  logger.info({ event: "spotify_account_connected", matchStatus: profile.id || "unknown" });
  return { ok: true, displayName: profile.displayName };
}

/** Sanitized status for the UI — never includes tokens. */
export function accountStatus(): {
  connected: boolean;
  needsReauth: boolean;
  profile: { id: string; displayName: string | null; avatarUrl: string | null } | null;
  scope: string | null;
  connectedAt: string | null;
} {
  ensureLoaded();
  return {
    connected: !!account,
    needsReauth,
    profile: account ? account.profile : null,
    scope: account ? account.scope : null,
    connectedAt: account ? new Date(account.connectedAt).toISOString() : null,
  };
}

export function disconnectAccount(): boolean {
  ensureLoaded();
  const had = !!account;
  account = null;
  needsReauth = false;
  persist();
  if (had) logger.info({ event: "spotify_account_disconnected" });
  return had;
}

/**
 * A currently-valid access token for the linked account, refreshing if needed.
 * Returns null when no account is linked or the refresh was rejected (the
 * caller falls back to the app-key pool).
 */
let refreshPromise: Promise<string | null> | null = null;
export async function getUserAccessToken(): Promise<string | null> {
  ensureLoaded();
  if (!account || needsReauth) return null;
  if (account.accessToken && Date.now() < account.accessExpiresAt - TOKEN_SKEW_MS) return account.accessToken;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(SPOTIFY.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: account!.refreshToken,
          client_id: oauthClientId(),
        }).toString(),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || typeof json.access_token !== "string") {
        // invalid_grant = the user revoked access on spotify.com — honor it.
        needsReauth = true;
        logger.warn({ event: "spotify_account_refresh_rejected", matchStatus: `HTTP ${res.status}` });
        return null;
      }
      account!.accessToken = json.access_token;
      account!.accessExpiresAt = Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;
      // Spotify may rotate the refresh token — keep the newest one.
      if (typeof json.refresh_token === "string" && json.refresh_token) account!.refreshToken = json.refresh_token;
      persist();
      return account!.accessToken;
    } catch {
      return null; // transient network problem — do not flag reauth
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ---------------- Web API via the linked account ----------------
// Used by the request layer as a fallback when no app key is usable — an
// installed copy with zero configured keys still works once the user connects
// their account. A 429 parks the account token like any pool slot.
let userCooldownUntil = 0;

export async function userSpotifyRequest(
  url: string,
  signal?: AbortSignal
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers } | null> {
  if (Date.now() < userCooldownUntil) return null;
  let token = await getUserAccessToken();
  if (!token) return null;

  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal, cache: "no-store" });
  if (res.status === 401) {
    // Stale token despite the skew (clock drift, revocation race) — refresh once.
    ensureLoaded();
    if (account) { account.accessExpiresAt = 0; }
    token = await getUserAccessToken();
    if (!token) return null;
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal, cache: "no-store" });
    if (res.status === 401) { needsReauth = true; return null; }
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    userCooldownUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000);
    logger.warn({ event: "spotify_account_rate_limited", matchStatus: `retryAfter=${retryAfter || "?"}` });
    return null;
  }

  let body: Record<string, unknown> = {};
  const text = await res.text();
  if (text) { try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; } }
  return { status: res.status, body, headers: res.headers };
}

/** For tests. */
export function __resetSpotifyAccount(): void {
  userCooldownUntil = 0;
  account = null;
  loaded = true;
  needsReauth = false;
  pending.clear();
  refreshPromise = null;
}
