---
name: ocean-analyzer
description: "The in-Spotify right-click analyzer — extension files, backend endpoint, shadow-DOM modal, and how to test it now that Chrome 150 removed --load-extension"
metadata: 
  node_type: memory
  type: project
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-07-31T17:12:05.585Z
---

Added 2026-07-31. "Analyze with Ocean Analyzer" (TR: "Ocean Analyzer ile Analiz
Et") on right-click, in **two places**:

**A. Spotify desktop app** (what the user actually wanted) — `spicetify/
distro-finder.js` v8. Two ContextMenu items: the Analyzer (track/album/artist/
playlist) and the old distributor-only panel. Track identity + ISRC +
distributor resolve **locally** (protobuf + embedded mapping) so they render
instantly with the desktop app closed; everything else (analytics, album,
artist, playlist) comes through a **CDP request/response pump**: the renderer
parks `window.__oceanAnalyzer.req`, `desktop/main.js` polls it every 800ms via
`bridge.readAnalyzerRequest()`, calls `/api/analyzer/...`, writes back through
`writeAnalyzerResponse()` (payload crosses as a JSON literal — no injection).
Offline → honest `DESKTOP_APP_OFFLINE` message, not a spinner.

**B. Spotify Web Player** (browser extension) — same feature set in a shadow
root; see the extension section below.

**Backend:** `src/analyzer/service.ts` (+ `app/api/analyzer/[kind]/[id]/route.ts`)
serves track/album/artist/playlist in one call. `AnalyzerError` carries a safe
user-facing message; `spotifyCall()` translates upstream failures, because
`executeWithRetry` **throws** on non-2xx (an `assertSpotifyOk`-only approach
silently never runs). Track analysis takes `licensorUuid` as a query param —
the public API never exposes it.

**Extension** (`extension/spotify-distributor-connector/src/analyzer/`):
`targetResolver.js` (identifier-only: data-uri → href incl. `/intl-xx/` →
row links → page URL; never text), `contextMenu.js` (injects one row into
Spotify's own menu, styled from a native item's computed style; standalone
fallback; idempotent via marker attr), `modal.js` (single shadow-root instance,
tabs per kind, album/playlist → track drill-down with breadcrumb),
`chart.js` (SVG, gaps stay gaps — never zeros), `bridge.js` (rebuilds
`{kind,id}` from validated primitives; page can't drive the extension).
Service worker gained `OCEAN_ANALYZER_FETCH`/`_OPEN_DASHBOARD` and remembers
licensor UUIDs per track in session storage. Panel accepts `?input=<spotify url>`
for the modal's "Open Full Dashboard".

**Testing gotcha:** Chrome 137+ dropped `--load-extension` and Chrome 150 ignores
the `DisableLoadExtensionCommandLineSwitch` workaround too — puppeteer cannot
load the unpacked extension. Instead inject the analyzer scripts into a real
open.spotify.com page with a `chrome.runtime` shim, and do the backend fetch via
`page.exposeFunction` (a page-side fetch hits CORS; the real SW has
host_permissions). That setup verified: menu row injected exactly once, target
resolved from `/intl-tr/track/…`, modal rendered real Soundcharts numbers,
album→track drill-down, Escape cleanup. Users install via chrome://extensions →
Developer mode → Load unpacked (still works).

Data honesty is enforced by selftest greps — see [[spotify-api-restrictions]]
for what Spotify no longer returns.
