/**
 * Typed, safe error codes for the Soundcharts + lookup pipeline. Messages are
 * user-safe (no stack traces, no credentials). HTTP status maps to a code.
 */

export type SafeErrorCode =
  | "SOUNDCHARTS_NOT_CONFIGURED"
  | "SOUNDCHARTS_AUTH_FAILED"
  | "SOUNDCHARTS_PLAN_RESTRICTED"
  | "SOUNDCHARTS_RATE_LIMITED"
  | "SOUNDCHARTS_QUOTA_EXCEEDED"
  | "SOUNDCHARTS_NOT_FOUND"
  | "SOUNDCHARTS_IDENTIFIER_AMBIGUOUS"
  | "SOUNDCHARTS_TIMEOUT"
  | "SOUNDCHARTS_INVALID_RESPONSE"
  | "SPOTIFY_NOT_CONFIGURED"
  | "SPOTIFY_NOT_FOUND"
  | "UUID_MAPPING_NOT_LOADED"
  | "UUID_NOT_FOUND"
  | "UUID_MAPPING_CONFLICT"
  | "INVALID_LOOKUP_INPUT"
  | "INTERNAL_SERVER_ERROR";

export class SoundchartsError extends Error {
  readonly code: SafeErrorCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  constructor(code: SafeErrorCode, message: string, opts: { httpStatus?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {}) {
    super(message);
    this.name = "SoundchartsError";
    this.code = code;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
  toSafeJSON() {
    return { code: this.code, message: this.message, httpStatus: this.httpStatus };
  }
}

const MESSAGES: Record<number, { code: SafeErrorCode; message: string; retryable: boolean }> = {
  401: { code: "SOUNDCHARTS_AUTH_FAILED", message: "Soundcharts authentication failed.", retryable: false },
  403: { code: "SOUNDCHARTS_PLAN_RESTRICTED", message: "This Soundcharts endpoint is not included in the current API plan.", retryable: false },
  404: { code: "SOUNDCHARTS_NOT_FOUND", message: "Song is not currently available in Soundcharts.", retryable: false },
  410: { code: "SOUNDCHARTS_IDENTIFIER_AMBIGUOUS", message: "This identifier is ambiguous or blacklisted in Soundcharts.", retryable: false },
  429: { code: "SOUNDCHARTS_RATE_LIMITED", message: "Soundcharts rate limit reached. Please retry shortly.", retryable: true },
};

export function errorForStatus(status: number, retryAfterMs: number | null = null): SoundchartsError {
  const known = MESSAGES[status];
  if (known) return new SoundchartsError(known.code, known.message, { httpStatus: status, retryable: known.retryable, retryAfterMs });
  if (status === 402) return new SoundchartsError("SOUNDCHARTS_QUOTA_EXCEEDED", "Soundcharts billing quota exceeded.", { httpStatus: status });
  if (status >= 500) return new SoundchartsError("SOUNDCHARTS_INVALID_RESPONSE", `Soundcharts returned a server error (HTTP ${status}).`, { httpStatus: status, retryable: true });
  return new SoundchartsError("SOUNDCHARTS_INVALID_RESPONSE", `Unexpected Soundcharts response (HTTP ${status}).`, { httpStatus: status });
}
