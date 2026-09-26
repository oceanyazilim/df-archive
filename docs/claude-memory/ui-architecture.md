---
name: ui-architecture
description: "Post-redesign frontend layout — component map, catalog views fed by history, honest-data rules, extension tab-muting fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41f05495-b7d6-4864-9563-fee94c54a47a
  modified: 2026-07-31T15:25:41.073Z
---

**2026-07-31 reference-layout redesign:** `ReleaseWorkspace` is now
`[ReleaseSidebar (artwork+tracklist, sticky) | center | rail]` via
`.ws-layout`/`.ws-center-wrap` grids. Center = three cards (`OverviewCard`,
`ReleaseMetadataCard` — has the distributor row, `PerformanceDetailsCard`) →
`StreamSummary` → `StreamingPerformanceChart` → `DataSections`.
Chart v2: metric selector = real Soundcharts platform series
(spotify/youtube/tiktok/soundcloud/shazam/deezer), views Daily/Total/Avg7,
bar/line/area, D/W/M granularity, previous-period compare (fetch days*2 ≤365,
split by date client-side, dashed prev line), CSV/PNG export
(`slug_metric-view_from_to`), honest empty/error/retry states — no fake data.
Companion v6: `fetchTrackMetadata` tries `wg://metadata/4/track/{gid}` then
https spclient, safe-parse + shape-check (fixes "Unexpected token is not valid
JSON"); distributor failure → status `backend_unavailable`, panel still renders.
Selftest greps these component names — update it when renaming.

Enterprise redesign (2026-07-29). `app/page.tsx` is now a thin shell; the UI lives in components:

- `app/lib/types.ts` — shared Workspace/AlbumRelease/HistoryItem types + helpers (single source for client types).
- `app/components/`: `Sidebar` (MAIN/DATA/ANALYTICS/SYSTEM sections), `Topbar` (global analyzer input — the primary lookup entry point — plus status pill, compact ThemeToggle, profile menu), `LookupWorkspace` (release workspace + connector orchestration, moved intact from old page.tsx), `StreamingPerformanceChart` (custom SVG, no chart lib), `StreamSummary`, `PlatformComparison`, `BackgroundFX`/`GradientCustomizer` (localStorage `odf-bg`, subtle animated blobs), `ui.tsx` primitives.
- `app/components/views/`: HistoryView, catalog.tsx (Distributors/Artists/Albums/Tracks — aggregated client-side from `/api/history`, which now stores artworkUrl/albumTitle/spotifyTrackId/spotifyAlbumId/label/releaseDate), AnalyticsView (pick any analyzed track), ReportsView (honest CSV/JSON exports only), system.tsx (UUID Directory, Status, Settings).

2026-07-29 (2nd pass, user-directed): SINGLE pure-black theme only (#000 bg, white text, translucent panels; ThemeToggle deleted, `data-theme` always dark — BrandLogo therefore always white logo). Workspace layout rows: (1) artwork card · Track Actions (download artwork via `/api/artwork` allowlisted proxy, disabled "download track audio" — audio downloads intentionally NOT offered, Open in Spotify) · Identifiers (ISRC/UPC/Distributor+status) · Track Details (release date, duration, explicit, popularity, licensor UUID); (2) chart + right rail (Other URLs store links, Export); (3) tabs Playlists/Charts/Radio/Platforms/Metadata fed by REAL Soundcharts data — endpoints: playlists `/api/v2.20/song/{uuid}/playlist/current/spotify`, charts `/api/v2/song/{uuid}/charts/ranks/{platform}`, radio `/api/v2/song/{uuid}/broadcast-groups` (all available on this plan, trimmed server-side in the analytics route); (4) slim tracklist (`.trow`). Typography reduced (base 12.5px).

Data-honesty rules preserved: distributor = licensor-UUID exact match only; no fabricated KPIs; catalog pages grow from real analyses; platform comparison shows only platforms with real Soundcharts audience data (spotify/tiktok/soundcloud commonly; units differ per platform).

Known platform facts: this Spotify app's API responses do NOT include `popularity` (reduced field set for new Spotify apps) — UI hides the cell when null. Soundcharts `duration` is SECONDS (normalized ×1000 in lookup service).

Extension: temp lookup tabs are created muted and a tab the user focused is never auto-closed (playback-conflict fix). Source restored from zip after the folder was found emptied on 2026-07-29; zip backup is kept in sync — user must reload the unpacked extension in chrome://extensions after changes.

Related: [[distributor-resolution-architecture]], [[soundcharts-integration-gotchas]]
