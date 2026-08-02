# Ocean Analyzer for Spotify (Manifest V3)

A browser extension for **open.spotify.com** with two parts:

1. **Ocean Analyzer** (main feature) — adds **"Analyze with Ocean Analyzer"**
   to the right-click menu on tracks, albums, artists and playlists, and opens
   an analysis modal over Spotify. See [Ocean Analyzer](#ocean-analyzer) below.
2. **Metadata observer** (original feature) — in **your own, logged-in**
   session it observes **only** the track extended-metadata response and
   extracts the licensor UUID, which the analyzer and panel map to a
   distributor via the local `json/uuid's.json`.

## Ocean Analyzer

**Targets are identified only from real Spotify identifiers** — never from
visible text. `analyzer/targetResolver.js` checks, in order: the element's
`data-uri` / `data-context-uri` / `data-testid`, an `href` containing
`/track|album|artist|playlist/{22-char id}` (including `/intl-xx/` URLs),
identifying links inside the closest row/card (a track link wins over the
album/artist links sharing that row), then the page URL. No identifier means no
menu item; Spotify's hashed class names are never relied on.

**The menu row is injected into Spotify's own menu**, styled from a native
item's computed style, so Spotify's entries keep working. If Spotify opens no
menu for that spot, a small standalone menu appears instead. Injection is
idempotent (marker attribute + one short-lived observer per menu, always
disconnected), so the row can never appear twice.

**The modal** renders in a shadow root, so Spotify's styles cannot reach in and
its CSS cannot leak out. Exactly one instance exists — analyzing something new
re-renders it in place. Escape or a backdrop click closes it and restores
background scrolling. Tabs adapt to the target:

| Target   | Tabs |
|----------|------|
| Track    | Overview · Streams · Playlists · Markets · Metadata · Links |
| Album    | Overview · Tracks · Metadata |
| Artist   | Overview · Releases · Tracks |
| Playlist | Overview · Tracks · Artists |

Clicking a track row inside an album or playlist drills into it with a
**← Back** breadcrumb; **Open Full Dashboard** opens the main panel with the
same target preloaded.

**Honesty rules.** Stream figures appear only when Soundcharts actually
returned them — otherwise the hero card reads *Stream data unavailable* with
the reason. A missing day is drawn as a gap, never as zero. The distributor
comes only from an exact licensor-UUID match; unmatched reads *Unknown
distributor*, and a raw UUID is never shown as a name. Anything estimated would
carry an explicit `Est` badge; nothing currently is.

Measured Spotify API restrictions (2026-07) are surfaced rather than hidden:
`popularity`, `followers`, `genres`, `available_markets` and artist top-tracks
are no longer returned to third-party apps, and only a playlist's first page is
readable. The UI says so exactly where those values would have appeared.

Files: `analyzer/targetResolver.js` · `contextMenu.js` · `modal.js` ·
`modal.css` · `chart.js` · `bridge.js`, plus the analyzer handlers in
`service-worker.js`.

## What the observer does
- Runs only on `https://open.spotify.com/*`.
- Observes only responses to `https://spclient.wg.spotify.com/metadata/4/track/{32-hex}`.
- Extracts the licensor UUID from `licensor.uuid` (fallback `album.licensor.uuid`).
  Current clients answer that endpoint with **protobuf**, so the observer decodes
  the wire format (track field 21, album 3.25) when the response is not JSON —
  never `original_audio`, a gid, or the ISRC.
- Sends a sanitized payload to the panel origin you configured, authorized by a
  connector key you obtain through an explicit pairing step.

## What it does NOT do
- Never reads, copies, stores, or sends **authorization headers, access/bearer
  tokens, refresh tokens, cookies, session data, client secret**, Spotify
  local/session storage, request headers, request bodies,
  `content_authorization_attributes`, `original_audio.uuid`, cover-image arrays,
  account email, payment, or profile data.
- Never sends the full raw Spotify response — only a new sanitized object.
- Never bypasses Spotify authentication; you must be logged in as yourself.
- Never calls Spotify from the panel backend with a copied token.
- Never observes `collection/v2/contains`, auth, account, or payment endpoints.
- No remote scripts, no CDN, no analytics, no telemetry.

## Permissions and why
- `storage` — persist your settings (enabled flag, panel origin, connector key,
  last capture) and remember licensor UUIDs per track for the session so the
  analyzer can name a distributor for tracks you have already opened.
- `tabs` — open the full dashboard in a new tab from the analyzer modal.
- host `https://open.spotify.com/*` — run the observer content scripts and let the
  popup detect whether a Spotify tab is open (avoids the broader `tabs` permission).
- host `http://127.0.0.1:3000/*` — allow the service worker to POST sanitized
  metadata to your local dev panel. **For production, add your exact HTTPS panel
  origin** (e.g. `https://panel.example.com/*`) to `host_permissions` in
  `manifest.json` and reload. No `https://*/*` wildcard is used.

## Sanitized fields collected
`source, capturedAt, spotifyTrackId, spotifyUri, trackGid, trackTitle, artists[]
(names only), albumTitle, albumLabel, isrc, durationMs, licensorUuid`.

## Install (unpacked)
1. Start the panel — the desktop app (`npm run desktop:start`, port 3001) or the
   web version (`npm run dev`, port 3000).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. **Load unpacked** → select this folder (`extension/spotify-distributor-connector`).
5. Open the extension **Options** and set the panel origin to match step 1.

Then open Spotify Web Player and right-click any track, album, artist or
playlist → **Analyze with Ocean Analyzer**. The analyzer needs no pairing;
pairing below is only for the automated panel-lookup flow.

## Pair with the panel
1. In the panel → **Distributor Finder** → **Generate pairing code**.
2. Open the extension **Options** (or popup → Options).
3. Confirm the **Panel origin** (`http://127.0.0.1:3000` by default), Save.
4. Enter the **pairing code**, click **Pair**. The connector key is stored in
   `chrome.storage.local` and never exposed to the Spotify page.
5. In the popup, toggle **Enabled** on.

## Perform a lookup (one click, automatic)
1. In the panel, paste a Spotify track URL and click **Find Distributor**.
2. The panel sends a one-click command to the extension (via
   `externally_connectable` → `onMessageExternal`). **You do not open Spotify
   yourself.**
3. The extension opens the track in an **inactive background tab**, the observer
   captures the sanitized metadata, forwards it, and the panel shows the
   distributor. The extension then **closes only the tab it created**.
4. If your Spotify session expired, the extension brings that tab forward and the
   panel shows *"Spotify login is required. Sign in once, then retry."* — it does
   not silently time out.

You only need to stay **signed into Spotify** in this browser profile; you do
not need to keep a Spotify tab open.

### Permissions added for automation
- `alarms` — schedule the temporary-tab timeout cleanup and the paired heartbeat.
- host `https://accounts.spotify.com/*` — detect a login redirect on the tab the
  extension created (never reads credentials).
- `externally_connectable: ["http://127.0.0.1:3000/*"]` — allow **only** your
  panel origin to send the START command. For production, replace with your exact
  HTTPS panel origin (no wildcards).
- content script on the panel origin (`panel-bridge.js`) — announces the
  extension id so the panel can send the one-click command and show install status.

The extension never creates more than one temporary tab per lookup, never starts
playback, and never modifies your library or account.

## Privacy
- Raw Spotify responses are never stored. Tokens/cookies are never collected.
- The connector key only authorizes delivery to **your** panel; it is not a
  Spotify token. Revoke it any time with **Disconnect** (popup or options).
- Use **Clear history** to wipe the locally-stored last capture/result.

## Troubleshooting
- *Not paired* — generate a fresh code (valid ~5 min) and pair again.
- *Panel unreachable* — check the panel origin and that the panel is running.
- *No capture* — ensure the extension is Enabled, you are logged into Spotify,
  and you opened the exact track from the panel.
- *"Spotify metadata format changed"* — the private endpoint/schema changed; the
  extension will not broaden capture. Update the parser or use the panel's manual
  paths. The extension never uploads unknown responses.

## Disable / uninstall / revoke
- Disable: toggle **Enabled** off in the popup.
- Revoke pairing: **Disconnect** (revokes the key server-side and clears it).
- Change panel origin: Options → edit **Panel origin** → Save (then re-pair).
- Uninstall: `chrome://extensions` → Remove.

## Tests
`node tests/connector.test.mjs` loads the real observer + bridge in a mocked
browser and drives the confirmed fixture, asserting the licensor UUID is
extracted and all forbidden fields are excluded.

> ⚠️ The Spotify extended-metadata endpoint is not a stable public API. Its shape
> may change without notice; the parser is defensive and fails closed.
