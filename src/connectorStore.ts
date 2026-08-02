/**
 * In-memory connector + lookup state (per server process).
 *
 * Holds pairing codes, hashed connector keys, pending lookups, and event
 * dedup markers — all short-lived. It never stores Spotify tokens, cookies,
 * raw responses, or the connector key in plaintext (only a SHA-256 hash).
 */

import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { resolveUuid, UuidLookupResult } from "./uuidResolver";

/**
 * Connector keys are persisted to disk (hashed only) so a one-time pairing
 * survives server restarts — pair once, use continuously. The file never
 * contains plaintext keys, Spotify tokens, or cookies.
 */
const CONNECTORS_PATH =
  process.env.DISTRO_CONNECTORS_PATH ?? path.join(process.cwd(), ".data", "connectors.json");

const PAIRING_TTL_MS = 5 * 60 * 1000;
const LOOKUP_TTL_MS = 60 * 1000; // pending lookup timeout
const HISTORY_TTL_MS = 30 * 60 * 1000;
const DEDUP_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120; // events/min per connector key
// Every desktop-app launch used to mint a fresh key, so stale keys pile up in
// connectors.json. Keys unseen for this long are dropped at load time.
const KEY_MAX_IDLE_MS = 45 * 24 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}
function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}
function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// ---------------- Pairing codes ----------------
type PairingCode = { codeHash: string; expiresAt: number };
const pairingCodes: PairingCode[] = [];

export function createPairingCode(): { code: string; expiresAt: number } {
  sweep();
  // 8-char human-enterable code.
  const code = randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  const expiresAt = now() + PAIRING_TTL_MS;
  pairingCodes.push({ codeHash: sha256(code), expiresAt });
  return { code, expiresAt };
}

// ---------------- Connector keys (hashed, persisted to disk) ----------------
type ConnectorKey = { keyHash: string; createdAt: number; revoked: boolean; lastSeenAt: number | null };
const connectorKeys: ConnectorKey[] = [];
let keysLoaded = false;

/** Load persisted key hashes once per process, dropping revoked/stale ones. */
function ensureLoaded(): void {
  if (keysLoaded) return;
  keysLoaded = true;
  let dropped = 0;
  try {
    const arr = JSON.parse(fs.readFileSync(CONNECTORS_PATH, "utf8"));
    if (Array.isArray(arr)) {
      for (const k of arr) {
        if (!k || typeof k.keyHash !== "string") continue;
        const lastSeenAt = typeof k.lastSeenAt === "number" ? k.lastSeenAt : null;
        const idleSince = lastSeenAt ?? k.createdAt ?? 0;
        if (k.revoked || now() - idleSince > KEY_MAX_IDLE_MS) { dropped++; continue; }
        connectorKeys.push({ keyHash: k.keyHash, createdAt: k.createdAt ?? now(), revoked: false, lastSeenAt });
      }
    }
  } catch { /* no file yet — first run */ }
  if (dropped > 0) persistKeys();
}

