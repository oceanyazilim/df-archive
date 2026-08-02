/**
 * Client-side bridge to the Spotify desktop connector (the Spicetify
 * companion running INSIDE the Spotify desktop app).
 *
 * The panel never touches Spotify tokens/cookies/headers. It only:
 *   1. reads safe, backend-verified connector state (/api/connector/status),
 *   2. starts pairing by minting a short-lived code the user enters in the
 *      Spotify profile menu ("Ocean Distro Finder"),
 *   3. starts a real per-track licensor-UUID lookup: create a pending request
 *      on the backend; the companion polls /api/connector/pending, reads the
 *      metadata from the client's own session, and answers — the panel just
 *      polls the backend until the distributor resolves (or times out).
 *
 * All distributor resolution happens on the SERVER from the captured licensor
 * UUID. This module carries no distributor logic of its own. The legacy
 * browser-extension bridge (chrome.runtime messaging + tab opening) has been
 * retired in favor of this flow.
 */

export type ConnectorState = {
  paired: boolean;
  connected: boolean;
  /** Live report from the desktop shell about the Spotify CDP link. */
  bridge: {
    desktopAlive: boolean;
    spotifyRunning: boolean;
    debuggable: boolean;
  };
};

const OFFLINE_BRIDGE = { desktopAlive: false, spotifyRunning: false, debuggable: false };

/** Backend-verified connector state — the source of truth for paired/online. */
export async function queryConnectorState(): Promise<ConnectorState> {
  try {
    const r = await fetch("/api/connector/status");
    if (r.ok) {
      const j = await r.json();
      const b = j.bridge ?? {};
      return {
        paired: !!j.paired,
        connected: !!j.connected,
        bridge: {
          desktopAlive: !!b.desktopAlive,
          spotifyRunning: !!b.spotifyRunning,
          debuggable: !!b.debuggable,
        },
      };
    }
  } catch { /* backend unreachable — treat as offline */ }
  return { paired: false, connected: false, bridge: OFFLINE_BRIDGE };
}

/**
 * Ask the desktop shell to (re)connect Spotify — it relaunches Spotify with
 * the app link enabled. Returns the queued command id, or null.
 */
export async function requestBridgeReconnect(): Promise<string | null> {
  try {
    const r = await fetch("/api/connector/bridge-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reconnect" }),
    });
    const j = await r.json();
    return r.ok && typeof j.id === "string" ? j.id : null;
  } catch {
    return null;
  }
}

/** Read whether a queued bridge command finished, and how. */
export async function queryBridgeCommandResult(
  id: string
): Promise<{ done: boolean; ok?: boolean; message?: string | null }> {
  try {
    const r = await fetch("/api/connector/bridge-command");
    if (r.ok) {
      const j = await r.json();
      if (j?.lastResult?.id === id) return { done: true, ok: !!j.lastResult.ok, message: j.lastResult.message ?? null };
    }
  } catch { /* transient */ }
  return { done: false };
}

/**
 * Mint a pairing code for the Spotify companion. The user enters it in the
 * Spotify desktop app (profile menu → "Ocean Distro Finder"); the companion
 * exchanges it for a revocable connector key. Poll queryConnectorState()
 * until `paired` flips true.
 */
export async function startPairing(): Promise<{ ok: boolean; code?: string; ttlSeconds?: number; error?: string }> {
  try {
    const r = await fetch("/api/connector/pair/start", { method: "POST" });
    const j = await r.json();
    const code = j.pairingCode ?? j.code;
    if (!r.ok || !code) return { ok: false, error: "code_failed" };
    return { ok: true, code, ttlSeconds: j.ttlSeconds };
  } catch {
    return { ok: false, error: "backend_unreachable" };
  }
}

export type ConnectorLookupStage =
  | "starting" | "opening_spotify" | "waiting_for_metadata" | "login_required"
  | "matched" | "unresolved" | "conflict" | "timed_out" | "no_connector" | "failed";

export type ConnectorLookupResult = {
  stage: ConnectorLookupStage;
  distributor: string | null;   // exact stored name, or null
  licensorUuid: string | null;  // normalized 32-hex, or null
  status: "verified" | "unresolved" | "conflict";
  /**
   * ISRC as captured from the client's own metadata response. The public Web
   * API no longer exposes it for catalogue rows, so this is the only source
   * when resolving a whole artist catalogue.
   */
  isrc: string | null;
};

/**
 * Run a real licensor-UUID lookup for one track:
 *   POST /api/lookup/start → the Spotify-app companion picks it up from
 *   /api/connector/pending and answers → poll the result here.
 * `onStage` receives coarse progress for the UI. Resolves when terminal.
 */
export async function runConnectorLookup(
  spotifyTrackId: string,
  onStage?: (s: ConnectorLookupStage) => void,
  opts?: { signal?: AbortSignal }
): Promise<ConnectorLookupResult> {
  const fail = (stage: ConnectorLookupStage): ConnectorLookupResult => ({ stage, distributor: null, licensorUuid: null, status: stage === "conflict" ? "conflict" : "unresolved", isrc: null });

  const state = await queryConnectorState();
  // Paired but momentarily offline still gets a chance — the companion polls
  // every few seconds and the heartbeat window is coarser than its poll loop.
  if (!state.paired) { onStage?.("no_connector"); return fail("no_connector"); }

  onStage?.("starting");
  let requestId: string;
  try {
    const r = await fetch("/api/lookup/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: spotifyTrackId }) });
    const j = await r.json();
    if (!r.ok || !j.requestId) return fail("failed");
    requestId = j.requestId;
  } catch { return fail("failed"); }

  // Poll the backend until the pending lookup reaches a terminal state.
  const deadline = Date.now() + 60_000;
  let lastStage: ConnectorLookupStage = "waiting_for_metadata";
  onStage?.(lastStage);
  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) return fail("failed");
    await new Promise((r) => setTimeout(r, 1200));
    let j: Record<string, unknown>;
    try { const res = await fetch(`/api/lookup/${requestId}`); if (!res.ok) continue; j = await res.json(); }
    catch { continue; }

    const stage = String(j.stage ?? "");
    const status = String(j.status ?? "");
    if (stage === "login_required" && lastStage !== "login_required") { lastStage = "login_required"; onStage?.("login_required"); }

    if (status === "completed") {
      const ms = String(j.matchStatus ?? "");
      const isrc = typeof j.isrc === "string" ? j.isrc : null;
      if (ms === "matched") { onStage?.("matched"); return { stage: "matched", distributor: (j.distributor as string) ?? null, licensorUuid: (j.licensorUuid as string) ?? null, status: "verified", isrc }; }
      if (ms === "mapping_conflict") { onStage?.("conflict"); return { stage: "conflict", distributor: null, licensorUuid: (j.licensorUuid as string) ?? null, status: "conflict", isrc }; }
      onStage?.("unresolved"); return { stage: "unresolved", distributor: null, licensorUuid: (j.licensorUuid as string) ?? null, status: "unresolved", isrc };
    }
    if (status === "timed_out") { onStage?.("timed_out"); return fail("timed_out"); }
  }
  onStage?.("timed_out");
  return fail("timed_out");
}
