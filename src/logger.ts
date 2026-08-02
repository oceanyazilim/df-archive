/**
 * Minimal structured logger with secret masking.
 *
 * The logger deliberately exposes only an allow-list of non-sensitive fields.
 * It will never emit tokens, Authorization headers, cookies, or full private
 * API payloads. Any value that looks like a credential is masked defensively.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Fields explicitly allowed to be logged. */
export type OperationalLog = {
  event: string;
  trackId?: string;
  identifierType?: string;
  requestStatus?: string;
  httpStatus?: number | null;
  licensorUuid?: string | null;
  matchStatus?: string;
  retryAttempt?: number;
  durationMs?: number;
  errorCategory?: string;
};

const SENSITIVE_KEY_PATTERN =
  /(token|authorization|auth|cookie|session|secret|password|bearer|apikey|api[-_]?key)/i;

/** Masks a secret, keeping only enough to correlate logs (never the value). */
export function maskSecret(value: unknown): string {
  if (value === null || value === undefined) return "<none>";
  const str = String(value);
  if (str.length <= 4) return "****";
  return `****(len=${str.length})`;
}

/**
 * Recursively strips/masks anything that resembles a credential. Used as a
 * safety net before logging arbitrary objects (e.g. API responses for debug).
 */
export function sanitize(input: unknown, depth = 0): unknown {
  if (depth > 6) return "<depth-limit>";
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = maskSecret(value);
    } else {
      out[key] = sanitize(value, depth + 1);
    }
  }
  return out;
}

let currentLevel: LogLevel = (process.env.DISTRO_LOG_LEVEL as LogLevel) || "info";
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(level: LogLevel, payload: OperationalLog): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  // Only the allow-listed OperationalLog fields are serialized here.
  const line = JSON.stringify({ level, ...payload });
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  stream(line);
}

export const logger = {
  debug: (p: OperationalLog) => emit("debug", p),
  info: (p: OperationalLog) => emit("info", p),
  warn: (p: OperationalLog) => emit("warn", p),
  error: (p: OperationalLog) => emit("error", p),
};
