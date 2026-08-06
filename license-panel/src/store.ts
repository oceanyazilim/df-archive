/**
 * File-backed license store.
 *
 * Deliberately dependency-free: keys live in one JSON file and the audit trail
 * in an append-only JSONL file, both inside DATA_DIR (a mounted volume in
 * Dokploy). No database server to run, back up, or keep patched — copying the
 * data directory IS the backup.
 *
 * Everything is loaded once per process and written back atomically
 * (write temp → rename), so a crash mid-write cannot corrupt the file.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.jsonl");

/** Distinct IPs kept per device — enough to spot sharing, bounded on disk. */
const MAX_IPS_PER_DEVICE = 25;
/** Events beyond this are rotated out of the live file. */
const MAX_EVENTS = 50_000;

export type KeyType = "single" | "duration" | "unlimited";

export type SpotifyIdentity = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  country: string | null;
  product: string | null;
  followers: number | null;
  email: string | null;
  linkedAt: number;
};

export type DeviceBinding = {
  deviceId: string;
  deviceName: string | null;
  appVersion: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  lastIp: string | null;
  ips: { ip: string; at: number }[];
  tokenHash: string;
  spotify: SpotifyIdentity | null;
  blocked: boolean;
};

export type LicenseKey = {
  id: string;
  key: string;
  type: KeyType;
  /** Days of validity from FIRST activation (duration keys only). */
  durationDays: number | null;
  /** How many devices may bind. 0 = unlimited. */
  deviceLimit: number;
  note: string | null;
  createdAt: number;
  revokedAt: number | null;
  firstActivatedAt: number | null;
  /** Computed at first activation for duration keys; null = never expires. */
  expiresAt: number | null;
  devices: DeviceBinding[];
};

export type EventAction = "activate" | "heartbeat" | "spotify" | "deactivate";
export type EventOutcome =
  | "ok" | "unknown_key" | "revoked" | "expired" | "device_limit"
  | "invalid_token" | "device_blocked" | "malformed";

export type AuditEvent = {
  at: number;
  action: EventAction;
  outcome: EventOutcome;
  keyId: string | null;
  keyLabel: string | null;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
};

// ---------------- Persistence ----------------
let keys: LicenseKey[] | null = null;

function ensureDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadKeys(): LicenseKey[] {
  if (keys) return keys;
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
    keys = Array.isArray(raw) ? (raw as LicenseKey[]) : [];
  } catch {
    keys = []; // first run
  }
  return keys;
}

