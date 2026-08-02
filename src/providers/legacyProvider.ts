/**
 * Backward-compatible upstream provider that uses the injectable
 * {@link InternalApiClient} + {@link TokenProvider} (set via setInternalApiClient
 * / setTokenProvider). This preserves the original single-stage behavior for the
 * standalone library and its self-test.
 */

import { LicensorResolution, LicensorUuidProvider, TrackIdentifier } from "../types";
import { ResolverConfig } from "../config";
import { getInternalApiToken } from "../token";
import { queryTrackFromInternalApi } from "../internalApi";
import { extractLicensorUuid, extractTrackMetadata } from "../extractLicensorUuid";

export function createLegacyProvider(cfg: ResolverConfig): LicensorUuidProvider {
  return {
    async resolve(identifier: TrackIdentifier): Promise<LicensorResolution> {
      // Token acquisition may throw TokenMissingError -> classified by resolver.
      const token = await getInternalApiToken();
      const { status, body, attempts } = await queryTrackFromInternalApi(
        identifier,
        token,
        cfg
      );
      return {
        licensorUuid: extractLicensorUuid(body),
        metadata: extractTrackMetadata(body),
        httpStatus: status,
        attempts,
      };
    },
  };
}
