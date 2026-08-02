# Distributor Finder (distro-finder)

A panel (web + Electron desktop app) that finds a track's **distributor from a
Spotify track URL**, using the licensor UUID that the user's own Spotify
desktop client already receives:

```
Spotify track URL → panel creates a pending lookup (by public track id)
  → the desktop app asks the running Spotify client, over the DevTools
    protocol, to perform ITS OWN /metadata/4/track/{gid} request
  → only the raw protobuf response comes back (never the session token)
  → backend decodes it, reads licensor.uuid (album fallback), and matches
    that UUID against json/uuid's.json
  → distributor shown in the panel
```

Independently, the **Spicetify extension** (`spicetify/distro-finder.js`) adds a
right-click "Ocean Distro Finder" panel inside Spotify itself, resolving offline
against a mapping embedded at install time.

> Legacy: the Manifest V3 browser extension
> (`extension/spotify-distributor-connector/`) is no longer used. Current
> Spotify clients block every localhost channel from the renderer, so nothing
> running inside Spotify can push data to the panel — hence the desktop bridge.

> **Core rule:** the distributor is determined **only** by the exact licensor
> UUID match against `json/uuid's.json` — never from album label, artist, title,
> ISRC/UPC prefix, or Spotify track/album GID.

The extension (`extension/spotify-distributor-connector/`) never reads or sends
Spotify tokens, cookies, headers, or raw responses; it only sends a sanitized
payload to **your** paired panel. See its README for details. The private Web
Player endpoint is only **observed** in the user's own session — never called
from the backend with a copied token.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **React 18**
- Server-side API routes; data files are read only on the server, full lists
  never returned to the browser
- No UI framework dependency — hand-written responsive CSS dashboard
- Core logic in `src/` (framework-agnostic, unit-tested)

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/connector/pair/start` | panel generates a short-lived pairing code |
| `POST` | `/api/connector/pair/complete` | exchange a code for a revocable connector key |
| `POST` | `/api/connector/disconnect` | revoke the connector key |
| `GET`  | `/api/connector/status` | safe connection status (paired?) |
| `GET`  | `/api/connector/pending` | (auth) pending lookup track ids only |
| `POST` | `/api/connector/spotify-event` | (auth) receive one sanitized metadata payload |
| `POST` | `/api/lookup/start` | create a pending lookup for a Spotify track id |
| `GET`  | `/api/lookup/{requestId}` | lookup status + result |
| `GET`  | `/api/uuid-mapping/status` · `POST /reload` | mapping counts/conflicts; reload |
| `GET`  | `/api/health` | safe component status (no secrets) |

Connector events authenticate with `Authorization: Connector <key>` — never a
Spotify token. Keys are stored server-side hashed (SHA-256), are revocable, and
connector endpoints are rate-limited with replay/dedup protection.

## Quick start

```bash
npm install
npm run dev                    # http://localhost:3000
```

1. Run the desktop app (`npm run desktop:start`, or the installer from
   `npm run desktop:dist`) and choose **Spotify → Connect to Spotify** once —
   Spotify restarts with the app link enabled. No pairing code to type.
2. Paste a Spotify track URL and click **Find Distributor**. The app reads the
   licensor UUID from the Spotify client's own metadata — **no manual Spotify
   step per lookup**, no tabs, no browser.
3. Optional: `npm run spicetify:install` adds the right-click panel inside
   Spotify (see `spicetify/README.md`).

Connection status is verified through the backend (`/api/connector/status` +
heartbeat), not frontend state.
Multiple UUIDs (one per line or comma-separated) run as a batch.

No environment variables are required for local UUID lookup — only that
`json/uuid's.json` exists and is valid JSON.

## Production

