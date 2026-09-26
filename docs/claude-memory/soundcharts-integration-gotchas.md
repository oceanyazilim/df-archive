---
name: soundcharts-integration-gotchas
description: "Soundcharts API quirks — streaming lives on the audience endpoint (cumulative), tokens are 15-min, and Next's fetch data cache must be bypassed with no-store"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41f05495-b7d6-4864-9563-fee94c54a47a
  modified: 2026-07-28T22:35:12.946Z
---

Findings from the 2026-07-29 debugging session (charts empty despite Soundcharts configured):

- **Streaming data endpoint**: on this plan, `/api/v2*/song/{uuid}/{platform}/stream` (all version variants) returns 404. The working endpoint is `/api/v2/song/{uuid}/audience/{platform}` → `items[{date, plots:[{identifier,value}]}]`. Values are **cumulative all-time stream totals** (newest-first); daily streams = day-over-day delta. `src/soundcharts/analytics.ts` fetches days+1 and diffs, clamping negatives to 0.
- **Next.js 14 fetch data cache poisoning**: Next's patched `fetch` persisted responses in `.next/cache/fetch-cache` — including the **OAuth token POST** (`account.soundcharts.com/oauth/token` and `accounts.spotify.com/api/token`). Soundcharts tokens expire in **900s (15 min)**, so a cached token response made every live call 401 (`SOUNDCHARTS_AUTH_FAILED`) forever, while some GETs "worked" from stale cached 200s. Fix: `cache: "no-store"` on every outbound fetch in `src/soundcharts/auth.ts`, `src/soundcharts/client.ts`, `src/spotify.ts`, `src/licensorApi.ts`. If auth mysteriously fails again, check/delete `.next/cache/fetch-cache`.
- **401 handling**: `soundchartsRequest` retries 401 with token refresh + backoff up to maxAttempts (not just once, and never back-to-back without delay).
- **Next dev route isolation**: each App Router route handler gets its own module graph in dev — module-level state (token cache, usage metrics, in-memory caches) is NOT shared across routes; `/api/usage` counters only reflect its own graph.

Related: [[distributor-resolution-architecture]]
