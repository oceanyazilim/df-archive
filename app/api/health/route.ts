import { NextResponse } from "next/server";
import { spotifyCooldownInfo } from "@core/spotifyRateGuard";
import { spotifyPoolStatus } from "@core/spotifyAuth";
import { soundchartsPoolStatus } from "@core/soundcharts/auth";
import { uuidMappingStatus } from "@core/uuidResolver";
import {
  isSoundchartsConfigured,
  isBearerConfigured,
  isLegacyConfigured,
  isSpotifyFallbackConfigured,
  getSoundchartsConfig,
} from "@core/soundcharts/config";
import { connectorStatus } from "@core/connectorStore";
import { cacheMetrics } from "@core/soundcharts/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Comp = "operational" | "degraded" | "not_configured" | "plan_restricted" | "optional" | "failed";

/**
 * GET /api/health — unified, safe component status + environment validator.
 * Never returns client id/secret, api key, bearer token, authorization headers,
 * or env values. One optional provider missing never marks the app unavailable.
 */
export async function GET() {
  const cfg = getSoundchartsConfig();
  const soundchartsConfigured = isSoundchartsConfigured(cfg);
  const spotifyConfigured = isSpotifyFallbackConfigured();
  const uuid = uuidMappingStatus();
  const uuidMappingLoaded = uuid.loaded && uuid.validMappings > 0;
  const conn = connectorStatus();

  // Lookup is ready when the mapping loads AND at least one resolution source works.
  const lookupReady = uuidMappingLoaded && (spotifyConfigured || soundchartsConfigured);

  const components: Record<string, Comp> = {
    applicationBackend: "operational",
    spotifyApi: spotifyConfigured ? "operational" : "not_configured",
    soundchartsOAuth: cfg.useLegacyAuth ? "optional" : isBearerConfigured(cfg) ? "operational" : "not_configured",
    soundchartsCustomerApi: soundchartsConfigured ? "operational" : "not_configured",
    uuidMapping: uuidMappingLoaded ? "operational" : "degraded",
    distributorResolver: uuidMappingLoaded || soundchartsConfigured ? "operational" : "degraded",
    cache: "operational",
    lookupHistory: "operational",
    optionalSpotifyConnector: "optional",
  };

  return NextResponse.json({
    spotifyCooldown: spotifyCooldownInfo(),
    // Credential pools: counts and masked fingerprints only — never secrets.
    credentialPools: { spotify: spotifyPoolStatus(), soundcharts: soundchartsPoolStatus() },
    status: lookupReady ? "ok" : "degraded",
    // --- unified environment validator (safe booleans only) ---
    spotifyConfigured,
    soundchartsConfigured,
    uuidMappingLoaded,
    lookupReady,
    // --- component detail ---
    primaryLookupReady: lookupReady,
    legacyAuthActive: cfg.useLegacyAuth && isLegacyConfigured(cfg),
    components,
    uuidMappingCount: uuid.validMappings,
    uuidMappingConflicts: uuid.conflicts,
    spotifyFallbackEnabled: spotifyConfigured,
    optionalConnectorPaired: conn.paired,
    cacheHitRate: cacheMetrics.hits + cacheMetrics.misses > 0 ? Math.round((cacheMetrics.hits / (cacheMetrics.hits + cacheMetrics.misses)) * 100) : 0,
  });
}