```bash
npm run build
npm run start                  # serves the optimized build on :3000
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Core logic self-test (mock API, no token) |
| `npm run lint` | ESLint |

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `SPOTIFY_CLIENT_ID` | — | Spotify app client id, **server-side only** |
| `SPOTIFY_CLIENT_SECRET` | — | Spotify app client secret, **server-side only**, never `NEXT_PUBLIC_` |
| `SPOTIFY_MARKET` | — | Optional `market` query param for the track lookup |
| `LICENSOR_API_URL` | — | Authorized ISRC→UUID licensor endpoint (server-side) |
| `LICENSOR_API_TOKEN` | — | Licensor API token, **server-side only** |
| `LICENSOR_API_TOKEN_HEADER` | `Authorization` | Header the licensor token is sent in |
| `LICENSOR_API_TOKEN_PREFIX` | `Bearer` | Prefix before the licensor token |
| `LICENSOR_API_ISRC_FIELD` | `isrc` | Field/query-param name for the ISRC (alias: `LICENSOR_API_TRACK_FIELD`) |
| `LICENSOR_API_METHOD` | `GET` | `GET` (query param) or `POST` (JSON body) |
| `LICENSOR_API_UUID_PATHS` | — | Optional comma-separated dotted paths tried first for the UUID, e.g. `data.licensor.uuid` |
| `LOOKUP_CONCURRENCY` | `10` | Max parallel lookups |
| `LOOKUP_TIMEOUT_MS` | `15000` | Per-request timeout |
| `LOOKUP_MAX_RETRIES` | `3` | Retries for temporary failures |
| `LOOKUP_CACHE_TTL_MS` | `60000` | Short-term result cache TTL (0 disables) |
| `LOOKUP_MAX_BATCH` | `500` | Max tracks per batch request |
| `DEMO_MODE` | `false` | Use mock upstream instead of the live pipeline |
| `DISTRO_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

## Spotify + licensor API configuration

1. **Spotify** — create an app at the Spotify Developer Dashboard and set
   `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`. The server obtains a
   Client Credentials token (cached until expiry), calls
   `GET https://api.spotify.com/v1/tracks/{id}`, and reads the ISRC from
   `external_ids.isrc`. Only the official public Web API is used.

2. **Licensor API** — point `LICENSOR_API_URL` at the authorized endpoint that
   maps an ISRC to a licensor UUID. The ISRC is sent as `LICENSOR_API_ISRC_FIELD`
   (a query param for `GET`, a JSON body field for `POST`); the token is attached
   with `LICENSOR_API_TOKEN_HEADER` + `LICENSOR_API_TOKEN_PREFIX`.

The licensor UUID is extracted from the licensor response by probing, in order:
`licensorUuid`, `licensor_uuid`, `licensor.uuid`, `licensor.id`,
`rightsHolder.uuid`, `owner.uuid`, plus `data.*` / `track.*` nested variants
(see `src/extractLicensorUuid.ts`). Adjust that candidate list if your licensor
API nests the UUID elsewhere.

## UUID mapping file format

`json/uuid's.json` is auto-detected in any of these shapes (never rewritten):

```json
[{ "uuid": "...", "name": "..." }]              // the current file
[{ "uuid": "...", "distributor": "..." }]
[{ "licensorUuid": "...", "distributorName": "..." }]
{ "<uuid>": "<distributor>" }
```

A UUID that maps to two different distributors is reported as a
`UUID_MAPPING_CONFLICT` and **excluded** from matching — the system never guesses.

## API endpoints

See **Local UUID API endpoints** near the top. The health endpoint is detailed below.

### Health endpoint

Reports the three resolution stages separately. No URL, token, secret, or full
list is exposed.

```json
{
  "status": "ok",
  "spotifyApiConfigured": true,
  "trackCatalogLoaded": true,
  "trackCatalogCount": 3,
  "uuidMappingLoaded": true,
  "uuidMappingCount": 75,
  "uuidMappingConflicts": 1,
  "automaticTrackResolutionReady": true
}
```

`status` is `ok` when `automaticTrackResolutionReady` is true (track catalog AND
UUID mapping both loaded), else `degraded`. Spotify is optional — it enriches
metadata and enables ISRC-based catalog matching; a track can resolve purely by
its Spotify id if that id is in the catalog.

## Panel features

- Dashboard summary cards (queries, matched, unmatched, missing, failed, mappings)
- Single + batch lookup (newline / comma / paste / CSV upload)
- Live progress bar with processed / matched / failed counts and **cancel**
- Results table: search, status filter, sort, copy UUID/distributor, expandable
  row details, responsive horizontal scroll, empty/loading states
- Status badges: Matched · UUID Not Found · UUID Missing · Mapping Conflict · API Failed
- Export results as **CSV** and **JSON** (never includes tokens/headers/credentials)
- UUID Mapping status page with conflict list and manual refresh
- Lookup history (browser localStorage, non-sensitive only)
- System status page (no URLs/tokens shown)

## Docker / Dokploy deployment

```bash
docker build -t distro-finder .
docker run -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID=... \
  -e SPOTIFY_CLIENT_SECRET=... \
  -e LICENSOR_API_URL=... \
  -e LICENSOR_API_TOKEN=... \
  distro-finder
```

The image uses Next.js **standalone** output and bundles `json/uuid's.json`. It
exposes a Docker `HEALTHCHECK` against `/api/health`. For Dokploy, set the same
environment variables in the app config and use port `3000`.

