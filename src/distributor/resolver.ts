/**
 * Distributor resolver — SINGLE authoritative source: the canonical licensor
 * UUID mapping (json/uuid's.json).
 *
 * The distributor is resolved ONLY from a real licensor UUID (supplied by the
 * Spotify system — the track catalog / captured licensor identifier) that is
 * exact-matched against the canonical mapping. The stored name is returned
 * verbatim — never re-cased, shortened, translated, aliased, or fuzzy-matched.
 *
 * Soundcharts is NOT a distributor source and never enters this resolver.
 * Album label, ISRC/UPC prefixes, copyright, artist history, and other album
 * tracks are NEVER used to infer a distributor.
 *
 * Failures are DISTINCT (never collapsed into a generic "unresolved"):
 *   - uuid_unavailable : no licensor UUID for this track yet
 *   - invalid_uuid     : a value was supplied but is not a valid 32-hex UUID
 *   - uuid_not_mapped  : valid UUID, but not present in the canonical mapping
 *   - conflict         : the mapping assigns >1 name to this UUID (data issue)
 *   - verified         : exact match — a real distributor name
 */

import { resolveDistributorByUuid } from "./uuid";

export type DistributorStatus =
  | "verified"
  | "uuid_not_mapped"
  | "uuid_unavailable"
  | "invalid_uuid"
  | "conflict";

export type DistributorResolution = {
  /** Exact stored name from the canonical mapping, or null. */
  name: string | null;
  /** Normalized 32-hex licensor UUID (present for verified / not_mapped / conflict). */
  uuid: string | null;
  status: DistributorStatus;
};

/**
 * Resolve a distributor from a licensor UUID and nothing else.
 * See DistributorStatus for the distinct outcomes.
 */
export function resolveDistributorByLicensorUuid(rawUuid: unknown): DistributorResolution {
  // No licensor UUID captured for this track yet.
  if (rawUuid === null || rawUuid === undefined || String(rawUuid).trim() === "") {
    return { name: null, uuid: null, status: "uuid_unavailable" };
  }

  const r = resolveDistributorByUuid(rawUuid);
  if (r.matchType === "invalid") return { name: null, uuid: null, status: "invalid_uuid" };
  if (r.matchType === "conflict") return { name: null, uuid: r.normalizedUuid, status: "conflict" };
  if (r.matched && r.name) return { name: r.name, uuid: r.normalizedUuid, status: "verified" };
  // Valid 32-hex UUID, but not present in the canonical mapping.
  return { name: null, uuid: r.normalizedUuid, status: "uuid_not_mapped" };
}

export type ResolverInputs = {
  /** ONLY a licensor UUID may determine the distributor. */
  licensorUuid?: string | null;
};

/** Workspace-facing wrapper — takes only the track's own licensor UUID. */
export function resolveDistributor(inputs: ResolverInputs): DistributorResolution {
  return resolveDistributorByLicensorUuid(inputs.licensorUuid ?? null);
}
