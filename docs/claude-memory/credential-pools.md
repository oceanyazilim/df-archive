---
name: credential-pools
description: "Multi-key failover for Spotify and Soundcharts — numbered env slots, per-slot token cache, 429 parking and 401 disabling; where the pool is wired in"
metadata: 
  node_type: memory
  type: project
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-07-31T22:35:57.558Z
---

Added 2026-08-01 after a Spotify app got 429'd for 13 hours and took every
Web-API feature down (see [[spotify-api-restrictions]]).

`src/credentialPool.ts` is provider-agnostic: `readCredentialsFromEnv(idVar,
secretVar, extraVars)` loads **slot 1 = unsuffixed pair**, then `_2`.._10
(half-filled slots skipped). `pool.run(fn)` hands out a `SlotHandle`; the
callback must report outcomes with `handle.rateLimited(retryAfterSec)` (parks
that slot, fails over immediately) or `handle.rejected()` (disables it for the
process). Tokens are cached **per slot** with single-flight — never shared.
When every slot is parked, `PoolUnavailableError` carries the real remaining
wait.

Wiring:
- **Spotify** — `src/spotifyAuth.ts` owns the pool and `spotifyRequest(url,
  signal)`. All four call sites in `src/spotify.ts` go through it (track,
  album, album-tracks page, generic resource). The old module-level
  `cachedToken` is gone; `clearSpotifyTokenCache()` now reloads the pool.
  Global pacing (`acquireSpotifySlot`, 90/min) still applies inside the helper.
- **Soundcharts** — `src/soundcharts/auth.ts` rebuilt around the same pool;
  `noteSoundchartsRateLimit()` is called from `client.ts` on a data-request 429
  so the account is parked, not just retried. `SOUNDCHARTS_TEAM_ID_n` is an
  optional per-slot override.
- **Health** exposes `credentialPools` (counts + `abcd…` fingerprints only) and
  Settings → **API Credentials** renders per-slot badges with countdowns.

Env template lives in `.env.example` under "BACKUP CREDENTIALS". Never put real
keys in chat or in the repo — `.env.local` only.

**Measured 2026-08-01 — Spotify rate limits are IP-based, not app-based.**
Three separate Developer-Dashboard apps (slots 1-3) each obtained a valid token
yet every one answered 429 on `/v1/tracks` with the *same* ~10h Retry-After.
So a Spotify key pool does NOT buy quota headroom from one machine; it only
helps with per-app problems (revoked/rotated keys, per-app daily caps). To beat
an IP lockout you need a different egress IP or to wait it out. Soundcharts is
the opposite: all 5 accounts served live requests independently, so its pool is
genuinely additive.

**Cooldown ownership:** `spotifyRateGuard` is now pacing-only (90/min token
bucket). Its `spotifyCooldownInfo()` is DERIVED from pool state — active only
when every key is parked. The old process-wide cooldown had to go: it blocked
healthy keys the moment one key was throttled, defeating the pool entirely.

Slot state now includes requests, failovers, lastUsedAt, lastErrorCode and
tokenExpiresAt; `loadCredentialsFromEnv` reports half-filled and duplicate
slots as `issues` instead of skipping them silently. A 401/403 on a DATA call
refreshes that slot's token once (`handle.authFailure()`), and only a second
failure disables the slot; a 401/403 on the TOKEN call disables immediately.
Secrets shorter than 12 chars render as `••••` — a 4-char tail would have
leaked most of a short legacy token.

Gotcha: `acquireSpotifySlot()` must stay **outside** `executeWithRetry` (that
wrapper rewraps thrown errors into `InternalApiError` and would hide the
cooldown). Same reason the pool's failover happens in `spotifyRequest`, not
inside the retry callback.
