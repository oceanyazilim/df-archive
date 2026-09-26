---
name: desktop-app
description: Electron desktop app (desktop/) wraps the Next standalone server on 127.0.0.1:3000 (was 3001); CDP bridge with status reporting + panel-triggered reconnect; Windows-autostart flag patching; extract-zip broken on Node 24
metadata: 
  node_type: memory
  type: project
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-08-07T00:43:51.947Z
---

Since 2026-07-31 the panel also ships as a Windows PC app in `desktop/`:
Electron shell (`main.js`) boots the Next.js **standalone** bundle via
`utilityProcess.fork` on fixed port **127.0.0.1:3001** (must match the
Spicetify companion's `BACKEND`; override `DISTRO_DESKTOP_PORT` + re-run
installer). Pipeline: root `npm run desktop:prepare` (next build + copy
standalone/static/public/json/.env* into `desktop/server/` — generated, never
edit), `desktop:start`, `desktop:dist` (NSIS). Companion installer is the single
implementation `desktop/scripts/install-spicetify.mjs` (CLI + app menu both use
it); it patches BACKEND and runs `spicetify config`/`apply`. Data still comes
only from the Spotify desktop client via [[distributor-resolution-architecture]]
(licensor UUID → exact match).

Since 2026-07-31 (later same day) the **browser extension is legacy**: the
Spicetify companion is also the panel connector. It stores the connector key in
`localStorage["odf.connectorKey"]`, polls `/api/connector/pending` (2.5s) +
heartbeat (45s) via CosmosAsync, and answers with a sanitized payload to
`/api/connector/spotify-event`. Pairing: panel Settings → Spotify Connector →
Generate code → Spotify profile menu → "Ocean Distro Finder" modal → enter code.
Backend accepts the key as `Authorization: Connector <key>` OR `X-Connector-Key`
(CosmosAsync may reserve Authorization). `app/lib/connector.ts` no longer uses
chrome.runtime; `runConnectorLookup` = start + poll only. Desktop main.js pins
`DISTRO_CONNECTORS_PATH` to Electron userData so pairings survive
`desktop:prepare` wiping `desktop/server/.data`.

2026-07-31 v5 fixes: CosmosAsync to http://127.0.0.1 is unreliable in current
clients ("Unexpected token", pairing rejects) → companion is **fetch-first**
(loopback is mixed-content-exempt) with CosmosAsync fallback; all connector
routes + /api/distributor now send CORS (`app/api/connector/cors.ts`, allows
Authorization + X-Connector-Key, OPTIONS handlers). Companion modal has
**one-click auto-pair** (calls pair/start itself — pair/start is open by
design). Right-click panel styled Spotify-like: #000 background, #1db954 title
+ row labels, white values, pill badges. Installer .exe builds via
`npm run desktop:dist` → `desktop/dist/Ocean Distro Finder Setup 1.0.0.exe`;
needs `win.signAndEditExecutable: false` (winCodeSign 7z has darwin symlinks →
EPERM without admin/dev-mode).

Gotchas:
- `npm test` (selftest) greps UI/extension sources; it broke silently after the
  enterprise redesign (ThemeToggle removed, cards moved to LookupWorkspace).
  Fixed 2026-07-31 — keep its source-grep assertions in sync when renaming
  components or touching the companion's storage/auth lines.
- `npm install` of Electron on this machine silently leaves `dist/` half-empty:
  extract-zip's promise never settles under Node 24.17 (process exits 0). Fix:
  download lands in `%LOCALAPPDATA%\electron\Cache`; `Expand-Archive` the zip
  into `node_modules/electron/dist` and write `path.txt` containing
  `electron.exe` by hand.
- User's old Spicetify extension `finder.js` (pre-rename) was removed
  2026-07-31 and replaced by `distro-finder.js` pointing at 127.0.0.1:3001.

