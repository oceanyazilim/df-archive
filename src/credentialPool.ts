/**
 * Credential pool with automatic failover.
 *
 * A single API app is a single point of failure: one burst of work can get it
 * rate-limited for hours and take every dependent feature down with it. This
 * module keeps several interchangeable credentials and moves to the next one
 * the moment the current one is throttled or rejected, so the system degrades
 * one slot at a time instead of all at once.
 *
 * Rules:
 *   - 429 (or any provider-reported cooldown) parks that slot until its
 *     Retry-After elapses; the next healthy slot serves the very next call.
 *   - 401/403 disables the slot for the life of the process (bad credentials
 *     do not fix themselves) and is reported so it can be corrected.
 *   - When every slot is parked, callers get the shortest remaining wait, not
 *     a vague error.
 *
 * SECURITY: only slot labels and masked fingerprints ever leave this module.
 * Secrets are never logged, returned in API responses, or written to disk.
 */

import { logger } from "./logger";

export type Credential = {
  id: string;
  secret: string;
  extra?: Record<string, string>;
  /**
   * An optional secondary credential for the same account (e.g. Soundcharts'
   * legacy App ID + token). It is loaded and validated alongside the modern
   * pair but kept separate: its presence or absence never affects the modern
   * credential's usability.
   */
  legacy?: { id: string; secret: string } | null;
  /** Why the legacy pair is unusable, when it is. */
  legacyIssue?: string | null;
};

/** A slot that could not be loaded — surfaced instead of silently skipped. */
export type CredentialIssue = {
  slot: number;
  /** "missing_secret" | "missing_id" | "duplicate_id" */
  reason: string;
  /** Safe, secret-free explanation. */
  message: string;
};

export type LoadedCredentials = { credentials: Credential[]; issues: CredentialIssue[] };

export type SlotStatus = {
  /** Human-safe name: "1", "2", … — never the credential itself. */
  label: string;
  /** Masked client id, e.g. "956b…a52c5" — enough to tell slots apart. */
  fingerprint: string;
  /** Last 4 characters of the secret. Never more than that. */
  secretFingerprint: string;
  state: "available" | "active" | "cooling" | "disabled" | "invalid";
  cooldownRemainingMs: number;
  cooldownEndsAt: string | null;
  disabledReason: string | null;
  requests: number;
  failovers: number;
  lastUsedAt: string | null;
  lastErrorCode: string | null;
  /** When this slot's cached token expires, if it holds one. */
  tokenExpiresAt: string | null;
  /** Free-form, non-secret account label (team id, app name…). */
  account: string | null;
  /** Secondary credential health, when the provider has one. */
  legacy: { present: boolean; fingerprint: string; secretFingerprint: string; issue: string | null } | null;
};

export type PoolStatus = {
  provider: string;
  total: number;
  available: number;
  cooling: number;
  disabled: number;
  invalid: number;
  /** Slots whose secondary (legacy) credential is usable. */
  legacyAvailable: number;
  /** ms until at least one slot is usable again; 0 when one is usable now. */
  recoversInMs: number;
  slots: SlotStatus[];
  /** Slots that could not be loaded at all, with secret-free reasons. */
  issues: CredentialIssue[];
};

type Slot = {
  label: string;
  credential: Credential;
  cooldownUntil: number;
  disabledReason: string | null;
  requests: number;
  failovers: number;
  lastUsedAt: number | null;
  lastErrorCode: string | null;
  /** Provider-specific cached token, owned per slot (never shared). */
  token: { value: string; expiresAt: number } | null;
  inflight: Promise<string> | null;
  /** One free token refresh per 401 before the slot is judged. */
  refreshedForAuthError: boolean;
};

/** Masked id: enough of the head and tail to identify a slot, never the middle. */
function fingerprint(id: string): string {
  if (!id) return "—";
  if (id.length <= 9) return id.slice(0, 2) + "…" + id.slice(-2);
  return id.slice(0, 4) + "…" + id.slice(-4);
}

/**
 * Only ever the last 4 characters of a secret — and nothing at all when the
 * secret is short enough that 4 characters would reveal most of it.
 */
function secretFingerprint(secret: string): string {
  if (!secret) return "—";
  if (secret.length < 12) return "••••";
  return "…" + secret.slice(-4);
}

