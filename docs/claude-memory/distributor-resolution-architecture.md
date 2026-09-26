---
name: distributor-resolution-architecture
description: "How Ocean Distro Finder resolves a distributor and why the live browser test can't run headless"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1abc5728-7731-460b-a3af-840bea10c0c1
---

Distributor resolution in Ocean Distro Finder is **licensor-UUID-only**. The ONLY authoritative source is `json/uuid's.json` (137 canonical `{uuid,name}` records), matched exactly via `resolveDistributorByUuid` in `src/distributor/uuid.ts`. `src/distributor/resolver.ts::resolveDistributorByLicensorUuid` takes a licensor UUID and returns `{name,uuid,status}` with DISTINCT statuses: `verified` | `uuid_not_mapped` | `uuid_unavailable` | `invalid_uuid` | `conflict` (never collapse to a generic "unresolved"). Soundcharts is analytics-only and must NEVER supply a distributor. Never guess from label/ISRC/UPC/Soundcharts.

**Primary (synchronous) source of the licensor UUID = the Spotify system's local track catalog** `json/tracks.json` (Spotify track id | ISRC → licensor UUID), loaded by `src/trackMapping.ts::loadTrackCatalog`/`findUuidForTrack`. `src/lookup/service.ts::resolveTrack` (the panel's `/api/lookup`) looks up the selected track's own licensor UUID from this catalog, then resolves the distributor. This is what makes the distributor appear WITHOUT any browser connector. The original bug: `resolveTrack` never consulted the catalog, so it always showed "Connector required". Add authorized tracks to `json/tracks.json`.

**Spicetify path (cleanest licensor-UUID source):** `spicetify/distro-finder.js` is a Spotify **desktop** extension. Running inside the authenticated client, `Spicetify.CosmosAsync.get("https://spclient.wg.spotify.com/metadata/4/track/{gid}")` returns `licensor.uuid` directly — no tab-opening, no pairing, no tokens. It converts the base62 track id → GID via BigInt base62 decode (alphabet `0-9a-zA-Z`; PROVEN: `5MH8rf9BdkrFlBEeaYkFZ3` → `be172e79403e48edb9742d98baf252cd`), then POSTs the licensor UUID to `POST /api/distributor` (`app/api/distributor/route.ts`, CORS-open, calls `resolveDistributorByLicensorUuid` → `{distributor,licensorUuid,status}`). Install: copy to Spicetify Extensions dir, `spicetify config extensions distro-finder.js && spicetify apply`. Set `BACKEND` const (default `http://localhost:3001`). This is distributor-only (no Soundcharts).

The MV3 browser connector (`extension/spotify-distributor-connector`) is the fallback for tracks not in the catalog: it captures a licensor UUID from `spclient.wg.spotify.com/metadata/4/track/{gid}`. The panel DRIVES it automatically — when `/api/lookup` returns a non-verified distributor, `app/page.tsx` (`ReleaseWorkspace.runConnectorFor`) calls `runConnectorLookup` (in `app/lib/connector.ts`), and "Retry distributor lookup" re-runs it. Backend flow: `/api/lookup/start` → extension opens inactive tab → `/api/connector/spotify-event` (validateSanitizedPayload → completeLookupForTrack → resolveUuid) → poll `/api/lookup/{requestId}`.

**Connector port gotcha:** the panel dev server runs on **port 3001**; the extension manifest `externally_connectable`/`host_permissions`/`content_scripts` and `service-worker.js` DEFAULTS.panelOrigin must include `http://localhost:3001` + `http://127.0.0.1:3001` (both 3000 and 3001 are listed). If the manifest only allows 3000, the panel↔extension messaging silently fails and the UI shows "Distributor unresolved". `validateOrigin` in the service worker accepts any localhost/127.0.0.1 port.

**Build gotcha:** on Windows, a stale `.next` causes `Cannot find module './N.js'` in API routes, which breaks the connectorStore singleton sharing between `/api/lookup/start` and `/api/connector/spotify-event` (capture returns `matched:false`). Fix: `rm -rf .next node_modules/.cache && npx next build`.

Fixture (verified live via `/api/lookup`): track `5MH8rf9BdkrFlBEeaYkFZ3` / ISRC `FRX282689836` → licensor `c71b29ea9e1e48c6931da2dd7c0bf5d5` → **Believe Digital** (status verified). This entry lives in `json/tracks.json`.

**Logo:** `app/components/BrandLogo.tsx` is the ONLY importer of the two PNGs. It renders **exactly one `<img>`**, choosing the src by the resolved theme read from `document.documentElement.dataset.theme` (MutationObserver keeps it live) — dark→white-virus-logo, light→black-virus-logo. NO two-image CSS toggle, no CSS filters. Used in exactly ONE spot: the sidebar brand (the empty-state center logo was removed so desktop shows exactly one logo).

**Auto distributor lookup (UI):** `analyzeTrack` in `app/page.tsx` fetches `/api/lookup` (catalog resolve) and, if the distributor is not `verified`, automatically calls `runConnectorFor(id)` — no second button. The `DistributorVerificationCard` shows ONE state at a time: Resolving (spinner) → Verified / UUID not mapped / a single failure. **Retry appears only on a terminal failure** (`login_required`/`timed_out`/`failed`); `no_connector` shows a focused "Set up connector" action (threaded `onOpenSettings` → Settings view). Never repeats the "UUID unavailable" message.

**Design system:** `app/globals.css` token palette is Shopify-admin-inspired — light accent `#008060`, dark accent `#20C997`, calm gray surfaces, `--focus-ring`, `--on-accent`, `--skeleton-hi` (theme-safe skeletons). Header shows the current page title (VIEW_TITLE) — the duplicate `.quick-search` bar was removed; the single lookup input lives in the content.
