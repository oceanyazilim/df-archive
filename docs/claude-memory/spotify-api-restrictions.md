---
name: spotify-api-restrictions
description: "Measured 2026-07 limits of the public Spotify Web API for client-credentials tokens — popularity/followers/genres/markets gone, top-tracks 403, artist albums limit max 10, playlist paging 403, editorial playlists 404"
metadata: 
  node_type: memory
  type: reference
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-07-31T22:13:32.881Z
---

Measured directly against api.spotify.com on 2026-07-31 with our
client-credentials token (not guesses — reproduce with a token + curl):

**Fields no longer returned at all:**
- track: `popularity`, `available_markets`
- artist: `followers`, `popularity`, `genres`
  (artist responses now carry only external_urls, href, id, images, name, type, uri)

**Endpoints refused or capped:**
- `/artists/{id}/top-tracks` → **403 Forbidden**
- `/artists/{id}/albums?limit=20` → **400 "Invalid limit"**; max working limit is
  **10** (docs still say 50)
- `/playlists/{id}/tracks` → **403** (so only the page embedded in
  `/playlists/{id}` is readable; long playlists must be shown as partial)
- Spotify-owned editorial/algorithmic playlists (e.g. 37i9dQZF1DX…) → **404**
- `/artists/{id}` rejects a `market` param with 400 — add `market` only where the
  endpoint accepts it (`/tracks`, `/albums`, `/artists/{id}/albums`) and it is
  **mandatory** on `/artists/{id}/top-tracks`.

Still fine: `/tracks/{id}`, `/albums/{id}` (incl. tracks + UPC + copyrights),
`/artists/{id}` basics, `/artists/{id}/albums` (limit ≤10), user-owned playlists.

**Rate limiting is brutal and app-wide.** On 2026-08-01 a few repeated
artist-catalogue builds (each ~55 album-detail calls) got the whole
client-credentials app 429'd with `Retry-After: 46728` — **13 hours**, taking
down every Spotify-backed feature at once. Guard added in
`src/spotifyRateGuard.ts`: a 90 req/min token bucket in front of all four
Spotify call sites, plus a recorded cooldown so later calls fail fast with a
real ETA instead of burning quota. `acquireSpotifySlot()` must be called
**outside** `executeWithRetry` — that wrapper converts any thrown error into an
`InternalApiError` and would hide the cooldown. Health exposes
`spotifyCooldown`, and the panel shows a banner. Distributor lookups are
unaffected (they read the user's own client, not the Web API).

Consequence for the UI: these are surfaced as "no longer exposed by Spotify"
rather than hidden or faked — see the analyzer in [[ocean-analyzer]] and the
panel's popularity handling in [[ui-architecture]]. Never reintroduce a
"popularity" metric assuming the API provides it.
