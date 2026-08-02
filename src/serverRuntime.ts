/**
 * Server-side runtime wiring for the Next.js panel.
 *
 * Selects the upstream provider based on environment configuration and exposes
 * a shared {@link DistributorResolver}. Runs on the server only.
 *
 *   DEMO_MODE=true  -> demoProvider (mock Spotify + licensor, no network)
 *   otherwise       -> Spotify Web API -> ISRC -> authorized licensor API
 */

import { DistributorResolver } from "./distributorResolver";
import {
  DEMO_MODE,
  UUID_MAPPING_PATH,
  defaultResolverConfig,
  isLicensorConfigured,
  isSpotifyConfigured,
} from "./config";
import { createSpotifyLicensorProvider } from "./providers/spotifyLicensorProvider";
import { demoProvider } from "./providers/demoProvider";
import { loadUuidMapping } from "./uuidMapping";
import { logger } from "./logger";

let resolver: DistributorResolver | null = null;

function initRuntime(): DistributorResolver {
  const config = defaultResolverConfig();
  if (DEMO_MODE) {
    logger.info({ event: "runtime_init", matchStatus: "demo" });
    return new DistributorResolver({ provider: demoProvider });
  }
  logger.info({ event: "runtime_init", matchStatus: "live" });
  return new DistributorResolver({
    provider: createSpotifyLicensorProvider(config),
  });
}

/** Get the process-wide resolver, initializing runtime wiring on first use. */
export function getResolver(): DistributorResolver {
  if (!resolver) resolver = initRuntime();
  return resolver;
}

/** Force a reload of the resolver + mapping (used by the refresh endpoint). */
export function refreshRuntime(): DistributorResolver {
  resolver = initRuntime();
  return resolver;
}

/**
 * Non-sensitive runtime status for the health endpoint. Every field is derived
 * from actual configuration + mapping load — nothing is hardcoded, and no URL,
 * id, token, or secret is exposed.
 *
 * Statuses are reported SEPARATELY so a configured Spotify API can never make
 * the licensor API appear configured. Distributor resolution is ready only when
 * the licensor API is configured (or demo mode) AND the UUID mapping loaded.
 * Spotify is optional — needed only to turn a Spotify link into an ISRC.
 */
export function runtimeStatus() {
  let mappingCount = 0;
  let mappingLoaded = false;
  let conflicts = 0;
  let warnings = 0;
  try {
    const mapping = loadUuidMapping(UUID_MAPPING_PATH);
    mappingCount = mapping.recordCount;
    mappingLoaded = mapping.recordCount > 0;
    conflicts = mapping.conflicts.length;
    warnings = mapping.warnings.length;
  } catch {
    mappingLoaded = false;
  }

  const spotifyApiConfigured = DEMO_MODE || isSpotifyConfigured();
  const licensorApiConfigured = DEMO_MODE || isLicensorConfigured();

  return {
    demoMode: DEMO_MODE,
    spotifyApiConfigured,
    licensorApiConfigured,
    uuidMappingLoaded: mappingLoaded,
    uuidMappingCount: mappingCount,
    distributorResolutionReady: licensorApiConfigured && mappingLoaded,
    conflicts,
    warnings,
  };
}
