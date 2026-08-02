/**
 * Shared error types used to classify failures across the pipeline.
 * (InternalApiError lives in internalApi.ts; TokenMissingError in token.ts.)
 */

/** Thrown when the supplied identifier is structurally invalid (e.g. bad ISRC). */
export class InvalidIdentifierError extends Error {
  readonly code = "INVALID_TRACK_IDENTIFIER" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdentifierError";
  }
}
