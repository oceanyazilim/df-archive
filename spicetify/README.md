# Ocean Distro Finder — Spicetify extension

Two right-click items inside the **Spotify desktop app**:

- **Analyze with Ocean Analyzer** (TR: *Ocean Analyzer ile Analiz Et*) — on a
  track, album, artist or playlist. Opens a full analysis window over Spotify:
  identity, distributor, ISRC/UPC, metadata, external links, and the Spotify
  stream trend chart (daily/total, line/area/bar, 7D–1Y). Album and playlist
  rows drill into a track with a **← Back** breadcrumb.
- **Ocean Distro Finder** — the quick distributor-only panel for a track.

**Where the data comes from.** Track identity, ISRC and the distributor are
resolved *locally* (protobuf metadata + the embedded mapping), so they appear
instantly and work with the desktop app closed. Streaming analytics, albums,
artists and playlists need the panel service, which this renderer cannot reach
— so the **Ocean Distro Finder desktop app** fetches them and hands them back
through the same CDP channel it already uses (`window.__oceanAnalyzer`). With
the desktop app closed the window still shows everything computable locally and
says plainly that analytics need the app.

**Why it is built this way.** Two measured facts about current clients:

- `metadata/4/track/{gid}` **always answers protobuf**
  (`content-type: vnd.spotify/metadata-track`) whatever the `Accept` header
  says. Parsing it as JSON is what produced `Unexpected token … is not valid
  JSON`. The extension decodes the wire format itself and reads the licensor
  UUID from the track-level `licensor` field (field 21), album `3.25` as
  fallback — never `original_audio`, a gid, or the ISRC.
- The renderer **cannot reach a localhost backend by any channel** — `fetch`,
  `XHR`, `WebSocket`, `EventSource` and image loads are all blocked, and
  `CosmosAsync` is unusable ("Resolver not found" even for `sp://` URLs).

So the canonical mapping is **embedded at install time** by
`desktop/scripts/install-spicetify.mjs`, which reads `json/uuid's.json`,
normalizes the UUIDs, excludes conflicting ones, and injects the result — same
source file, same exact-match rule, no pairing — and anything the renderer
cannot fetch itself comes through the desktop app's CDP channel instead.

**Re-run the installer whenever `json/uuid's.json` changes** — the embedded
copy is a snapshot.

Panel lookups do not use this extension at all: the desktop app talks to the
Spotify client directly (see `desktop/README.md`).

## Using the Analyzer

1. Install/refresh the companion: `npm run spicetify:install` (repo root).
2. Start the desktop app and choose **Spotify → Connect to Spotify** once, so
   the app can serve analytics into the Spotify window.
3. In Spotify, right-click any track, album, artist or playlist →
   **Analyze with Ocean Analyzer**. Escape or a click outside closes it.

## Why Spicetify (vs. the browser connector)

The public Spotify Web API does **not** return a licensor UUID. Spicetify runs *inside*
the authenticated desktop client, so `Spicetify.CosmosAsync` can call the internal
metadata endpoint (`spclient.wg.spotify.com/metadata/4/track/{gid}`) — which *does*
contain `licensor.uuid`. No tab-opening, no pairing, no token handling.

## Flow

1. Right-click a track → **Ocean Distro Finder**.
2. Track ID (base62) → **GID** (hex).
3. `Spicetify.CosmosAsync.get(metadata/4/track/{gid})` → `licensor.uuid` (+ ISRC, album, …).
4. `POST {BACKEND}/api/distributor { licensorUuid }` → exact canonical match → distributor.
5. Panel shows Distributor · Status · Licensor UUID · ISRC · Album · Label · Duration.

Only a sanitized licensor UUID leaves the client. Label is shown for reference and is
**never** used as the distributor. States are distinct: `verified` / `uuid_not_mapped` /
`uuid_unavailable` / `invalid_uuid` / `conflict`.

## Install

1. Start the backend (dev): `npm run start` (or `npm run dev`) — default `http://localhost:3001`.
   If your backend runs elsewhere, edit `BACKEND` at the top of `distro-finder.js`.
2. Copy `distro-finder.js` into your Spicetify extensions folder:
   - Windows: `%APPDATA%\spicetify\Extensions\`
   - macOS/Linux: `~/.config/spicetify/Extensions/`
   (or run `spicetify config-dir` to locate it)
3. Enable + apply:
   ```
   spicetify config extensions distro-finder.js
   spicetify apply
   ```
4. In Spotify, right-click any track → **Ocean Distro Finder**.

## Verify with the known fixture

Track `5MH8rf9BdkrFlBEeaYkFZ3` (GID `be172e79403e48edb9742d98baf252cd`,
ISRC `FRX282689836`) → licensor `c71b29ea9e1e48c6931da2dd7c0bf5d5` →
**Believe Digital** (Verified).

Backend resolution is independently testable without Spotify:
```
curl -X POST http://localhost:3001/api/distributor \
  -H "Content-Type: application/json" \
  -d '{"licensorUuid":"c71b29ea9e1e48c6931da2dd7c0bf5d5"}'
# → {"distributor":"Believe Digital","licensorUuid":"c71b29ea…","status":"verified"}
```

## Notes

- Soundcharts is not involved here — this panel is distributor-only. Streaming analytics
  live in the web panel.
- If the desktop client blocks `http://localhost` from the `https` renderer (mixed
  content), run the backend over `https` or use a loopback tunnel, and set `BACKEND`
  accordingly.
