---
name: artist-catalog
description: "Artist link → full catalogue view; how \"removed from profile\" tracks are derived (Soundcharts history vs Spotify profile) and the two bugs that made bulk resolution stall"
metadata: 
  node_type: memory
  type: project
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-08-06T16:50:03.303Z
---

Added 2026-07-31. Pasting a Spotify **artist** link opens
`ArtistCatalogWorkspace` (`app/components/ArtistCatalog.tsx`) backed by
`src/artist/catalog.ts` + `/api/artist/{id}/catalog`. Input parsing now also
accepts **UPC** (12–14 digits → `search?q=upc:` → album) alongside track/album/
artist/ISRC/Soundcharts-UUID.

**"Removed from profile" is a real diff, not a guess:** Spotify's current
artist albums (paginated, `limit` capped at 10) give what is on the profile
today; `getArtistSongs` (Soundcharts `/api/v2.21/artist/{uuid}/songs`, ~350–2300
entries, paginated) gives the historical catalogue. Anything in the history but
not on the profile is flagged `onProfile: false`. Matching is ISRC-first with a
normalized-title fallback (feat./bracket qualifiers stripped). Rick Astley:
395 tracks, 328 on profile, 67 removed — built in ~6s.

Distributor + ISRC are NOT in the catalogue response: Spotify does not return
`external_ids` on album track objects and `/v1/tracks?ids=` is 403. Both come
from the connector one track at a time (protobuf carries them together), driven
by the "Resolve distributors" button (3 workers, stoppable, progress bar).
Removed rows have no Spotify id, so they cannot be resolved — but they open via
their Soundcharts uuid and often still resolve a Spotify id server-side.

**Two bugs that made bulk resolution stall (both fixed, keep in mind):**
1. `isDuplicateEvent` ran *before* `completeLookupForTrack`, so the second
   request for the same track within the 5-minute dedup TTL never completed —
   it looked like a hang. Order is now complete-first, dedup only when nothing
   was pending. Applies to both `/api/connector/spotify-event` and
   `/spotify-metadata`.
2. `Spicetify.Platform.Session.accessToken` is a **stale snapshot** — it expires
   after ~1h and is never refreshed in place, after which spclient answers
   **401**. Use `Platform.AuthorizationAPI._tokenProvider.loadToken({preferCached:false})`
   (returns a fresh token, ~45 min) and fall back to `Session` only if absent.
   Fixed in both `desktop/spotify-bridge.js` and the Spicetify companion.
   Captures are also serialized in `desktop/main.js` (one at a time + 150ms
   pacing) because parallel bursts trigger 401s.

**2026-08-06 admin gate + removed recovery.** Artist analysis is ADMIN-ONLY
end to end (user request): `/api/artist/{id}/catalog` + new
`/api/artist/recover-track` check the admin cookie (pattern from
/api/history); page.tsx blocks the artist branch pre-flight via an
isAdminRef and opens AdminLoginDialog. Fully-off-profile releases now get
releaseType `"removed"` (danger badge). Removed-track recovery
(`src/artist/recover.ts`): Soundcharts metadata/identifiers/albums →
ISRC/UPC/label/original spotify id; fallback Spotify `search?q=isrc:` (new
`findTrackByIsrc`) + one album read for UPC. Gotchas: (1) Soundcharts calls
MUST be sequential — 3 parallel reads trip the per-account rate limit and
park 3 pool slots; (2) song-metadata endpoint rate-limits often, so the
catalogue-history ISRC is passed as `&isrc=` fallback — that chain alone
recovered full ISRC+UPC+id in testing; (3) useArtistCatalog's resolve queue
now includes removed rows (recover → connector lookup when an id returns;
states `recovered_no_spotify` / `unrecoverable`), and resolved entries are
keyed by catalogue row key (Soundcharts uuid for removed rows) — TrackList
looks up `spotifyTrackId ?? key`.

**2026-08-06 playlist catalogue (admin-only).** Playlist URL → same release
table via the shared contract (`PlaylistCatalogData` = ArtistCatalogData
minus artist fields; PlaylistWorkspace wraps ReleaseCatalog). CRITICAL
measurements: client-credentials playlist responses now have NO `tracks`
field at all (July's embedded-first-page is gone), `/playlists/{id}/tracks`
still 403, Soundcharts tracklisting endpoints 404 on this plan ("Song is
not currently available" = wrong-route/plan message). Track sources in
`src/playlist/catalog.ts`: (1) OAuth user token full paging; (2) CDP bridge
`fetchPlaylistTracks` — panel queues via connectorStore playlist queue,
shell takes it from `/api/connector/pending` (new `playlistFetch` field),
posts to `/api/connector/playlist-tracks`. Inside the renderer the Web API
can 429 BY IP with growing Retry-After (5s→45s observed) → falls back to
`Spicetify.Platform.PlaylistAPI.getContents` (works: 90/90 tracks; gives
isPlayable but NO ISRC — identifiers fill during resolve, coverage note
says so). Removed = entry gone / is_playable false / restriction. Removed
rows recover via recover-track with `spotifyTrackId` param (new entry
point: SC by-platform → uuid → chain, plus direct getSpotifyTrack read).

See [[spotify-api-restrictions]] for what the public API withholds and
[[spotify-client-constraints]] for the protobuf/CDP background.
