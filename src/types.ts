/**
 * Shared type definitions for the distributor identification system.
 */

/** Normalized internal representation of a single UUID -> distributor record. */
export type LicensorDistributorRecord = {
  uuid: string;
  distributor: string;
};

/** Supported track identifier kinds accepted by the intermediary service. */
export type TrackIdentifierType =
  | "spotify"
  | "trackId"
  | "platformTrackId"
  | "isrc"
  | "upc"
  | "releaseId";

/** A track lookup request coming from the application layer. */
export type TrackIdentifier = {
  /** The identifier value (e.g. an internal track id or an ISRC). */
  value: string;
  /** Which kind of identifier `value` is. Defaults to "trackId". */
  type?: TrackIdentifierType;
};

export type MatchStatus =
  | "matched"
  | "unmatched"
  | "unresolved";

export type RequestStatus = "success" | "failed";

export type ResolveErrorCode =
  | "INVALID_TRACK_IDENTIFIER"
  | "INTERNAL_API_ERROR"
  | "LICENSOR_UUID_MISSING"
  | "UUID_NOT_FOUND"
  | "UUID_MAPPING_CONFLICT"
  | "TOKEN_MISSING";

export type ResolveError = {
  code: ResolveErrorCode;
  message: string;
  /** Optional extra context, e.g. the conflicting distributor list. */
  details?: Record<string, unknown>;
};

/** The structured result returned for a single track. */
export type DistributorLookupResult = {
  success: boolean;
  trackId: string;
  identifierType: TrackIdentifierType;
  licensorUuid: string | null;
  distributor: string | null;
  matchStatus: MatchStatus;
  requestStatus: RequestStatus;
  error: ResolveError | null;
  /** Optional non-sensitive metadata surfaced from the API for display. */
  meta?: {
    title?: string | null;
    artist?: string | null;
    isrc?: string | null;
    upc?: string | null;
    releaseTitle?: string | null;
    label?: string | null;
    artworkUrl?: string | null;
    /** Spotify track id resolved from a URL/URI input (display/debug only). */
    spotifyTrackId?: string | null;
    httpStatus?: number | null;
    /** Number of API attempts made (including the successful one). */
    attempts?: number;
    /** Whether this result was served from the short-term cache. */
    cached?: boolean;
    /** Total processing time in milliseconds. */
    durationMs?: number;
  };
};

export type BatchSummary = {
  totalTracks: number;
  successfulApiRequests: number;
  matchedDistributors: number;
  unmatchedUuids: number;
  missingUuids: number;
  failedRequests: number;
};

export type BatchLookupResult = {
  summary: BatchSummary;
  results: DistributorLookupResult[];
};

/** A conflict discovered while loading the UUID mapping file. */
export type MappingConflict = {
  code: "UUID_MAPPING_CONFLICT";
  uuid: string;
  distributors: string[];
};

/** A non-fatal warning discovered while loading the UUID mapping file. */
export type MappingWarning = {
  code:
    | "DUPLICATE_UUID_SAME_DISTRIBUTOR"
    | "MISSING_UUID"
    | "MISSING_DISTRIBUTOR"
    | "INVALID_RECORD";
  message: string;
  uuid?: string;
  index?: number;
};

/** Result of loading + validating the mapping file. */
export type LoadedMapping = {
  /** normalized uuid -> distributor name */
  distributorByUuid: Map<string, string>;
  conflicts: MappingConflict[];
  warnings: MappingWarning[];
  /** Count of accepted, unique records (the usable lookup map size). */
  recordCount: number;
  /** Total raw records seen in the file (including duplicates/conflicts/invalid). */
  totalRecords: number;
};

/** The raw shape returned by the authorized internal API for one track. */
export type InternalApiTrackResponse = Record<string, unknown>;

/**
 * A client capable of performing the authorized internal API track lookup.
 * The concrete implementation is injected by the host project so this package
 * never hardcodes an endpoint, transport, or credential.
 */
export interface InternalApiClient {
  /**
   * Perform a single authorized track lookup.
   * Must throw an {@link InternalApiError} on failure so retry logic can decide
   * whether the failure is retryable.
   */
  lookupTrack(
    identifier: TrackIdentifier,
    token: string,
    signal: AbortSignal
  ): Promise<{ status: number; body: InternalApiTrackResponse }>;
}

/**
 * A provider that returns the authorized API token from the host runtime /
 * embed context. Never returns or logs the token elsewhere.
 */
export interface TokenProvider {
  getToken(): Promise<string> | string;
}

/** Non-sensitive display metadata surfaced from upstream services. */
export type TrackMetadataFields = {
  title: string | null;
  artist: string | null;
  isrc: string | null;
  upc: string | null;
  releaseTitle: string | null;
  label: string | null;
  artworkUrl: string | null;
};

/**
 * Result of the upstream resolution stage: given a track identifier, produce the
 * RAW (pre-normalization) licensor UUID plus non-sensitive metadata. How the
 * UUID is obtained (e.g. Spotify -> ISRC -> licensor API) is the provider's
 * concern; the distributor matching layer only consumes {@link licensorUuid}.
 */
export type LicensorResolution = {
  /** Raw licensor UUID from the authorized licensor API, or null if none. */
  licensorUuid: string | null;
  /** Non-sensitive metadata for display only (never used for matching). */
  metadata: TrackMetadataFields;
  /** HTTP status of the final upstream call, when applicable. */
  httpStatus: number | null;
  /** Total upstream attempts across all stages. */
  attempts: number;
  /** Spotify track id resolved from the input, when applicable. */
  spotifyTrackId?: string | null;
  /** ISRC resolved along the way, when applicable. */
  isrc?: string | null;
};

/**
 * Pluggable upstream provider. Implementations MUST throw a typed error
 * (TokenMissingError or InternalApiError) on failure so the resolver can
 * classify the outcome; a resolved object with `licensorUuid: null` means the
 * upstream succeeded but no licensor UUID was available.
 */
export interface LicensorUuidProvider {
  resolve(
    identifier: TrackIdentifier,
    signal?: AbortSignal
  ): Promise<LicensorResolution>;
}
