/**
 * Authorized API token retrieval.
 *
 * SECURITY CONTRACT:
 *   - The token is read from the host project's existing authorized runtime /
 *     embed context via an injected {@link TokenProvider}.
 *   - The token is NEVER hardcoded, printed, returned in API responses, written
 *     to the mapping file, or exposed to unrelated frontend components.
 *   - Only masked references (length only) are ever logged.
 *
 * Because this repository has no pre-existing token source, the host wires one
 * in via {@link setTokenProvider}. A default provider reads from a runtime
 * environment variable so nothing is hardcoded in source.
 */

import { TokenProvider } from "./types";
import { maskSecret, logger } from "./logger";

export class TokenMissingError extends Error {
  readonly code = "TOKEN_MISSING" as const;
  constructor(message = "Authorized API token is not available.") {
    super(message);
    this.name = "TokenMissingError";
  }
}

/**
 * Default provider: reads the token from a runtime environment variable set by
 * the authorized host. This keeps the token out of source control and code.
 * Replace it with a project-specific provider (embed context, secret manager,
 * etc.) via {@link setTokenProvider}.
 */
const environmentTokenProvider: TokenProvider = {
  getToken() {
    const token = process.env.INTERNAL_API_TOKEN;
    if (!token || token.trim().length === 0) {
      throw new TokenMissingError(
        "INTERNAL_API_TOKEN is not set. Register an authorized TokenProvider via setTokenProvider()."
      );
    }
    return token.trim();
  },
};

let activeProvider: TokenProvider = environmentTokenProvider;

/** Register the host project's authorized token provider. */
export function setTokenProvider(provider: TokenProvider): void {
  activeProvider = provider;
}

/**
 * Retrieve the authorized API token.
 *
 * @throws {TokenMissingError} when no token is available.
 */
export async function getInternalApiToken(): Promise<string> {
  const token = await activeProvider.getToken();
  if (typeof token !== "string" || token.trim().length === 0) {
    logger.error({ event: "token_missing", errorCategory: "TOKEN_MISSING" });
    throw new TokenMissingError();
  }
  // Only a masked reference is ever logged — never the token itself.
  logger.debug({ event: "token_acquired", matchStatus: maskSecret(token) });
  return token.trim();
}
