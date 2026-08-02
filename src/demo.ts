/**
 * Runnable demo showing how a host project wires the system together.
 *
 * It registers an authorized token provider and API client, then resolves a
 * couple of tracks. Replace the fake client/provider with your project's real
 * authorized implementations — nothing else changes.
 */

import {
  DistributorResolver,
  setInternalApiClient,
  setTokenProvider,
} from "./index";
import { InternalApiClient, TrackIdentifier } from "./types";

// 1. Provide the authorized token from your runtime/embed context.
//    Here we read a runtime env var; never hardcode a token.
setTokenProvider({
  getToken() {
    const token = process.env.INTERNAL_API_TOKEN;
    if (!token) throw new Error("Set INTERNAL_API_TOKEN or register a real provider.");
    return token;
  },
});

// 2. Provide the authorized internal API client. This example is a stub that
//    returns canned data so the demo runs offline. Swap for your real client.
const demoClient: InternalApiClient = {
  async lookupTrack(id: TrackIdentifier, _token: string) {
    const canned: Record<string, unknown> = {
      "demo-1": { title: "Demo Track", artist: "Demo Artist", licensorUuid: "18fbcef4fb624fc58d4a7fdd230bd523" }, // DistroKid
      "demo-2": { title: "Mystery", licensorUuid: "deadbeefdeadbeefdeadbeefdeadbeef" }, // not in mapping
    };
    const body = canned[id.value] as Record<string, unknown> | undefined;
    if (!body) return { status: 404, body: { error: "not found" } as Record<string, unknown> };
    return { status: 200, body };
  },
};
setInternalApiClient(demoClient);

async function main() {
  if (!process.env.INTERNAL_API_TOKEN) process.env.INTERNAL_API_TOKEN = "demo-token";
  const resolver = new DistributorResolver();

  const single = await resolver.resolveDistributorForTrack({ value: "demo-1", type: "trackId" });
  console.log("\nSingle lookup:\n", JSON.stringify(single, null, 2));

  const batch = await resolver.resolveDistributorsForTracks([
    { value: "demo-1" },
    { value: "demo-2" },
    { value: "demo-missing" },
  ]);
  console.log("\nBatch lookup:\n", JSON.stringify(batch, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
