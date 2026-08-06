/**
 * License client — the app half of the Virus Records key system.
 *
 * The app is unusable until a key issued from the panel activates it. This
 * module owns the local license file, talks to the panel, and answers one
 * question for the rest of the server: is this installation allowed to run?
 *
 * Design decisions worth knowing:
 *
 *   • The device id is random and local. It identifies the installation to the
 *     panel; it is not derived from hardware, so it carries nothing about the
 *     machine beyond a name the user can see.
 *   • Check-ins are periodic, not per-request: a revoked key stops the app at
 *     its next heartbeat, not mid-click.
 *   • An unreachable panel must never lock a paying user out. A successful
 *     check buys OFFLINE_GRACE_MS of continued use; only a definitive refusal
 *     from the panel (revoked / expired / blocked) locks immediately.
 *   • The token is stored in a 0600 file and never leaves this module —
 *     no API route returns it.
 */

import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "../logger";

const LICENSE_PATH =
  process.env.DISTRO_LICENSE_PATH ?? path.join(process.cwd(), ".data", "license.json");

/** Where keys are issued and validated. Overridable for testing. */
export function licenseServer(): string {
  return (process.env.OCEAN_LICENSE_SERVER ?? "https://distro.virusrecord.com").replace(/\/+$/, "");
}

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

type Stored = {
  deviceId: string;
  token: string | null;
  keyMasked: string | null;
  type: "single" | "duration" | "unlimited" | null;
  note: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  /** Last time the panel confirmed the license. */
  lastOkAt: number | null;
  /** Set when the panel definitively refused; cleared on a successful activate. */
  lockedReason: string | null;
  lockedCode: string | null;
  /** Spotify identity already reported, so we don't re-send on every link. */
  reportedSpotifyId: string | null;
};

let cache: Stored | null = null;

function blank(): Stored {
  return {
    deviceId: randomUUID(),
    token: null, keyMasked: null, type: null, note: null,
    activatedAt: null, expiresAt: null, lastOkAt: null,
    lockedReason: null, lockedCode: null, reportedSpotifyId: null,
  };
}

function load(): Stored {
  if (cache) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(LICENSE_PATH, "utf8")) as Partial<Stored>;
    cache = { ...blank(), ...j, deviceId: typeof j.deviceId === "string" && j.deviceId ? j.deviceId : randomUUID() };
  } catch {
    cache = blank(); // first run
  }
  persist();
  return cache;
}

function persist(): void {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(LICENSE_PATH), { recursive: true });
    fs.writeFileSync(LICENSE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch (err) {
    logger.warn({ event: "license_persist_failed", matchStatus: (err as Error).message });
  }
}

function maskKey(key: string): string {
  const norm = key.trim().toUpperCase();
  // VR-ABCD-EFGH-IJKL → VR-ABCD-••••-IJKL: enough to recognise, not enough to reuse.
  const parts = norm.split("-");
  if (parts.length === 4) return `${parts[0]}-${parts[1]}-••••-${parts[3]}`;
  return norm.slice(0, 4) + "••••";
}

function deviceName(): string {
  try { return `${os.hostname()} · ${os.platform()}`.slice(0, 100); } catch { return "unknown device"; }
}

function appVersion(): string {
  return process.env.OCEAN_APP_VERSION ?? "1.0.0";
}