function envValue(...names: string[]): string {
  for (const n of names) {
    const v = (process.env[n] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export type LoaderOptions = {
  /** Extra per-slot fields, e.g. { teamId: "SOUNDCHARTS_TEAM_ID" }. Falls back to the unsuffixed value. */
  extraVars?: Record<string, string>;
  /**
   * Optional secondary credential pair, e.g. Soundcharts legacy auth. Each side
   * accepts several env names so a project's existing naming keeps working
   * alongside a newer one.
   */
  legacyVars?: { idVars: string[]; secretVars: string[] };
  maxSlots?: number;
};

/**
 * Read numbered credentials from the environment.
 *
 * Slot 1 is the unsuffixed pair (so existing setups keep working); further
 * slots use `_2`, `_3`, … A completely empty slot is not an error, but a
 * HALF-filled one is reported as an issue rather than silently ignored — a
 * typo in a backup key should be visible, not invisible.
 */
export function loadCredentialsFromEnv(
  idVar: string,
  secretVar: string,
  opts: LoaderOptions = {}
): LoadedCredentials {
  const { extraVars = {}, legacyVars, maxSlots = 10 } = opts;
  const credentials: Credential[] = [];
  const issues: CredentialIssue[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i <= maxSlots; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const id = (process.env[idVar + suffix] ?? "").trim();
    const secret = (process.env[secretVar + suffix] ?? "").trim();

    if (!id && !secret) continue;                       // empty slot: fine
    if (!id) { issues.push({ slot: i, reason: "missing_id", message: `Slot ${i} has a secret but no ${idVar}${suffix}.` }); continue; }
    if (!secret) { issues.push({ slot: i, reason: "missing_secret", message: `Slot ${i} has an id but no ${secretVar}${suffix}.` }); continue; }
    const dupOf = seen.get(id);
    if (dupOf) { issues.push({ slot: i, reason: "duplicate_id", message: `Slot ${i} repeats the client id already used by slot ${dupOf}.` }); continue; }
    seen.set(id, i);

    const extra: Record<string, string> = {};
    for (const [key, envName] of Object.entries(extraVars)) {
      const v = envValue(envName + suffix, envName); // per-slot, else shared
      if (v) extra[key] = v;
    }

    // Secondary (legacy) pair: optional, independently validated. A missing or
    // half-filled legacy pair NEVER invalidates the modern credential.
    let legacy: { id: string; secret: string } | null = null;
    let legacyIssue: string | null = null;
    if (legacyVars) {
      const lid = envValue(...legacyVars.idVars.map((n) => n + suffix));
      const lsecret = envValue(...legacyVars.secretVars.map((n) => n + suffix));
      if (lid && lsecret) legacy = { id: lid, secret: lsecret };
      else if (lid || lsecret) legacyIssue = lid ? "missing legacy token" : "missing legacy app id";
      else legacyIssue = "not configured";
    }

    credentials.push({ id, secret, extra, legacy, legacyIssue });
  }
  return { credentials, issues };
}

/** Backwards-compatible wrapper that returns only the usable credentials. */
export function readCredentialsFromEnv(
  idVar: string,
  secretVar: string,
  extraVars: Record<string, string> = {},
  maxSlots = 10
): Credential[] {
  return loadCredentialsFromEnv(idVar, secretVar, { extraVars, maxSlots }).credentials;
}

export class CredentialPool {
  private slots: Slot[] = [];
  private cursor = 0;

  private issues: CredentialIssue[] = [];

  constructor(readonly provider: string, credentials: Credential[] | LoadedCredentials) {
    this.replace(credentials);
  }

  /** Swap the credential set (used at startup and by tests). */
  replace(input: Credential[] | LoadedCredentials): void {
    const loaded: LoadedCredentials = Array.isArray(input) ? { credentials: input, issues: [] } : input;
    this.issues = loaded.issues;
    this.slots = loaded.credentials.map((credential, i) => ({
      label: String(i + 1),
      credential,
      cooldownUntil: 0,
      disabledReason: null,
      requests: 0,
      failovers: 0,
      lastUsedAt: null,
      lastErrorCode: null,
      token: null,
      inflight: null,
      refreshedForAuthError: false,
    }));
    this.cursor = 0;
    for (const issue of this.issues) {
      logger.warn({ event: "credential_slot_invalid", errorCategory: issue.reason, matchStatus: `${this.provider}:slot=${issue.slot}` });
    }
  }

  get size(): number { return this.slots.length; }
  get configured(): boolean { return this.slots.length > 0; }

  /**
   * The slot that should serve the next request, or null when every slot is
   * parked or disabled. Round-robins so load spreads instead of hammering one.
   */
  private pick(): Slot | null {
    const now = Date.now();
    for (let n = 0; n < this.slots.length; n++) {
      const slot = this.slots[(this.cursor + n) % this.slots.length];
      if (slot.disabledReason) continue;
      if (slot.cooldownUntil > now) continue;
      this.cursor = (this.cursor + n) % this.slots.length;
      return slot;
    }
    return null;
  }

  /** ms until the earliest slot becomes usable; Infinity if none ever will. */
  recoversInMs(): number {
    const now = Date.now();
    let best = Infinity;
    for (const s of this.slots) {
      if (s.disabledReason) continue;
      best = Math.min(best, Math.max(0, s.cooldownUntil - now));
    }
    return best;
  }

  /**
   * Run `fn` with a healthy credential, retrying on the next slot whenever the
   * current one reports a cooldown or bad credentials.
   *
   * `fn` receives a handle it can use to fetch/cache a token for THAT slot and
   * to report outcomes. It must call `handle.rateLimited()` / `handle.rejected()`
   * so the pool can react — the pool never inspects provider responses itself.
   */
  async run<T>(fn: (handle: SlotHandle) => Promise<T>): Promise<T> {
    if (!this.configured) throw new PoolUnavailableError(this.provider, 0, "not_configured");

    const attempted = new Set<string>();
    let retryOnce: string | null = null;
    for (;;) {
      const slot = this.pick();
      // `retryOnce` lets a slot have one more go (token refresh) without being
      // treated as already-attempted.
      if (slot && retryOnce === slot.label) { retryOnce = null; }
      else if (!slot || attempted.has(slot.label)) {
        const wait = this.recoversInMs();
        throw new PoolUnavailableError(this.provider, Number.isFinite(wait) ? wait : 0, Number.isFinite(wait) ? "all_cooling" : "all_disabled");
      }
      attempted.add(slot.label);
      slot.requests++;
      slot.lastUsedAt = Date.now();

      const handle = new SlotHandle(this, slot);
      try {
        const result = await fn(handle);
        slot.lastErrorCode = null;
        slot.refreshedForAuthError = false;
        return result;
      } catch (err) {
        if (handle.failoverReason) slot.lastErrorCode = handle.failoverReason;
        // The handle records why; if it is retryable on another slot, loop.
        if (handle.shouldFailover && this.pick()) {
          slot.failovers++;
          logger.warn({
            event: "credential_failover",
            errorCategory: handle.failoverReason ?? "unknown",
            matchStatus: `${this.provider}:slot=${slot.label};fp=${fingerprint(slot.credential.id)}`,
          });
          continue;
        }
        // Same slot, one more go: an expired token is worth exactly one refresh.
        if (handle.retrySameSlot) { retryOnce = slot.label; continue; }
        throw err;
      }
    }
  }

  /** Park a slot for `ms` (called through the handle). */
  cool(slot: Slot, ms: number, reason: string): void {
    const capped = Math.min(Math.max(ms, 1000), 24 * 3600 * 1000);
    slot.cooldownUntil = Math.max(slot.cooldownUntil, Date.now() + capped);
    slot.token = null;
    logger.warn({
      event: "credential_cooldown",
      errorCategory: reason,
      durationMs: capped,
      matchStatus: `${this.provider}:slot=${slot.label};fp=${fingerprint(slot.credential.id)}`,
    });
  }

  /** Permanently disable a slot for this process. */
  disable(slot: Slot, reason: string): void {
    slot.disabledReason = reason;
    slot.token = null;
    logger.error({
      event: "credential_disabled",
      errorCategory: reason,
      matchStatus: `${this.provider}:slot=${slot.label};fp=${fingerprint(slot.credential.id)}`,
    });
  }

  status(): PoolStatus {
    const now = Date.now();
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    const slots: SlotStatus[] = this.slots.map((s) => ({
      label: s.label,
      fingerprint: fingerprint(s.credential.id),
      secretFingerprint: secretFingerprint(s.credential.secret),
      state: s.disabledReason ? "disabled" : s.cooldownUntil > now ? "cooling" : "available",
      cooldownRemainingMs: Math.max(0, s.cooldownUntil - now),
      cooldownEndsAt: s.cooldownUntil > now ? iso(s.cooldownUntil) : null,
      disabledReason: s.disabledReason,
      requests: s.requests,
      failovers: s.failovers,
      lastUsedAt: iso(s.lastUsedAt),
      lastErrorCode: s.lastErrorCode,
      tokenExpiresAt: s.token ? iso(s.token.expiresAt) : null,
      account: s.credential.extra?.teamId ?? s.credential.extra?.account ?? null,
      legacy: s.credential.legacy || s.credential.legacyIssue
        ? {
            present: !!s.credential.legacy,
            fingerprint: s.credential.legacy ? fingerprint(s.credential.legacy.id) : "\u2014",
            secretFingerprint: s.credential.legacy ? secretFingerprint(s.credential.legacy.secret) : "\u2014",
            issue: s.credential.legacy ? null : s.credential.legacyIssue ?? null,
          }
        : null,
    }));
    const recovers = this.recoversInMs();
    return {
      provider: this.provider,
      total: slots.length,
      available: slots.filter((s) => s.state === "available").length,
      cooling: slots.filter((s) => s.state === "cooling").length,
      disabled: slots.filter((s) => s.state === "disabled").length,
      invalid: this.issues.length,
      legacyAvailable: slots.filter((s) => s.legacy?.present).length,
      recoversInMs: Number.isFinite(recovers) ? recovers : 0,
      slots,
      issues: this.issues,
    };
  }

  /** For tests: clear all cooldowns and re-enable every slot. */
  reset(): void {
    for (const s of this.slots) {
      s.cooldownUntil = 0; s.disabledReason = null; s.token = null; s.requests = 0;
      s.failovers = 0; s.lastUsedAt = null; s.lastErrorCode = null; s.refreshedForAuthError = false;
    }
    this.cursor = 0;
  }

  /** The legacy (secondary) credential for a slot, if it loaded cleanly. */
  legacyCredentialFor(label: string): { id: string; secret: string } | null {
    return this.slots.find((s) => s.label === label)?.credential.legacy ?? null;
  }

  /** Every usable legacy credential, in slot order. */
  legacyCredentials(): { label: string; id: string; secret: string }[] {
    return this.slots
      .filter((s) => s.credential.legacy)
      .map((s) => ({ label: s.label, id: s.credential.legacy!.id, secret: s.credential.legacy!.secret }));
  }
}

/** What a caller may do with the slot it was handed. */
export class SlotHandle {
  shouldFailover = false;
  /** Set when the same slot deserves one more attempt (token refresh). */
  retrySameSlot = false;
  failoverReason: string | null = null;

  constructor(private readonly pool: CredentialPool, private readonly slot: Slot) {}

  /**
   * The provider answered 401/403 for a request made with this slot's token.
   *
   * A token can simply have expired mid-flight, so the first occurrence drops
   * the cached token and retries the SAME slot once. Only a second failure is
   * treated as bad credentials and disables the slot.
   */
  authFailure(reason = "auth_failed"): void {
    if (!this.slot.refreshedForAuthError) {
      this.slot.refreshedForAuthError = true;
      this.slot.token = null;
      this.retrySameSlot = true;
      this.failoverReason = "token_refresh";
      return;
    }
    this.rejected(reason);
  }

  get credential(): Credential { return this.slot.credential; }
  get label(): string { return this.slot.label; }

  /** Cached token for THIS slot, or null. */
  cachedToken(safetyMs = 5000): string | null {
    const t = this.slot.token;
    return t && t.expiresAt > Date.now() + safetyMs ? t.value : null;
  }

  setToken(value: string, ttlMs: number): void {
    this.slot.token = { value, expiresAt: Date.now() + ttlMs };
  }

  /** Single-flight token acquisition per slot. */
  async withToken(load: () => Promise<{ token: string; ttlMs: number }>): Promise<string> {
    const cached = this.cachedToken();
    if (cached) return cached;
    if (this.slot.inflight) return this.slot.inflight;
    this.slot.inflight = (async () => {
      const { token, ttlMs } = await load();
      this.setToken(token, ttlMs);
      return token;
    })().finally(() => { this.slot.inflight = null; });
    return this.slot.inflight;
  }

  /** The provider throttled this credential; park it and try the next one. */
  rateLimited(retryAfterSeconds: number | null | undefined): void {
    const sec = Number.isFinite(retryAfterSeconds) && (retryAfterSeconds as number) > 0 ? (retryAfterSeconds as number) : 60;
    this.pool.cool(this.slot, sec * 1000, "rate_limited");
    this.shouldFailover = true;
    this.failoverReason = "http_429";
  }

  /** The provider rejected these credentials; disable and try the next one. */
  rejected(reason = "auth_failed"): void {
    this.pool.disable(this.slot, reason);
    this.shouldFailover = true;
    this.failoverReason = reason;
  }
}

export class PoolUnavailableError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(readonly provider: string, readonly remainingMs: number, readonly reason: "all_cooling" | "all_disabled" | "not_configured") {
    super(
      reason === "not_configured"
        ? `${provider} credentials are not configured.`
        : reason === "all_disabled"
          ? `Every ${provider} credential was rejected. Check the configured keys.`
          : `All ${provider} credentials are rate-limited. The next one frees up in about ${formatWait(remainingMs)}.`
    );
    this.name = "PoolUnavailableError";
    this.code = reason === "not_configured" ? `${provider.toUpperCase()}_NOT_CONFIGURED` : `${provider.toUpperCase()}_RATE_LIMITED`;
    this.httpStatus = reason === "not_configured" ? 503 : 429;
  }
}

export function formatWait(ms: number): string {
  const min = Math.ceil(ms / 60000);
  if (min < 1) return "less than a minute";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
}