## Backup API credentials (automatic failover)

Both Spotify and Soundcharts rate-limit per application, and a single lockout
can last hours — one busy artist-catalogue run once got a Spotify app 429'd
with `Retry-After: 13 hours`. To survive that, the app keeps a **pool of
interchangeable credentials per provider** and rotates automatically:

- **429** → that key is parked for exactly its `Retry-After`; the very next
  call uses the next key.
- **401/403** → that key is disabled for the process and reported (bad
  credentials do not fix themselves).
- **All keys parked** → callers get the real remaining wait, not a vague error.

Add spares as numbered environment variables. Slot 1 is the existing
unsuffixed pair, so nothing breaks if you add nothing:

```
SPOTIFY_CLIENT_ID=…            SPOTIFY_CLIENT_SECRET=…
SPOTIFY_CLIENT_ID_2=…          SPOTIFY_CLIENT_SECRET_2=…
SPOTIFY_CLIENT_ID_3=…          SPOTIFY_CLIENT_SECRET_3=…

SOUNDCHARTS_CLIENT_ID=…        SOUNDCHARTS_CLIENT_SECRET=…    [SOUNDCHARTS_TEAM_ID=…]
SOUNDCHARTS_CLIENT_ID_2=…      SOUNDCHARTS_CLIENT_SECRET_2=…  [SOUNDCHARTS_TEAM_ID_2=…]
```

Empty or half-filled slots are ignored. Up to 10 slots per provider.
`SPOTIFY_MAX_REQUESTS_PER_MINUTE` (default 90) paces outgoing calls so the
pool is a safety net rather than a licence to burn every key at once.

**Settings → API Credentials** shows each slot as `#2 ab12… available` with a
countdown when parked. Keys are never displayed, logged, or returned by the
API — only a 4-character fingerprint.

Distributor lookups do not use these APIs at all (they read your own Spotify
client), so they keep working even when every key is throttled.

## Security notes

- All Spotify and licensor API calls are **proxied server-side**; the browser
  only calls this app's own endpoints.
- The private Spotify Web Player (`spclient.wg.spotify.com`) is never used and
  its session tokens are never read or reused — only the official public Web API
  with a Client Credentials token.
- Spotify credentials and the licensor token are read from the server
  environment. They are never hardcoded, logged (only a masked length
  reference), returned in responses, placed in `json/uuid's.json`, exposed to
  frontend JS, or stored in the browser.
- Spotify title / artist / album label / copyrights are shown for reference only
  and never used to determine the distributor.
- Logs mask credential-like fields; batch size is capped (`LOOKUP_MAX_BATCH`);
  request bodies must be valid JSON; error messages are sanitized.

## Troubleshooting

- **`TOKEN_MISSING`** — set `LICENSOR_API_TOKEN` (or `DEMO_MODE=true`).
- **All lookups `API Failed`** — check `SPOTIFY_CLIENT_ID/SECRET`, `LICENSOR_API_URL`,
  the licensor method, and token header/prefix. A Spotify 401 usually means bad
  client credentials.
- **`UUID Missing`** — either Spotify returned no `external_ids.isrc`, or the
  licensor response nests the UUID under a field not in the candidate list
  (add it in `src/extractLicensorUuid.ts`).
- **Mapping conflict** — two distributors share a UUID in `json/uuid's.json`;
  resolve the duplicate in the file, then use **Refresh mapping**.

## Project layout

```
app/                        Next.js App Router UI + API routes
  api/distributor-lookup/   Spotify URL → distributor (single + batch)
  api/track-catalog/        status + reload (json/tracks.json)
  api/uuid-mapping/         status + reload (json/uuid's.json)
  api/health/               staged health
  components/, lib/         track result cards + client helpers
src/                        framework-agnostic core (reused by the API routes)
  spotifyTrackResolver.ts   full pipeline: Spotify → ISRC → catalog → UUID → distributor
  spotify.ts                official Spotify Web API (parse id, token, metadata, ISRC)
  trackMapping.ts           json/tracks.json loader (spotifyTrackId / ISRC → UUID)
  uuidResolver.ts           licensor UUID → distributor (final step)
  uuidMapping.ts            load + validate + conflict detection (in-memory Map)
  normalizeUuid.ts          normalize (trim/unquote/lowercase/canonical-hyphen collapse)
  selftest.ts               core self-test (npm test)
json/uuid's.json            licensor UUID → distributor mapping
json/tracks.json            Spotify-track id / ISRC → licensor UUID (your catalog)
```
