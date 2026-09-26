---
name: license-system
description: "Virus Records license key panel (license-panel/, Dokploy at virusrecords.net) + the app-side activation gate, heartbeat, and Spotify-identity reporting"
metadata: 
  node_type: memory
  type: project
  originSessionId: 20f7533c-1f5d-4131-b462-0b26eb894855
  modified: 2026-08-06T21:35:24.650Z
---

Added 2026-08-06 (user: keys must be issued only from a panel on a domain,
with IP/time auditing to catch sharing).

**Panel — `license-panel/`** is its own Next.js 14.2.35 app (patched: 14.2.5
carries a published advisory and this one is internet-facing), deployed to
**Dokploy** via its own Dockerfile (`output: standalone`, node:20-alpine,
`/data` VOLUME). Zero dependencies beyond Next/React/lucide: keys live in
`DATA_DIR/keys.json`, the audit trail in `events.jsonl` (append-only, rotated
at 50k into `events-archive.jsonl`). Env: `PANEL_PASSWORD`, `PANEL_SECRET`
(≥16 chars, HMAC-signs a STATELESS session cookie — Dokploy restarts on every
redeploy, so an in-memory session table would log the admin out each time).

Key types: `single` (1 device, forever), `duration` (N days from FIRST
activation — an unused key never burns its days), `unlimited`
(`deviceLimit: 0` = unlimited devices). Device binding is a random UUID from
the app (NOT a hardware fingerprint). Token = 32 random bytes, stored HASHED
on the device binding.

App-facing API (`/api/v1/`): `activate`, `heartbeat`, `spotify`. Admin API
(`/api/admin/`) is cookie-gated. Client IP comes from `x-forwarded-for[0]`
(Traefik in front); per-IP rate limiting on the public routes. Sharing signal:
≥4 distinct IPs or devices over the limit → flagged in the UI; actions are
block-one-device / release-slot / revoke-key.

**App side** — `src/license/client.ts` + `src/license/guard.ts`:
- `requireLicense()` returns **402** and is inserted in every analysis route
  (lookup, analyzer, album, artist, playlist, song, distributor(s)). `/api/health`
  and `/api/connector/*` stay open — the shell needs them.
- UI gate = `LicenseGate` in `app/page.tsx` → `ActivationScreen`.
- 15-minute heartbeat (desktop `beat()` pings `/api/license/status`), **7-day
  offline grace**; only a 403 verdict (revoked/expired/blocked) locks at once.
  A 500 from the panel is NOT a verdict.
- `DISTRO_LICENSE_PATH` pinned to Electron userData; `OCEAN_LICENSE_SERVER`
  defaults to `https://virusrecords.net` (override for local tests).
- Spotify consent now requests `user-read-private user-read-email` and
  `reportSpotifyIdentity()` posts identity ONLY (id, name, avatar, country,
  product, followers, email) — the Settings consent box lists exactly that set;
  keep the two in sync. Disconnect posts `profile: null`, deleting it panel-side.

**Design**: app + panel rebranded to Virus Records — accent tokens switched from
ocean blue to acid lime `#9CF04A` (+ violet `#A98BFF`) in both `globals.css`
files. The Electron installer identity (productName/appId) was deliberately
NOT renamed — that would orphan the existing install's userData.

Tests (scratchpad, not committed): `panel-e2e.mjs` 29/29 and
`license-flow-e2e.mjs` 22/22 — the second one runs the built app on :3010
against the panel on :4000 and covers 402-before-activation, masked key,
revoke→lock, and the panel recording IP/version/device name.

**2026-08-07 customer vs admin mode.** One build, two audiences — "customer"
= no admin session (`useIsAdmin()` false). Nav access model in
`nav-config.ts`: `access: "all" | "vip" | "admin"` plus exported
`ADMIN_ONLY_VIEWS` / `VIP_VIEWS`; `go()` in page.tsx refuses admin views and
diverts VIP ones to `VipDialog`, so the guard is not just visual. Hidden for
customers: Operational badge, SystemStatusCard, Tools section, API Status,
"Analyzer v4" pill; UserMenu says Customer/Administrator, avatar VR.
`WelcomeScreen` (greeting + single input) owns the first screen until
`workspaceOpen`. `app/lib/localHistory.ts` = browser-local 7-day store
(purges on every read AND write) powering CustomerHistoryView +
CustomerAnalyticsView + RecentAnalysesCard; admins keep the server
`/api/history`. `app/lib/analysisNav.ts` = in-memory snapshot stack for the
header back/forward arrows — restores state, never re-runs the analysis.
Settings shows plan quotas (Spotify 10k / "Ocean Analyze" 10k per month) to
customers instead of CredentialPools.

**Spotify OAuth reality (measured 2026-08-07).** The app already uses ONE
dev client id (`SPOTIFY_OAUTH_CLIENT_ID || SPOTIFY_CLIENT_ID`) — that is not
the problem. A Development-Mode Spotify app only lets the ≤25 accounts added
under User Management authorize; everyone else is refused AFTER logging in.
Customers therefore cannot link accounts until Extended Quota Mode is
granted. Also: probing accounts.spotify.com/authorize can't validate the
redirect URI (it 303s to login first), and Spotify rejects `localhost` but
accepts the `127.0.0.1` loopback form. Settings now shows the exact redirect
URI + both causes (admin only).

Rebrand gotcha: ocean-blue hex values were hardcoded in chart/loader files
(`#39BDF8`/`#1578FF`) and survived the token switch — recolored to
`#9CF04A`/`#4C8F1C`. `Panel` headers now wrap; a wide toolbar used to crush
the title to a single letter.

Related: [[desktop-app]], [[spotify-api-restrictions]], [[ui-architecture]].
