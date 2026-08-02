/**
 * Public entry point for the distributor identification system.
 * Re-exports the pieces a host project wires together.
 */

export * from "./types";
export { defaultResolverConfig, UUID_MAPPING_PATH } from "./config";
export type { ResolverConfig } from "./config";
export { normalizeUuid } from "./normalizeUuid";
export {
  loadUuidMapping,
  buildMappingFromJson,
  findDistributorByUuid,
  findConflictByUuid,
  clearMappingCache,
  toRecordList,
} from "./uuidMapping";
export { getInternalApiToken, setTokenProvider, TokenMissingError } from "./token";
export { InvalidIdentifierError } from "./errors";
export {
  queryTrackFromInternalApi,
  setInternalApiClient,
  getInternalApiClient,
  InternalApiError,
} from "./internalApi";
export {
  extractLicensorUuid,
  extractTrackMetadata,
  extractDisplayMeta,
} from "./extractLicensorUuid";
export type { TrackMetadata } from "./extractLicensorUuid";
export { LookupCache } from "./cache";
export { runWithConcurrency } from "./pool";
export {
  DistributorResolver,
  normalizeIdentifier,
} from "./distributorResolver";
export type { ResolverOptions } from "./distributorResolver";
export { logger, setLogLevel, maskSecret, sanitize } from "./logger";
export { executeWithRetry } from "./retry";
export {
  parseSpotifyTrackId,
  getSpotifyAccessToken,
  getSpotifyTrack,
  extractIsrc,
  extractSpotifyMetadata,
  extractLicensorUuidFromSpotifyMetadata,
  clearSpotifyTokenCache,
} from "./spotify";
export { lookupLicensorByIsrc, getLicensorApiToken } from "./licensorApi";
export { createSpotifyLicensorProvider } from "./providers/spotifyLicensorProvider";
export { createLegacyProvider } from "./providers/legacyProvider";
export { demoProvider } from "./providers/demoProvider";
export { toPanelResult, summarize as summarizePanel } from "./apiAdapter";
export type { PanelResult, PanelSummary, PanelMatchStatus } from "./apiAdapter";
export {
  resolveUuid,
  resolveUuidBatch,
  reloadUuidMapping,
  uuidMappingStatus,
} from "./uuidResolver";
export type {
  UuidLookupResult,
  UuidBatchResult,
  UuidBatchSummary,
  UuidMatchStatus,
} from "./uuidResolver";
export {
  loadTrackCatalog,
  buildTrackCatalogFromJson,
  findUuidForTrack,
  trackCatalogStatus,
  isTrackCatalogAvailable,
  normalizeSpotifyTrackId,
  normalizeIsrc,
} from "./trackMapping";
export type { TrackCatalog } from "./trackMapping";
export {
  resolveDistributorForSpotifyTrack,
  resolveDistributorsForSpotifyTracks,
} from "./spotifyTrackResolver";
export { parseMusicLookupInput, extractSpotifyAlbumId } from "./validation/musicInput";
export type { MusicInputType, ParsedMusicInput } from "./validation/musicInput";
export { resolveAlbum, buildAlbumRelease } from "./album/service";
export type { AlbumRelease, AlbumTrack } from "./album/service";
export { resolveDistributor, resolveDistributorByLicensorUuid } from "./distributor/resolver";
export type { DistributorResolution, DistributorStatus } from "./distributor/resolver";
// Canonical distributor mapping loader (server-side): validates, normalizes,
// detects duplicates/conflicts, and caches a Map by normalized UUID.
export { loadUuidMapping as loadDistributorMapping } from "./uuidMapping";
export type { TrackResolution, TrackResolutionStatus } from "./spotifyTrackResolver";
export {
  parseSpotifyExtendedMetadata,
  validateSanitizedPayload,
  normalizeLicensorUuid,
  extractSpotifyTrackId,
  parseMetadataRequestUrl,
  LIMITS,
} from "./spotifyMetadata";
export type { SanitizedSpotifyMetadata } from "./spotifyMetadata";