**Connecting Spotify (2026-08-01).** There is no pairing step any more — the
old profile-menu pairing modal was removed in companion v7. The link is made by
the desktop app: **Spotify → Connect to Spotify**, which relaunches Spotify with
`--remote-debugging-port=9222`. Because users open Spotify from their own
shortcut and lose the flag, the Start Menu shortcut
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Spotify.lnk`) now carries
the flag permanently — verified by launching it and seeing the bridge answer.
A `.ocean-backup` copy sits next to it. Note `spicetify apply` restarts Spotify
WITHOUT the flag, so reconnect after installing the companion.

Companion v9 re-adds a profile-menu entry, but as a **status report**, not
pairing: it states that distributor lookups are offline-ready, then probes the
bridge and distinguishes "not connected" (DESKTOP_APP_OFFLINE) from
"connected · data unavailable" (bridge fine, upstream provider erroring) — the
two were conflated at first and produced a misleading "not connected".

**2026-08-02 bridge-robustness pass** (user: "panel paired değil, analiz
çalışmıyor"). Root cause: Windows-login autostart launches Spotify via
`HKCU\...\Run\Spotify` (`--autostart --minimized`) which bypasses the patched
Start-Menu shortcut → no 9222 → panel lookups + analyzer pump dead while the
in-Spotify finder (local resolution) still works. Fixes:
- `bridge.patchLaunchEntries()` (spotify-bridge.js): idempotently appends the
  CDP flags to the Run key + Start Menu/Desktop .lnk; called at every app
  start and inside `launch()`. `bridge.isSpotifyRunning()` via tasklist.
- main.js persists the connector key in `userData/bridge-key.json` (before:
  a NEW connector per launch — 27 piled up); connectorStore prunes keys
  unseen >45 days and persists `lastSeenAt` (throttled 5 min).
- New endpoints: `POST /api/connector/bridge-status` (desktop reports
  {spotifyRunning, debuggable} every 30s beat) and `/api/connector/
  bridge-command` (panel queues `{action:"reconnect"}` unauth like pair/start;
  desktop claims with `?take=1` + connector auth, executes launch(), reports
  completeId). `/api/connector/status` now returns `bridge:{desktopAlive,
  spotifyRunning, debuggable, reportedAt}`.
- Heartbeat still means "lookups can be answered NOW" (only sent when
  debuggable); `bridge.desktopAlive` is the app-alive signal.
- Panel: ConnectorSettings (system.tsx) shows 3 honest states + in-panel
  "Connect to Spotify" button (polls command result, 90s); LandingStatus
  (page.tsx) shows Online/Link inactive/Spotify closed/Offline/Not paired.
- Companion has NO backend URL anymore — port changes don't touch it.

**Port is now 3000** (was 3001; user wants a domain later, same as hosted
default). `desktop/main.js` DISTRO_DESKTOP_PORT default. `npm run dev` wants
3000 too — run one at a time (next dev auto-bumps to a free port otherwise).

**2026-08-02 self-healing pass** (user: "her seferinde danışmak istemiyorum,
otomasyon olsun"). The port-3000 move immediately caused a dev-vs-desktop
port fight (`npm run dev` took 3000; desktop's own server lost it; user saw
"nothing works"). main.js is now fully self-healing:
- **Adopt mode**: `ensureServer()` health-probes PORT first (shape-check:
  `status==="ok" && "uuidMappingLoaded" in json`); a healthy Ocean panel
  (usually next dev) is adopted instead of forking a second server. Beat-loop
  watchdog re-runs ensureServer() if the adopted/own server dies.
- Server crash → retry ×3 silently (no modal, no app.quit).
- Spotify link self-heal: 3 consecutive beats with spotifyRunning &&
  !debuggable → automatic `bridge.launch()` (30-min cooldown). Startup does
  the same silently (`autoConnectAtStartup`, no dialog).
- **Tray** (generated SVG data-URL icon, no asset): close-to-hide, window-all-
  closed does NOT quit; quit only via tray/app menu.
- Packaged app sets `openAtLogin` → starts with Windows.
- Installed via silent NSIS (`Setup 1.0.0.exe /S`) → %LOCALAPPDATA%\Programs.

**Companion v10 startup race (2026-08-02, user: "Spotify'da çalışmıyor").**
On fast Spotify starts `new Spicetify.ContextMenu.Item(...)` throws
`Cannot read properties of undefined (reading 'jsx')` (Spicetify's React
wrapper not captured yet) and the WHOLE extension dies → no right-click
items, while everything else (CDP pump, desktop app) is healthy. v10 fix:
readiness guard also waits for `Spicetify.React` + `Spicetify.ReactJSX`, and
menu registration is construct-first-then-register inside a try/catch retry
(single-shot flags). Diagnosis trick: CDP `Runtime.enable` REPLAYS the
renderer's buffered console — the startup exception and "[ODF] loaded" lines
are visible hours later (scratchpad cdp-console.js pattern). Note selftest
counts literal `ContextMenu.Item` occurrences === 2 — don't write that string
in comments. Note the analyzer pump remembers lastAnalyzerId — diagnostic
requests need unique ids (Date.now()).

**2026-08-06 "tekrar offline" incident + companion watchdog.** Spotify
self-updated (13:32) → the spicetify patch was wiped → right-click finder +
in-Spotify analyzer vanished while EVERYTHING else (server 3000, CDP 9222,
heartbeat, analyzer pump) stayed green. Diagnosis essentials:
- Patched state on disk = `%APPDATA%\Spotify\Apps\xpui\extensions\
  distro-finder.js` present and NO `xpui.spa`; a Spotify update restores an
  unpatched `xpui.spa` (which wins) — that file's reappearance IS the wipe
  signal.
- `window.__oceanAnalyzer` MISSING does NOT prove the extension is dead — it
  is created lazily on first analyzer request. Proof of load = `document.
  scripts` contains `extensions/distro-finder.js` (CDP evaluate).
- E2E test trick: park `{id,kind:"track",spotifyId,served:false}` on
  `window.__oceanAnalyzer.req` via CDP; the desktop shell answers within ~2s
  if the whole pipeline works (scratchpad analyzer-e2e-test.mjs).
- `spicetify apply` after a Spotify update fails "version mismatched" — the
  recovery is `spicetify backup apply` (2.44 auto-clears the old backup);
  `spicetify restore` refuses in that state.
Fixes shipped: install-spicetify.mjs retries with `backup apply` on mismatch
and takes `--no-restart` (`spicetify -n`); main.js **companion watchdog**
(`companionWiped()` FS check each 30s beat + at startup, 15-min repair
cooldown, 3-failure cap, opt-in only if `%APPDATA%\spicetify\Extensions\
distro-finder.js` exists) kills Spotify, patches, relaunches via
`bridge.launch()` (only if it was running). `bridge.killSpotify()` exported.
Status timestamps from /api/connector/status are UTC — local is +03:00;
don't misread "stale" (that mistake cost 10 minutes).

**2026-08-06 Spotify account link (OAuth PKCE).** `src/spotifyAccount.ts` +
`app/api/spotify-auth/{login,callback,status,disconnect}` + Settings →
"Spotify Account" panel (system.tsx). Authorization Code + PKCE against
`SPOTIFY_OAUTH_CLIENT_ID || SPOTIFY_CLIENT_ID`; redirect URI default
`http://127.0.0.1:3000/api/spotify-auth/callback` — MUST be registered on
developer.spotify.com for the app id used. Scopes default EMPTY (profile +
catalog only). Tokens: `DISTRO_SPOTIFY_ACCOUNT_PATH` (desktop pins to
userData/spotify-account.json), 0600, never returned by any route.
`userSpotifyRequest()` is wired into `spotifyAuth.spotifyRequest` as
FALLBACK-ONLY: pool first; user token when pool unconfigured or
PoolUnavailable (429-parked with retry-after, 401→refresh-once→needsReauth).
Consent opens via panel `window.open` → Electron windowOpenHandler →
external browser.