/** Persist only hashes + metadata (never plaintext keys). */
function persistKeys(): void {
  try {
    fs.mkdirSync(path.dirname(CONNECTORS_PATH), { recursive: true });
    const data = connectorKeys
      .filter((k) => !k.revoked)
      .map((k) => ({ keyHash: k.keyHash, createdAt: k.createdAt, revoked: k.revoked, lastSeenAt: k.lastSeenAt }));
    fs.writeFileSync(CONNECTORS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch { /* best effort */ }
}

// Throttled persist so lastSeenAt survives restarts without a disk write per request.
let lastSeenPersistedAt = 0;
function persistLastSeenThrottled(): void {
  if (now() - lastSeenPersistedAt < 5 * 60 * 1000) return;
  lastSeenPersistedAt = now();
  persistKeys();
}

/** Exchange a valid, unexpired, single-use pairing code for a connector key. */
export function completePairing(code: unknown): { ok: true; connectorKey: string } | { ok: false; code: string; message: string } {
  ensureLoaded();
  sweep();
  if (typeof code !== "string" || !/^[A-Za-z0-9]{4,16}$/.test(code)) {
    return { ok: false, code: "INVALID_CODE", message: "Malformed pairing code." };
  }
  const h = sha256(code.toUpperCase());
  const idx = pairingCodes.findIndex((p) => p.codeHash === h && p.expiresAt > now());
  if (idx < 0) return { ok: false, code: "PAIRING_CODE_INVALID", message: "Pairing code is invalid or expired." };
  pairingCodes.splice(idx, 1); // single-use
  const key = token(24);
  connectorKeys.push({ keyHash: sha256(key), createdAt: now(), revoked: false, lastSeenAt: null });
  persistKeys();
  return { ok: true, connectorKey: key };
}

/**
 * Extract the connector key from request headers. Accepts the canonical
 * `Authorization: Connector <key>` form and the `X-Connector-Key` fallback —
 * the Spotify desktop client's native request layer (CosmosAsync) may reserve
 * the Authorization header for its own tokens.
 */
export function connectorKeyFromHeaders(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization") ?? "";
  const m = auth.match(/^Connector\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = headers.get("x-connector-key");
  return x && x.trim().length >= 16 ? x.trim() : null;
}

export function verifyConnectorKey(rawKey: unknown): boolean {
  ensureLoaded();
  if (typeof rawKey !== "string" || rawKey.length < 16) return false;
  const h = sha256(rawKey);
  const k = connectorKeys.find((c) => c.keyHash === h && !c.revoked);
  if (!k) return false;
  k.lastSeenAt = now();
  persistLastSeenThrottled();
  return true;
}

export function revokeConnectorKey(rawKey: unknown): boolean {
  ensureLoaded();
  if (typeof rawKey !== "string") return false;
  const h = sha256(rawKey);
  const k = connectorKeys.find((c) => c.keyHash === h);
  if (!k) return false;
  k.revoked = true;
  persistKeys();
  return true;
}

let lastHeartbeatAt: number | null = null;
let extensionIdSeen: string | null = null;
const HEARTBEAT_FRESH_MS = 90 * 1000;

/** Extension heartbeat (authorized). Keeps paired status live across polls. */
export function recordHeartbeat(extensionId?: string): void {
  lastHeartbeatAt = now();
  if (typeof extensionId === "string" && /^[a-p]{32}$/.test(extensionId)) extensionIdSeen = extensionId;
}

// ---------------- Desktop bridge status + command queue ----------------
// The desktop shell (Electron) reports whether it can actually reach the
// Spotify client over CDP. This is what lets the panel distinguish
// "desktop app not running" / "desktop running, Spotify not linked" /
// "fully connected" instead of showing a single misleading "not connected".
const BRIDGE_FRESH_MS = 90 * 1000;

type BridgeStatus = {
  reportedAt: number;
  spotifyRunning: boolean;
  debuggable: boolean;
};
let bridgeStatus: BridgeStatus | null = null;

/** Authorized: the desktop shell reports its view of the Spotify link. */
export function recordBridgeStatus(input: { spotifyRunning?: unknown; debuggable?: unknown }): void {
  bridgeStatus = {
    reportedAt: now(),
    spotifyRunning: !!input.spotifyRunning,
    debuggable: !!input.debuggable,
  };
}

// Single-slot command queue: the panel asks the desktop shell to do exactly one
// thing ("reconnect" = relaunch Spotify with the CDP flag). The shell polls,
// takes the command, executes it, and reports the outcome.
type BridgeCommand = { id: string; action: "reconnect"; createdAt: number };
type BridgeCommandResult = { id: string; action: string; ok: boolean; message: string | null; finishedAt: number };
let pendingBridgeCommand: BridgeCommand | null = null;
let lastBridgeCommandResult: BridgeCommandResult | null = null;
const BRIDGE_COMMAND_TTL_MS = 2 * 60 * 1000;

/** Panel-side (local, unauthenticated like pair/start): queue a command. */
export function requestBridgeCommand(action: unknown): { ok: true; id: string } | { ok: false; code: string } {
  if (action !== "reconnect") return { ok: false, code: "UNSUPPORTED_ACTION" };
  const cmd: BridgeCommand = { id: token(8), action: "reconnect", createdAt: now() };
  pendingBridgeCommand = cmd;
  return { ok: true, id: cmd.id };
}

/** Desktop-side (authorized): take the pending command, if any. */
export function takeBridgeCommand(): BridgeCommand | null {
  const cmd = pendingBridgeCommand;
  if (!cmd) return null;
  if (now() - cmd.createdAt > BRIDGE_COMMAND_TTL_MS) { pendingBridgeCommand = null; return null; }
  pendingBridgeCommand = null;
  return cmd;
}

/** Desktop-side (authorized): report how a taken command went. */
export function completeBridgeCommand(id: unknown, ok: unknown, message: unknown): void {
  if (typeof id !== "string" || id.length === 0) return;
  lastBridgeCommandResult = {
    id,
    action: "reconnect",
    ok: !!ok,
    message: typeof message === "string" ? message.slice(0, 300) : null,
    finishedAt: now(),
  };
}

export function bridgeCommandState() {
  return {
    pending: pendingBridgeCommand
      ? { id: pendingBridgeCommand.id, action: pendingBridgeCommand.action }
      : null,
    lastResult: lastBridgeCommandResult,
  };
}

export function connectorStatus() {
  ensureLoaded();
  sweep();
  const active = connectorKeys.filter((c) => !c.revoked);
  const lastSeenAt = active.reduce<number | null>((m, c) => (c.lastSeenAt && (!m || c.lastSeenAt > m) ? c.lastSeenAt : m), null);
  const heartbeatFresh = lastHeartbeatAt !== null && now() - lastHeartbeatAt < HEARTBEAT_FRESH_MS;
  const bridgeFresh = bridgeStatus !== null && now() - bridgeStatus.reportedAt < BRIDGE_FRESH_MS;
  return {
    paired: active.length > 0,
    connected: active.length > 0 && heartbeatFresh,
    activeConnectors: active.length,
    lastSeenAt,
    lastHeartbeatAt,
    heartbeatFresh,
    extensionId: extensionIdSeen,
    bridge: {
      // desktopAlive: the Electron shell has reported in recently at all.
      desktopAlive: bridgeFresh,
      spotifyRunning: bridgeFresh ? bridgeStatus!.spotifyRunning : false,
      debuggable: bridgeFresh ? bridgeStatus!.debuggable : false,
      reportedAt: bridgeStatus?.reportedAt ?? null,
    },
  };
}

// ---------------- Rate limiting (per key hash) ----------------
const rate = new Map<string, { count: number; windowStart: number }>();
export function rateLimit(keyHash: string): boolean {
  const r = rate.get(keyHash);
  const t = now();
  if (!r || t - r.windowStart > RATE_WINDOW_MS) {
    rate.set(keyHash, { count: 1, windowStart: t });
    return true;
  }
  if (r.count >= RATE_MAX) return false;
  r.count++;
  return true;
}

// ---------------- Lookups ----------------
export type LookupStatus = "pending" | "captured" | "completed" | "timed_out";
/** Fine-grained state machine reported to the UI. */
export type LookupStage =
  | "created" | "opening_spotify" | "waiting_for_metadata" | "login_required"
  | "metadata_captured" | "resolving_uuid" | "matched" | "unmatched"
  | "mapping_conflict" | "timed_out" | "cancelled" | "failed";

export type Lookup = {
  requestId: string;
  spotifyTrackId: string;
  createdAt: number;
  expiresAt: number;
  status: LookupStatus;
  stage: LookupStage;
  connectorStatus: "waiting" | "captured";
  result: UuidLookupResult | null;
  metadata: null | {
    trackTitle: string; artists: string[]; albumTitle: string | null;
    albumLabel: string | null; isrc: string | null; spotifyUri: string;
    trackGid: string | null; capturedAt: string;
  };
};
const lookups = new Map<string, Lookup>();

export function createLookup(spotifyTrackId: string): Lookup {
  sweep();
  const requestId = token(16);
  const t = now();
  const lookup: Lookup = {
    requestId,
    spotifyTrackId,
    createdAt: t,
    expiresAt: t + LOOKUP_TTL_MS,
    status: "pending",
    stage: "created",
    connectorStatus: "waiting",
    result: null,
    metadata: null,
  };
  lookups.set(requestId, lookup);
  return lookup;
}

/** Connector-driven stage transition for a specific lookup. */
export function setLookupStage(requestId: string, stage: LookupStage): Lookup | null {
  const l = lookups.get(requestId);
  if (!l) return null;
  // Never regress a finished lookup.
  if (l.status === "completed" || l.status === "timed_out") return l;
  if (stage === "cancelled") { l.status = "timed_out"; l.stage = "cancelled"; return l; }
  if (stage === "login_required" || stage === "opening_spotify" || stage === "waiting_for_metadata") {
    l.stage = stage;
  }
  return l;
}

export function getLookup(requestId: string): Lookup | null {
  sweep();
  return lookups.get(requestId) ?? null;
}

export function pendingTrackIds(): string[] {
  sweep();
  return [...lookups.values()].filter((l) => l.status === "pending").map((l) => l.spotifyTrackId);
}

// ---------------- Event dedup ----------------
const dedup = new Map<string, number>();
export function isDuplicateEvent(dedupKey: string): boolean {
  sweep();
  const exp = dedup.get(dedupKey);
  if (exp && exp > now()) return true;
  dedup.set(dedupKey, now() + DEDUP_TTL_MS);
  return false;
}

/**
 * Correlate a captured event (by spotify track id) to a pending lookup and
 * resolve the distributor. Returns the affected lookup, or null if none pending.
 */
export function completeLookupForTrack(
  spotifyTrackId: string,
  licensorUuid: string,
  metadata: Lookup["metadata"]
): Lookup | null {
  sweep();
  const lookup = [...lookups.values()].find(
    (l) => l.spotifyTrackId === spotifyTrackId && l.status === "pending"
  );
  if (!lookup) return null;
  lookup.result = resolveUuid(licensorUuid);
  lookup.metadata = metadata;
  lookup.status = "completed";
  lookup.connectorStatus = "captured";
  lookup.stage =
    lookup.result.matchStatus === "matched" ? "matched"
    : lookup.result.matchStatus === "mapping_conflict" ? "mapping_conflict"
    : "unmatched";
  return lookup;
}

// ---------------- Lazy TTL sweep ----------------
function sweep(): void {
  const t = now();
  for (let i = pairingCodes.length - 1; i >= 0; i--) if (pairingCodes[i].expiresAt <= t) pairingCodes.splice(i, 1);
  for (const [k, v] of dedup) if (v <= t) dedup.delete(k);
  for (const [id, l] of lookups) {
    if (l.status === "pending" && l.expiresAt <= t) {
      l.status = "timed_out";
      if (l.stage !== "login_required") l.stage = "timed_out";
    }
    // Drop very old finished lookups.
    if (l.status !== "pending" && t - l.createdAt > HISTORY_TTL_MS) lookups.delete(id);
  }
}

/** For tests: wipe all state. */
export function __resetConnectorStore(): void {
  pairingCodes.length = 0;
  connectorKeys.length = 0;
  keysLoaded = true; // avoid reloading persisted keys during tests
  lookups.clear();
  dedup.clear();
  rate.clear();
  lastHeartbeatAt = null;
  extensionIdSeen = null;
  bridgeStatus = null;
  pendingBridgeCommand = null;
  lastBridgeCommandResult = null;
}
