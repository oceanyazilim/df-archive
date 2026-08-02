/**
 * Local development server.
 *
 * Same HTTP server as src/server.ts, but pre-wired with a STUB token provider
 * and a STUB internal API client so you can hit localhost and see real UUID ->
 * distributor matches without a live backend.
 *
 * Run:  npm run dev         (ts-node, no build)
 *       PORT=4000 npm run dev
 *
 * Replace setTokenProvider / setInternalApiClient below with your project's
 * authorized implementations to point at the real internal API.
 */

import { createServer } from "./server";
import {
  DistributorResolver,
  setInternalApiClient,
  setTokenProvider,
} from "./index";
import { InternalApiTrackResponse, TrackIdentifier } from "./types";

// Stub token — for LOCAL TESTING ONLY. Real deployments inject an authorized
// provider from the runtime/embed context (never a hardcoded literal).
setTokenProvider({ getToken: () => "local-dev-token" });

// Stub API client returning canned licensor UUIDs so lookups resolve offline.
// A few of these UUIDs exist in json/uuid's.json, so you get real matches.
const SAMPLE: Record<string, InternalApiTrackResponse> = {
  t1: { title: "Sample One", artist: "Artist A", licensorUuid: "a830a34f35844bd784eac9a7fb395996" }, // TuneCore
  t2: { title: "Sample Two", artist: "Artist B", licensor: { uuid: "18fbcef4fb624fc58d4a7fdd230bd523" } }, // DistroKid
  t3: { title: "Unknown Owner", licensorUuid: "deadbeefdeadbeefdeadbeefdeadbeef" }, // not in mapping -> unmatched
  t4: { title: "No Licensor Field" }, // -> licensor uuid missing
  t5: { licensorUuid: "60315a5bfaa04520a1ee142e2df5b8ca" }, // conflict (Downtown Music vs DashGO)
};

setInternalApiClient({
  async lookupTrack(id: TrackIdentifier) {
    const body = SAMPLE[id.value];
    if (!body) return { status: 404, body: { error: "not found" } as InternalApiTrackResponse };
    return { status: 200, body };
  },
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
createServer(new DistributorResolver()).listen(port, () => {
  console.log(`local dev server listening on http://127.0.0.1:${port}`);
  console.log("try:");
  console.log(`  curl http://127.0.0.1:${port}/health`);
  console.log(`  curl -X POST http://127.0.0.1:${port}/api/distributor-lookup -H "content-type: application/json" -d '{"trackId":"t1"}'`);
  console.log("  sample trackIds: t1 (TuneCore), t2 (DistroKid), t3 (unmatched), t4 (missing uuid), t5 (conflict)");
});