**2026-08-07 SPOTIFY-BREAKING INCIDENT (read before touching the installer).**
A customer's Spotify broke during a test. Cause was ours: patching rewrites
Spotify's own app files, and `install-spicetify.mjs` exited on a failed
`spicetify apply` WITHOUT restoring — leaving a half-patched, broken client.
Rule now: every failure path runs `spicetify restore` before exiting. Added
`--restore` mode (config `distro-finder.js-` + restore), a post-patch launch
verification in `firstRunSetup()` that rolls back if Spotify does not come
back, and a "Repair Spotify" menu action. Recovery for a broken client, in
order: app menu → Spotify → Repair Spotify; else `spicetify restore`; else
reinstall Spotify (playlists are server-side, nothing is lost). Verified both
directions on the real install: restore brings `xpui.spa` back and removes
`Apps\xpui\extensions\distro-finder.js`; reinstall reverses it.

Also 2026-08-07: `firstRunSetup()` (marker `userData/setup-done.json`) does
the whole setup once — patch launch entries, start Spotify with the CDP flag,
install the companion — because customers will never run terminal commands.
`install-spicetify.mjs` now resolves the Spicetify CLI by PATH **and** by
`%LOCALAPPDATA%\spicetify\spicetify.exe` (the official installer edits PATH,
but an already-running process keeps the old env, so a freshly installed CLI
is otherwise invisible) and installs the CLI itself when absent.
`/api/lookup/start` calls `ensureBridgeReady()`: shell alive + link down →
queue one reconnect (60s rate limit), which is what fixed "distributor not
found" on machines where Spotify was started from its own shortcut.

