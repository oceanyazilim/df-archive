---
name: spotify-client-constraints
description: "Measured limits of the current Spotify desktop client — metadata is always protobuf, renderer cannot reach localhost by any channel, CosmosAsync is dead; hence protobuf decoding + CDP bridge"
metadata: 
  node_type: memory
  type: project
  originSessionId: caf688ed-810e-4b91-96ee-2afc74b547e2
  modified: 2026-07-31T15:46:20.190Z
---

Measured against the live client on 2026-07-31 (Chrome 146 renderer, Spicetify
2.44) by attaching over CDP — these are facts, not guesses, and they dictate
the architecture in [[desktop-app]]:

1. `spclient.wg.spotify.com/metadata/4/track/{gid}` **always returns protobuf**
   (`content-type: vnd.spotify/metadata-track`) regardless of the `Accept`
   header. Treating it as JSON is what produced "Unexpected token … is not
   valid JSON" — the error came from Cosmos' own internal parse, not our code.
   Decoder lives in `src/spotifyProtobuf.ts` (covered by `npm test` against
   `src/__fixture-track-metadata.bin`, a real 761-byte response).
   Field map: 1 gid · 2 name · 3 album{1 gid,2 name,17 cover_group,25 licensor}
   · 4 artist{2 name} · 7 duration_ms · 10 external_id{1 type,2 id}
   · **21 licensor{1 uuid}** ← the track-level licensor · 24 original_audio
   (NEVER the licensor).
2. The renderer **cannot reach a localhost backend by any channel**: fetch,
   XHR, WebSocket, EventSource and image loads all fail. So nothing running
   inside Spotify can push to the panel.
3. `Spicetify.CosmosAsync` is **unusable** in current clients — even
   `sp://product-state/v1/values` returns "Resolver not found". Do not build
   on it.

Consequences: the Spicetify extension resolves **offline** (mapping embedded at
install time by `desktop/scripts/install-spicetify.mjs`, conflicts excluded —
re-run it when `json/uuid's.json` changes), and panel lookups use a **CDP
bridge** (`desktop/spotify-bridge.js`): the app launches Spotify with
`--remote-debugging-port=9222`, has the renderer run its own metadata fetch,
and receives only the base64 body → `POST /api/connector/spotify-metadata`.
The desktop app auto-pairs with its own server, so users never type a code.

Debugging tip: `Spotify.exe --remote-debugging-port=9222 --remote-allow-origins=*`
plus puppeteer-core `connect({browserURL})` gives a live REPL inside the client —
the fastest way to test any client-side assumption. Note `spicetify apply`
restarts Spotify without the debug flag.