async function post(pathname: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`${licenseServer()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

export type LicenseStatus = {
  licensed: boolean;
  state: "unlicensed" | "active" | "locked" | "grace";
  type: Stored["type"];
  keyMasked: string | null;
  note: string | null;
  expiresAt: string | null;
  lastCheckAt: string | null;
  /** Human-readable reason when the app is locked or unlicensed. */
  message: string | null;
  deviceId: string;
  server: string;
};

/** The single source of truth for "may this installation run?". */
export function licenseStatus(): LicenseStatus {
  const s = load();
  const base = {
    type: s.type,
    keyMasked: s.keyMasked,
    note: s.note,
    expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
    lastCheckAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
    deviceId: s.deviceId,
    server: licenseServer(),
  };
  if (!s.token) {
    return { ...base, licensed: false, state: "unlicensed", message: s.lockedReason ?? null };
  }
  if (s.lockedReason) {
    return { ...base, licensed: false, state: "locked", message: s.lockedReason };
  }
  if (s.expiresAt && s.expiresAt <= Date.now()) {
    return { ...base, licensed: false, state: "locked", message: "This key has expired." };
  }
  const sinceCheck = s.lastOkAt ? Date.now() - s.lastOkAt : Infinity;
  if (sinceCheck > OFFLINE_GRACE_MS) {
    return {
      ...base,
      licensed: false,
      state: "locked",
      message: "The license could not be verified for 7 days. Connect to the internet and open the app again.",
    };
  }
  return {
    ...base,
    licensed: true,
    state: sinceCheck > HEARTBEAT_INTERVAL_MS * 2 ? "grace" : "active",
    message: null,
  };
}

export type ActivateOutcome = { ok: true; status: LicenseStatus } | { ok: false; code: string; message: string };

/** Exchange a key for a device-bound token. */
export async function activateLicense(rawKey: unknown): Promise<ActivateOutcome> {
  const key = typeof rawKey === "string" ? rawKey.trim().toUpperCase() : "";
  if (!/^[A-Z0-9-]{8,32}$/.test(key)) {
    return { ok: false, code: "MALFORMED", message: "That does not look like a key. Example: VR-ABCD-EFGH-IJKL" };
  }
  const s = load();
  let res: { status: number; json: Record<string, unknown> | null };
  try {
    res = await post("/api/v1/activate", {
      key,
      deviceId: s.deviceId,
      deviceName: deviceName(),
      appVersion: appVersion(),
    });
  } catch (err) {
    logger.warn({ event: "license_activate_unreachable", matchStatus: (err as Error).message });
    return { ok: false, code: "SERVER_UNREACHABLE", message: "The license server could not be reached. Check your internet connection and try again." };
  }

  if (res.status !== 200 || !res.json || typeof res.json.token !== "string") {
    const error = (res.json?.error ?? {}) as { code?: string; message?: string };
    return { ok: false, code: error.code ?? "ACTIVATION_FAILED", message: error.message ?? "This key was not accepted." };
  }

  const license = (res.json.license ?? {}) as { type?: string; expiresAt?: string | null; note?: string | null };
  s.token = res.json.token;
  s.keyMasked = maskKey(key);
  s.type = (license.type as Stored["type"]) ?? null;
  s.note = typeof license.note === "string" ? license.note : null;
  s.expiresAt = license.expiresAt ? Date.parse(license.expiresAt) : null;
  s.activatedAt = Date.now();
  s.lastOkAt = Date.now();
  s.lockedReason = null;
  s.lockedCode = null;
  s.reportedSpotifyId = null;
  persist();
  logger.info({ event: "license_activated", matchStatus: `${s.type};${s.keyMasked}` });
  return { ok: true, status: licenseStatus() };
}

/** Forget the license on this computer (the panel still counts the device
 *  until the administrator releases its slot). */
export function deactivateLicense(): void {
  const s = load();
  s.token = null;
  s.keyMasked = null;
  s.type = null;
  s.note = null;
  s.expiresAt = null;
  s.activatedAt = null;
  s.lastOkAt = null;
  s.lockedReason = null;
  s.lockedCode = null;
  s.reportedSpotifyId = null;
  persist();
  logger.info({ event: "license_deactivated" });
}

let heartbeatInFlight: Promise<LicenseStatus> | null = null;

/**
 * Ask the panel whether this installation is still allowed to run.
 * `force` skips the interval check (used at startup and after activation).
 */
export async function heartbeatLicense(force = false): Promise<LicenseStatus> {
  const s = load();
  if (!s.token) return licenseStatus();
  if (!force && s.lastOkAt && Date.now() - s.lastOkAt < HEARTBEAT_INTERVAL_MS) return licenseStatus();
  if (heartbeatInFlight) return heartbeatInFlight;

  heartbeatInFlight = (async () => {
    try {
      const res = await post("/api/v1/heartbeat", { token: s.token, deviceId: s.deviceId, appVersion: appVersion() });
      if (res.status === 200 && res.json?.valid === true) {
        s.lastOkAt = Date.now();
        s.expiresAt = typeof res.json.expiresAt === "string" ? Date.parse(res.json.expiresAt) : null;
        s.note = typeof res.json.note === "string" ? res.json.note : s.note;
        s.lockedReason = null;
        s.lockedCode = null;
        persist();
      } else if (res.status === 403) {
        // A definitive refusal — revoked, expired, blocked, or the panel no
        // longer knows this token. Lock now rather than at the grace deadline.
        s.lockedCode = typeof res.json?.code === "string" ? res.json.code : "REFUSED";
        s.lockedReason = typeof res.json?.message === "string" ? res.json.message : "This license is no longer valid.";
        persist();
        logger.warn({ event: "license_refused", matchStatus: s.lockedCode });
      }
      // Any other status (500, 502, …) is a server problem, not a verdict:
      // leave the last good check in place and rely on the grace window.
    } catch {
      // Offline. The grace window in licenseStatus() decides what happens.
    } finally {
      heartbeatInFlight = null;
    }
    return licenseStatus();
  })();
  return heartbeatInFlight;
}

/**
 * Report the Spotify identity the user consented to link (or null when they
 * unlink). Fire-and-forget: a failure here must never break the app.
 */
export async function reportSpotifyIdentity(profile: {
  id: string; displayName: string | null; avatarUrl: string | null;
  country: string | null; product: string | null; followers: number | null; email: string | null;
} | null): Promise<void> {
  const s = load();
  if (!s.token) return;
  if (profile && s.reportedSpotifyId === profile.id) return; // already reported
  try {
    await post("/api/v1/spotify", { token: s.token, deviceId: s.deviceId, profile });
    s.reportedSpotifyId = profile?.id ?? null;
    persist();
  } catch {
    // The panel will learn about it on the next link; not worth retrying here.
  }
}

/** For tests. */
export function __resetLicense(): void {
  cache = blank();
}