Build gotchas (2026-08-02):
- Running `next build` (desktop:prepare) while `next dev` is running corrupts
  `.next` → the copied bundle "Ready in 36ms" but EVERY route answers 500
  with silent logs. Stop dev, `rm .next`, rebuild.
- prepare.mjs `rmSync(desktop/server)` can hit EPERM even with no process
  alive (stale directory handle); `Rename-Item server server_old` then
  prepare + delete works.

**2026-09-22 silent companion death after Spotify 1.3.0 (user: "spicetify
eklentisinin kurulu olduğundan emin ol").** Spotify updated to 1.3.0.277
(Chrome/146) and kept the patch (no `xpui.spa`, `extensions/distro-finder.js`
still injected, server/CDP/heartbeat all green) — but spicetify 2.44.0's
wrapper looked for the `webpackChunkclient_web` global, which 1.3.0 no longer
has. Result: `Spicetify.React/ReactJSX/CosmosAsync/showNotification` never
populate, the v10 readiness guard never opens, no "[ODF] loaded" line, no
right-click items. The companion watchdog (`companionWiped()` = xpui.spa
reappearing) does NOT catch this case — the file-level patch is intact.
Diagnosis: CDP `Object.keys(Spicetify)` lacked React/CosmosAsync and the
replayed console had no "[spicetifyWrapper] All required webpack modules
loaded". Fix: spicetify ≥ 2.45.0 (1.3.0 support; 2.45.1 restores menu items
on 1.3.0). CLI is installed via **winget** (`Spicetify.Spicetify`, winget
lagged at 2.45.0) then `spicetify upgrade` in place → 2.45.1; then
`node desktop/scripts/install-spicetify.mjs --no-restart`, `taskkill Spotify`,
relaunch with `--remote-debugging-port=9222 --remote-allow-origins=*`.
Verified: "[ODF] loaded", analyzer e2e via CDP pump answered in ~2s.
Open idea: watchdog should also probe `Spicetify.React` via CDP (wrapper
health), not only the file state.