function persistKeys(): void {
  ensureDir();
  const tmp = `${KEYS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(loadKeys(), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, KEYS_PATH); // atomic on the same filesystem
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

// ---------------- Audit log ----------------
export function logEvent(e: Omit<AuditEvent, "at"> & { at?: number }): void {
  ensureDir();
  const line = JSON.stringify({ at: e.at ?? Date.now(), ...e });
  try {
    fs.appendFileSync(EVENTS_PATH, line + "\n");
  } catch { /* never let auditing break an activation */ }
}

/** Newest first. `limit` is applied after filtering. */
export function listEvents(opts: { limit?: number; keyId?: string; deviceId?: string; outcome?: string } = {}): AuditEvent[] {
  ensureDir();
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(EVENTS_PATH, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  if (lines.length > MAX_EVENTS) {
    // Rotate: keep the newest MAX_EVENTS, archive the rest once.
    const keep = lines.slice(-MAX_EVENTS);
    try {
      fs.appendFileSync(path.join(DATA_DIR, "events-archive.jsonl"), lines.slice(0, -MAX_EVENTS).join("\n") + "\n");
      fs.writeFileSync(EVENTS_PATH, keep.join("\n") + "\n");
    } catch { /* best effort */ }
    lines = keep;
  }
  const out: AuditEvent[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: AuditEvent;
    try { e = JSON.parse(lines[i]) as AuditEvent; } catch { continue; }
    if (opts.keyId && e.keyId !== opts.keyId) continue;
    if (opts.deviceId && e.deviceId !== opts.deviceId) continue;
    if (opts.outcome && e.outcome !== opts.outcome) continue;
    out.push(e);
    if (out.length >= (opts.limit ?? 200)) break;
  }
  return out;
}

// ---------------- Keys ----------------
/** VR-XXXX-XXXX-XXXX — unambiguous alphabet (no O/0, I/1) so keys can be read aloud. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function keyBlock(len = 4): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
function generateKey(): string {
  return `VR-${keyBlock()}-${keyBlock()}-${keyBlock()}`;
}

export function listKeys(): LicenseKey[] {
  return [...loadKeys()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getKey(id: string): LicenseKey | null {
  return loadKeys().find((k) => k.id === id) ?? null;
}

/** Constant-time-ish lookup by the plaintext key the user typed. */
function findByPlainKey(candidate: string): LicenseKey | null {
  const norm = candidate.trim().toUpperCase();
  const wanted = Buffer.from(sha256(norm));
  for (const k of loadKeys()) {
    const have = Buffer.from(sha256(k.key.toUpperCase()));
    if (have.length === wanted.length && timingSafeEqual(have, wanted)) return k;
  }
  return null;
}

export function createKeys(opts: {
  type: KeyType;
  durationDays?: number | null;
  deviceLimit?: number;
  note?: string | null;
  count?: number;
}): LicenseKey[] {
  const all = loadKeys();
  const count = Math.min(50, Math.max(1, Math.floor(opts.count ?? 1)));
  const made: LicenseKey[] = [];
  for (let i = 0; i < count; i++) {
    const k: LicenseKey = {
      id: randomUUID(),
      key: generateKey(),
      type: opts.type,
      durationDays: opts.type === "duration" ? Math.max(1, Math.floor(opts.durationDays ?? 30)) : null,
      // A single-use key is exactly that: one device, forever.
      deviceLimit: opts.type === "single" ? 1 : Math.max(0, Math.floor(opts.deviceLimit ?? 1)),
      note: opts.note?.trim() ? opts.note.trim().slice(0, 200) : null,
      createdAt: Date.now(),
      revokedAt: null,
      firstActivatedAt: null,
      expiresAt: null,
      devices: [],
    };
    all.push(k);
    made.push(k);
  }
  persistKeys();
  return made;
}

export function revokeKey(id: string, revoked: boolean): LicenseKey | null {
  const k = getKey(id);
  if (!k) return null;
  k.revokedAt = revoked ? Date.now() : null;
  persistKeys();
  return k;
}

export function deleteKey(id: string): boolean {
  const all = loadKeys();
  const i = all.findIndex((k) => k.id === id);
  if (i < 0) return false;
  all.splice(i, 1);
  persistKeys();
  return true;
}

/** Block or unblock a single bound device without touching the rest of the key. */
export function setDeviceBlocked(keyId: string, deviceId: string, blocked: boolean): boolean {
  const k = getKey(keyId);
  const d = k?.devices.find((x) => x.deviceId === deviceId);
  if (!k || !d) return false;
  d.blocked = blocked;
  persistKeys();
  return true;
}

/** Release a device slot so the key can be re-used on a new machine. */
export function releaseDevice(keyId: string, deviceId: string): boolean {
  const k = getKey(keyId);
  if (!k) return false;
  const i = k.devices.findIndex((x) => x.deviceId === deviceId);
  if (i < 0) return false;
  k.devices.splice(i, 1);
  persistKeys();
  return true;
}

export function keyStatus(k: LicenseKey): "revoked" | "expired" | "active" | "unused" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && k.expiresAt <= Date.now()) return "expired";
  return k.firstActivatedAt ? "active" : "unused";
}

/**
 * A key is worth a second look when the same key answers from many different
 * IPs — the honest signal for a shared key, reported rather than auto-punished.
 */
export function sharingSignal(k: LicenseKey): { distinctIps: number; devices: number; suspicious: boolean } {
  const ips = new Set<string>();
  for (const d of k.devices) for (const entry of d.ips) ips.add(entry.ip);
  const distinctIps = ips.size;
  const devices = k.devices.length;
  return { distinctIps, devices, suspicious: distinctIps >= 4 || (k.deviceLimit > 0 && devices > k.deviceLimit) };
}

// ---------------- Activation flow ----------------
export type ActivateInput = {
  key: string;
  deviceId: string;
  deviceName?: string | null;
  appVersion?: string | null;
  ip: string | null;
  userAgent: string | null;
};

export type ActivateResult =
  | { ok: true; token: string; key: LicenseKey; device: DeviceBinding; expiresAt: number | null }
  | { ok: false; outcome: EventOutcome; message: string };

export function activate(input: ActivateInput): ActivateResult {
  const fail = (outcome: EventOutcome, message: string, keyId: string | null = null, keyLabel: string | null = null): ActivateResult => {
    logEvent({ action: "activate", outcome, keyId, keyLabel, deviceId: input.deviceId ?? null, ip: input.ip, userAgent: input.userAgent, detail: message });
    return { ok: false, outcome, message };
  };

  if (!input.key || !input.deviceId) return fail("malformed", "A key and a device id are required.");
  const k = findByPlainKey(input.key);
  if (!k) return fail("unknown_key", "This key does not exist.");
  if (k.revokedAt) return fail("revoked", "This key has been revoked.", k.id, k.key);
  if (k.expiresAt && k.expiresAt <= Date.now()) return fail("expired", "This key has expired.", k.id, k.key);

  let device = k.devices.find((d) => d.deviceId === input.deviceId);
  if (device?.blocked) return fail("device_blocked", "This device was blocked by the administrator.", k.id, k.key);

  if (!device) {
    if (k.deviceLimit > 0 && k.devices.length >= k.deviceLimit) {
      return fail(
        "device_limit",
        k.type === "single"
          ? "This key is single-use and is already activated on another computer."
          : `This key already reached its device limit (${k.deviceLimit}).`,
        k.id, k.key
      );
    }
    device = {
      deviceId: input.deviceId,
      deviceName: input.deviceName?.slice(0, 120) ?? null,
      appVersion: input.appVersion?.slice(0, 40) ?? null,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      lastIp: input.ip,
      ips: input.ip ? [{ ip: input.ip, at: Date.now() }] : [],
      tokenHash: "",
      spotify: null,
      blocked: false,
    };
    k.devices.push(device);
  }

  // A duration key's clock starts at the FIRST activation, not at creation —
  // a key sitting unused in a message never burns its 30 days.
  if (!k.firstActivatedAt) {
    k.firstActivatedAt = Date.now();
    if (k.type === "duration" && k.durationDays) {
      k.expiresAt = k.firstActivatedAt + k.durationDays * 24 * 60 * 60 * 1000;
    }
  }

  const token = randomBytes(32).toString("base64url");
  device.tokenHash = sha256(token);
  device.deviceName = input.deviceName?.slice(0, 120) ?? device.deviceName;
  device.appVersion = input.appVersion?.slice(0, 40) ?? device.appVersion;
  touchDevice(device, input.ip);
  persistKeys();

  logEvent({ action: "activate", outcome: "ok", keyId: k.id, keyLabel: k.key, deviceId: device.deviceId, ip: input.ip, userAgent: input.userAgent, detail: null });
  return { ok: true, token, key: k, device, expiresAt: k.expiresAt };
}

function touchDevice(device: DeviceBinding, ip: string | null): void {
  device.lastSeenAt = Date.now();
  if (!ip) return;
  device.lastIp = ip;
  const existing = device.ips.find((e) => e.ip === ip);
  if (existing) existing.at = Date.now();
  else {
    device.ips.push({ ip, at: Date.now() });
    if (device.ips.length > MAX_IPS_PER_DEVICE) device.ips.splice(0, device.ips.length - MAX_IPS_PER_DEVICE);
  }
}

export type TokenLookup = { key: LicenseKey; device: DeviceBinding } | null;

function findByToken(token: string, deviceId: string): TokenLookup {
  if (!token || !deviceId) return null;
  const hash = sha256(token);
  for (const k of loadKeys()) {
    const d = k.devices.find((x) => x.deviceId === deviceId && x.tokenHash === hash);
    if (d) return { key: k, device: d };
  }
  return null;
}

export type HeartbeatResult =
  | { ok: true; expiresAt: number | null; keyType: KeyType; note: string | null }
  | { ok: false; outcome: EventOutcome; message: string };

/** Periodic check from the app: still valid? Also records IP + time. */
export function heartbeat(input: { token: string; deviceId: string; ip: string | null; userAgent: string | null; appVersion?: string | null }): HeartbeatResult {
  const found = findByToken(input.token, input.deviceId);
  if (!found) {
    logEvent({ action: "heartbeat", outcome: "invalid_token", keyId: null, keyLabel: null, deviceId: input.deviceId ?? null, ip: input.ip, userAgent: input.userAgent, detail: null });
    return { ok: false, outcome: "invalid_token", message: "This installation is not activated." };
  }
  const { key: k, device } = found;
  const deny = (outcome: EventOutcome, message: string): HeartbeatResult => {
    logEvent({ action: "heartbeat", outcome, keyId: k.id, keyLabel: k.key, deviceId: device.deviceId, ip: input.ip, userAgent: input.userAgent, detail: null });
    return { ok: false, outcome, message };
  };
  if (device.blocked) return deny("device_blocked", "This device was blocked by the administrator.");
  if (k.revokedAt) return deny("revoked", "This key has been revoked.");
  if (k.expiresAt && k.expiresAt <= Date.now()) return deny("expired", "This key has expired.");

  if (input.appVersion) device.appVersion = input.appVersion.slice(0, 40);
  touchDevice(device, input.ip);
  persistKeys();
  logEvent({ action: "heartbeat", outcome: "ok", keyId: k.id, keyLabel: k.key, deviceId: device.deviceId, ip: input.ip, userAgent: input.userAgent, detail: null });
  return { ok: true, expiresAt: k.expiresAt, keyType: k.type, note: k.note };
}

/**
 * The app reports the Spotify account the user consented to link. Identity
 * fields only (see the consent screen in the app for the exact list) — never
 * tokens, and never listening data.
 */
export function attachSpotify(input: {
  token: string;
  deviceId: string;
  ip: string | null;
  userAgent: string | null;
  profile: Partial<SpotifyIdentity> & { id?: string } | null;
}): { ok: boolean; message?: string } {
  const found = findByToken(input.token, input.deviceId);
  if (!found) {
    logEvent({ action: "spotify", outcome: "invalid_token", keyId: null, keyLabel: null, deviceId: input.deviceId ?? null, ip: input.ip, userAgent: input.userAgent, detail: null });
    return { ok: false, message: "This installation is not activated." };
  }
  const { key: k, device } = found;
  const p = input.profile;
  const s = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

  if (!p || !s(p.id)) {
    // The user unlinked their account — clear it rather than keep stale data.
    device.spotify = null;
    persistKeys();
    logEvent({ action: "spotify", outcome: "ok", keyId: k.id, keyLabel: k.key, deviceId: device.deviceId, ip: input.ip, userAgent: input.userAgent, detail: "unlinked" });
    return { ok: true };
  }

  device.spotify = {
    id: s(p.id)!,
    displayName: s(p.displayName),
    avatarUrl: s(p.avatarUrl, 500),
    country: s(p.country, 8),
    product: s(p.product, 32),
    followers: typeof p.followers === "number" && Number.isFinite(p.followers) ? p.followers : null,
    email: s(p.email, 254),
    linkedAt: Date.now(),
  };
  touchDevice(device, input.ip);
  persistKeys();
  logEvent({ action: "spotify", outcome: "ok", keyId: k.id, keyLabel: k.key, deviceId: device.deviceId, ip: input.ip, userAgent: input.userAgent, detail: device.spotify.id });
  return { ok: true };
}

// ---------------- Dashboard aggregates ----------------
export function stats() {
  const all = loadKeys();
  const now = Date.now();
  let active = 0, unused = 0, expired = 0, revoked = 0, devices = 0, suspicious = 0;
  const ips = new Set<string>();
  const spotifyAccounts = new Set<string>();
  for (const k of all) {
    const st = keyStatus(k);
    if (st === "active") active++;
    else if (st === "unused") unused++;
    else if (st === "expired") expired++;
    else revoked++;
    devices += k.devices.length;
    if (sharingSignal(k).suspicious) suspicious++;
    for (const d of k.devices) {
      for (const e of d.ips) ips.add(e.ip);
      if (d.spotify) spotifyAccounts.add(d.spotify.id);
    }
  }
  const recent = listEvents({ limit: 500 });
  const last24h = recent.filter((e) => now - e.at < 24 * 60 * 60 * 1000).length;
  const denied24h = recent.filter((e) => now - e.at < 24 * 60 * 60 * 1000 && e.outcome !== "ok").length;
  return { total: all.length, active, unused, expired, revoked, devices, distinctIps: ips.size, spotifyAccounts: spotifyAccounts.size, suspicious, last24h, denied24h };
}

/** For tests / a fresh start in development. */
export function __reset(): void {
  keys = [];
}
