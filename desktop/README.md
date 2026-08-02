# Ocean Distro Finder — Desktop app

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
- Spicetify survives most Spotify updates but occasionally needs
  `spicetify restore backup apply` after a client update — just re-run
  `npm run spicetify:install`.
