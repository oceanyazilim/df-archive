# Virus Records — Desktop app

An Electron shell that turns the existing web panel into a Windows PC app.
It boots the **same Next.js standalone server** the Docker image uses (on
`http://127.0.0.1:3000`) and opens the panel in a native window. The dev
server (`npm run dev`) uses the same port — run one at a time, or override
with `DISTRO_DESKTOP_PORT`.

Track data comes **from the running Spotify desktop application** over the
DevTools protocol — no pairing code, no browser extension:

```
Spotify desktop app (started with --remote-debugging-port)
        │  the renderer performs ITS OWN authenticated metadata request;
        │  only the response body (protobuf) comes back — never the token
        ▼
Electron app ── spotify-bridge.js ── POST /api/connector/spotify-metadata
        │       (auto-paired with its own server; the code never leaves the app)
        ▼
bundled Next.js server ── decodes protobuf ── json/uuid's.json ── distributor
```

Why the DevTools protocol: the Spotify renderer cannot reach a localhost
backend by **any** channel (fetch / XHR / WebSocket / SSE / image are all
blocked, and `CosmosAsync` is unusable in current clients), so an in-client
extension cannot deliver data to the panel. The bridge inverts the direction —
the app reads from Spotify instead of Spotify pushing to the app.

`src/spotifyProtobuf.ts` owns the wire-format decoding and is covered by
`npm test` against a real captured response.

## Licensing (Virus Records key system)

The app refuses to work until a key issued from the panel at
**distro.virusrecord.com** activates it (`license-panel/` in this repo — deploy that
first). Two layers enforce it:

- **UI** — `LicenseGate` in `app/page.tsx` shows the activation screen instead
  of the app.
- **Server** — `requireLicense()` guards every analysis route
  (`lookup`, `analyzer`, `album`, `artist`, `playlist`, `song`,
  `distributor(s)`), answering **402** when unlicensed. Skipping the UI buys
  nothing.

| Where | What |
|---|---|
| `src/license/client.ts` | activation, heartbeat, the local license file |
| `src/license/guard.ts` | the route guard |
| `app/api/license/*` | local endpoints the UI talks to (never expose the token) |

Behaviour worth remembering:

- The **device id** is a random UUID stored in the license file (Electron
  userData, so it survives app updates). It is what the panel counts as "this
  computer" — not a hardware fingerprint.
- **Check-ins every 15 minutes**, plus one at every start. Revoking a key in
  the panel locks the app at its next check-in, not instantly.
- **7-day offline grace**: an unreachable panel never locks a paying user out;
  only a definitive refusal (revoked / expired / blocked) locks immediately.
- Override the panel URL with `OCEAN_LICENSE_SERVER` (defaults to
  `https://distro.virusrecord.com`) — this is how you test against a local panel:

  ```powershell
  $env:OCEAN_LICENSE_SERVER="http://127.0.0.1:4000"; npm start
  ```

When the user links their Spotify account, the app reports the identity fields
its consent screen lists (id, display name, avatar, country, account type,
followers, e-mail) to the panel, so a key can be matched to a person. Tokens
and listening history are never sent; disconnecting deletes the identity from
the panel too.

## Dev quick start

```powershell
# repo root
npm run desktop:prepare        # next build + assemble desktop/server bundle

cd desktop
npm install                    # electron + electron-builder (first time only)
npm start                      # launches the app window
```

In the app: **Spotify → Connect to Spotify** (once). Spotify restarts with the
app link enabled; from then on panel lookups resolve automatically whenever
Spotify is open.

Optional, independent of the above — the in-Spotify right-click panel:

```powershell
npm run spicetify:install      # repo root; embeds the current mapping
```

Then right-click any track in Spotify → **Ocean Distro Finder**. Re-run the
installer whenever `json/uuid's.json` changes.

## Ship an installer

```powershell
npm run desktop:prepare        # repo root — refresh the server bundle
npm run desktop:dist           # builds an NSIS installer under desktop/dist/
```

The server bundle (`desktop/server/`), the companion source, and the installer
script are packaged as extraResources, so the installed app can (re)install the
companion by itself.

## Notes

- `desktop/server/` is **generated** by `prepare.mjs` — never edit it by hand.
- Ports: panel `3000` (`DISTRO_DESKTOP_PORT`), Spotify DevTools `9222`
  (`DISTRO_SPOTIFY_CDP_PORT`).
- If Spotify is started normally (without the debugging port), panel lookups
  time out honestly and Settings shows "Spotify not reachable" — use
  **Spotify → Connect to Spotify** again.
- No env vars are required for distributor lookup. Soundcharts/Spotify API keys
  (for analytics views) are picked up from `.env*` files copied into the bundle
  by `prepare.mjs`, or from the process environment.
- Spotify self-updates wipe the Spicetify patch (the right-click panel and the
  in-Spotify analyzer vanish). The desktop shell detects this automatically
  (companion watchdog: `xpui.spa` reappearing / the extension file missing) and
  silently reinstalls the companion, then relaunches Spotify with the app link.
  Manual fallback: `npm run spicetify:install` (the installer now recovers from
  the version-mismatch state by itself).
- Optional Spotify account link (Settings → Spotify Account): OAuth
  Authorization Code + PKCE against the public client id. Requires the redirect
  URI `http://127.0.0.1:3000/api/spotify-auth/callback` to be registered on the
  app in developer.spotify.com. Tokens live in the Electron user-data dir
  (`spotify-account.json`) and are used as a Web API fallback when no pool key
  is usable — an installed copy with zero bundled keys works after one consent.
