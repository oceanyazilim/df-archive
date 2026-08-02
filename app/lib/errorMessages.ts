/**
 * Maps the real error codes the API already returns (`{error:{code,message}}`)
 * to a specific, actionable title. The server-provided `message` is always
 * shown as-is — this only decides the heading and whether a retry makes
 * sense, so every failure reads as one of the app's named scenarios rather
 * than a generic "Something went wrong."
 */

export interface ErrorDescription {
  title: string;
  retryable: boolean;
}

const CODE_MAP: Record<string, ErrorDescription> = {
  NOT_FOUND: { title: "Private or unavailable content", retryable: false },
  SPOTIFY_FORBIDDEN: { title: "Private or unavailable content", retryable: false },
  SPOTIFY_RATE_LIMITED: { title: "Rate limit reached", retryable: true },
  SPOTIFY_BAD_REQUEST: { title: "Unsupported URL type", retryable: false },
  SPOTIFY_UNAVAILABLE: { title: "Spotify service unavailable", retryable: true },
  SPOTIFY_NOT_CONFIGURED: { title: "Spotify service unavailable", retryable: false },
  INVALID_KIND: { title: "Unsupported URL type", retryable: false },
  INVALID_LOOKUP_INPUT: { title: "Invalid Spotify URL", retryable: false },
  ANALYZER_FAILED: { title: "Metadata endpoint failure", retryable: true },
  SOUNDCHARTS_PLAN_RESTRICTED: { title: "Metadata endpoint failure", retryable: false },
  SOUNDCHARTS_NOT_FOUND: { title: "Private or unavailable content", retryable: false },
};

export function describeError(code: string | undefined, fallbackMessage: string): ErrorDescription & { message: string } {
  if (code && CODE_MAP[code]) return { ...CODE_MAP[code], message: fallbackMessage };
  if (/timed? out|timeout/i.test(fallbackMessage)) return { title: "Network timeout", retryable: true, message: fallbackMessage };
  if (/network|fetch failed|unreachable/i.test(fallbackMessage)) return { title: "Network timeout", retryable: true, message: fallbackMessage };
  if (/cancel/i.test(fallbackMessage)) return { title: "Analysis canceled", retryable: true, message: fallbackMessage };
  return { title: "Analysis failed", retryable: true, message: fallbackMessage };
}

/** An Error subclass that preserves the server's error code for describeError(). */
export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
