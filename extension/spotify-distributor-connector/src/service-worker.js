/*
 * Service worker.
 *
 * Two inbound channels:
 *  - chrome.runtime.onMessage           : content bridges (Spotify capture) + own pages.
 *  - chrome.runtime.onMessageExternal   : the paired PANEL only (externally_connectable),
 *                                         sending a one-click START lookup command.
 *
 * On START it opens the requested track in an INACTIVE background tab, waits for
 * the observer to capture the sanitized metadata, forwards it to the panel, and
 * then closes ONLY the tab it created. It never reads/sends tokens, cookies, or
 * headers, never starts playback, and never touches the user's library.
 */

const HEX32 = /^[a-f0-9]{32}$/;
const BASE62 = /^[A-Za-z0-9]{22}$/;
const START_TYPE = "OCEAN_START_SPOTIFY_LOOKUP_V1";
const EVENT_PATH = "/api/connector/spotify-event";
const PENDING_PATH = "/api/connector/pending";
const PAIR_PATH = "/api/connector/pair/complete";
const DISCONNECT_PATH = "/api/connector/disconnect";
const HEARTBEAT_PATH = "/api/connector/heartbeat";
const LOOKUP_EVENT_PATH = "/api/connector/lookup-event";
const TAB_TIMEOUT_MS = 50 * 1000;

const DEFAULTS = { enabled: false, panelOrigin: "http://127.0.0.1:3000", autoCapture: false, reuseExistingTab: false };

async function getConfig() {
  const c = await chrome.storage.local.get(["enabled", "panelOrigin", "autoCapture", "reuseExistingTab", "connectorKey", "lastCapture", "lastResult", "deliveryStatus"]);
  return {
    enabled: c.enabled ?? DEFAULTS.enabled,
    panelOrigin: c.panelOrigin ?? DEFAULTS.panelOrigin,
    autoCapture: c.autoCapture ?? DEFAULTS.autoCapture,
    reuseExistingTab: c.reuseExistingTab ?? DEFAULTS.reuseExistingTab,
    connectorKey: c.connectorKey ?? null,
    lastCapture: c.lastCapture ?? null,
    lastResult: c.lastResult ?? null,
    deliveryStatus: c.deliveryStatus ?? "idle",
  };
}

function validateOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { return null; }
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.protocol === "https:") return url.hostname ? url.origin : null;
  if (url.protocol === "http:") return (url.hostname === "127.0.0.1" || url.hostname === "localhost") ? url.origin : null;
  return null;
}

// ---- tab associations (session storage; cleared on browser restart) ----
async function setAssoc(a) {
  const all = (await chrome.storage.session.get("tabAssoc")).tabAssoc || {};
  all[String(a.tabId)] = a;
  await chrome.storage.session.set({ tabAssoc: all });
}
async function getAssocByTab(tabId) {
  const all = (await chrome.storage.session.get("tabAssoc")).tabAssoc || {};
  return all[String(tabId)] || null;
}
async function getAssocByRequest(requestId) {
  const all = (await chrome.storage.session.get("tabAssoc")).tabAssoc || {};
  return Object.values(all).find((a) => a.requestId === requestId) || null;
}
async function clearAssoc(tabId) {
  const all = (await chrome.storage.session.get("tabAssoc")).tabAssoc || {};
  delete all[String(tabId)];
  await chrome.storage.session.set({ tabAssoc: all });
}

async function reportStage(origin, key, requestId, event) {
  try {
    await fetch(origin + LOOKUP_EVENT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Connector " + key },
      body: JSON.stringify({ requestId, event }),
    });
  } catch { /* best effort */ }
}

async function closeTempTab(tabId) {
  // Never close a tab the user has focused — if they switched to the temp tab
  // (e.g. to listen), it is theirs now. Only silent background tabs are reaped.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.active) { await clearAssoc(tabId); return; }
  } catch { /* already closed */ }
  try { await chrome.tabs.remove(tabId); } catch { /* already closed */ }
  await clearAssoc(tabId);
  try { await chrome.alarms.clear("cleanup:" + tabId); } catch { /* */ }
}

// ---- one-click START from the panel ----
async function handleStart(msg, senderOrigin) {
  if (!msg || msg.type !== START_TYPE) return { ok: false, code: "BAD_TYPE" };
  const requestId = String(msg.requestId || "");
  const trackId = String(msg.spotifyTrackId || "");
  if (!requestId || !BASE62.test(trackId)) return { ok: false, code: "BAD_PAYLOAD" };

  const cfg = await getConfig();
  const origin = validateOrigin(cfg.panelOrigin);
  if (!origin || senderOrigin !== origin) return { ok: false, code: "ORIGIN_MISMATCH" };
  if (!cfg.enabled || !cfg.connectorKey) return { ok: false, code: "NOT_PAIRED" };

  const url = "https://open.spotify.com/track/" + trackId;
  await reportStage(origin, cfg.connectorKey, requestId, "opening_spotify");

  // Only one temporary tab per pending lookup.
  const existingAssoc = await getAssocByRequest(requestId);
  if (existingAssoc) return { ok: true, reused: true, tabId: existingAssoc.tabId };

  let tabId;
  let createdByExt = true;
  if (cfg.reuseExistingTab) {
    const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/track/*" });
    const match = tabs.find((t) => (t.url || "").includes(trackId));
    if (match) { tabId = match.id; createdByExt = false; }
  }
  if (tabId === undefined) {
    const tab = await chrome.tabs.create({ url, active: false }); // inactive background tab
    tabId = tab.id;
    // Mute the temp tab so it can never interfere with the user's own playback
    // (a second web-player instance must stay silent and passive).
    try { await chrome.tabs.update(tabId, { muted: true }); } catch { /* */ }
  }

  await setAssoc({ tabId, requestId, spotifyTrackId: trackId, createdByExt, createdAt: Date.now(), login: false });
  await chrome.alarms.create("cleanup:" + tabId, { delayInMinutes: TAB_TIMEOUT_MS / 60000 });
  await reportStage(origin, cfg.connectorKey, requestId, "waiting_for_metadata");
  return { ok: true, tabId, createdByExt };
}

// ---- login redirect detection ----
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const assoc = await getAssocByTab(tabId);
  if (!assoc) return;
  const url = changeInfo.url || (tab && tab.url) || "";
  if (url.indexOf("https://accounts.spotify.com") === 0) {
    assoc.login = true;
    await setAssoc(assoc);
    const cfg = await getConfig();
    const origin = validateOrigin(cfg.panelOrigin);
    if (origin && cfg.connectorKey) await reportStage(origin, cfg.connectorKey, assoc.requestId, "login_required");
    // Bring the login tab forward so the user can sign in. Never inspect creds.
    try { await chrome.tabs.update(tabId, { active: true }); } catch { /* */ }
  }
});

// ---- cleanup alarm (timeout) + heartbeat alarm ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "heartbeat") { await sendHeartbeat(); return; }
  if (alarm.name.indexOf("cleanup:") === 0) {
    const tabId = Number(alarm.name.slice("cleanup:".length));
    const assoc = await getAssocByTab(tabId);
    if (assoc && assoc.createdByExt && !assoc.login) await closeTempTab(tabId);
    else await clearAssoc(tabId);
  }
});

async function sendHeartbeat() {
  const cfg = await getConfig();
  const origin = validateOrigin(cfg.panelOrigin);
  if (!origin || !cfg.connectorKey || !cfg.enabled) return;
  try {
    await fetch(origin + HEARTBEAT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Connector " + cfg.connectorKey },
      body: JSON.stringify({ extensionId: chrome.runtime.id }),
    });
  } catch { /* offline */ }
}

function ensureHeartbeatAlarm() {
  chrome.alarms.get("heartbeat", (a) => { if (!a) chrome.alarms.create("heartbeat", { periodInMinutes: 1 }); });
}
chrome.runtime.onStartup.addListener(() => { ensureHeartbeatAlarm(); sendHeartbeat(); });
chrome.runtime.onInstalled.addListener(() => { ensureHeartbeatAlarm(); });
ensureHeartbeatAlarm();
sendHeartbeat();

// ---- capture forwarding (from the Spotify content bridge) ----
function revalidate(p) {
  if (!p || typeof p !== "object") return null;
  if (!BASE62.test(String(p.spotifyTrackId || ""))) return null;
  if (!HEX32.test(String(p.licensorUuid || "").toLowerCase())) return null;
  return p;
}

async function forwardCapture(payload, senderOrigin) {
  if (senderOrigin !== "https://open.spotify.com") return { ok: false, status: "rejected_origin" };
  const clean = revalidate(payload);
  if (!clean) return { ok: false, status: "rejected_payload" };

  await chrome.storage.local.set({
    lastCapture: {
      spotifyTrackId: clean.spotifyTrackId, trackTitle: clean.trackTitle || "",
      artists: clean.artists || [], licensorUuid: clean.licensorUuid,
      capturedAt: clean.capturedAt || new Date().toISOString(),
    },
  });

  // Remember licensor UUIDs per track for this browser session so the analyzer
  // can show a distributor for anything already played/opened. Session storage
  // only — cleared on browser restart, and it holds no token or personal data.
  try {
    const store = (await chrome.storage.session.get("licensorByTrack")).licensorByTrack || {};
    store[clean.spotifyTrackId] = clean.licensorUuid;
    const keys = Object.keys(store);
    if (keys.length > 300) delete store[keys[0]]; // simple bound
    await chrome.storage.session.set({ licensorByTrack: store });
  } catch { /* session storage unavailable; analyzer just shows "unknown" */ }

  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.connectorKey) { await chrome.storage.local.set({ deliveryStatus: "disabled_or_unpaired" }); return { ok: true, status: "local_only" }; }
  const origin = validateOrigin(cfg.panelOrigin);
  if (!origin) { await chrome.storage.local.set({ deliveryStatus: "bad_origin" }); return { ok: false, status: "bad_origin" }; }

  let shouldSend = cfg.autoCapture;
  if (!shouldSend) {
    try {
      const r = await fetch(origin + PENDING_PATH, { headers: { Authorization: "Connector " + cfg.connectorKey } });
      if (r.ok) { const j = await r.json(); shouldSend = Array.isArray(j.pendingTrackIds) && j.pendingTrackIds.indexOf(clean.spotifyTrackId) !== -1; }
      else if (r.status === 401) { await chrome.storage.local.set({ deliveryStatus: "invalid_connector_key" }); return { ok: false, status: "invalid_connector_key" }; }
    } catch { await chrome.storage.local.set({ deliveryStatus: "panel_unreachable" }); return { ok: false, status: "panel_unreachable" }; }
  }
  if (!shouldSend) { await chrome.storage.local.set({ deliveryStatus: "no_pending_lookup" }); return { ok: true, status: "no_pending_lookup" }; }

  try {
    const res = await fetch(origin + EVENT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Connector " + cfg.connectorKey },
      body: JSON.stringify(clean),
    });
    const j = await res.json().catch(() => ({}));
    const status = res.ok ? (j.matched ? "delivered" : "captured_no_match") : ("error_" + res.status);
    await chrome.storage.local.set({ deliveryStatus: status, lastResult: { spotifyTrackId: clean.spotifyTrackId, matchStatus: j.matchStatus ?? null, at: new Date().toISOString() } });

    // Close ONLY the tab we created for this request, after a matched delivery.
    if (res.ok && j.matched && j.requestId) {
      const assoc = await getAssocByRequest(j.requestId);
      if (assoc && assoc.createdByExt && !assoc.login) await closeTempTab(assoc.tabId);
    }
    return { ok: res.ok, status };
  } catch { await chrome.storage.local.set({ deliveryStatus: "panel_unreachable" }); return { ok: false, status: "panel_unreachable" }; }
}

// ---- pairing / config actions ----
async function pair(panelOrigin, code) {
  const origin = validateOrigin(panelOrigin);
  if (!origin) return { ok: false, error: "bad_origin" };
  if (typeof code !== "string" || !/^[A-Za-z0-9]{4,16}$/.test(code)) return { ok: false, error: "bad_code" };
  try {
    const res = await fetch(origin + PAIR_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.connectorKey) return { ok: false, error: (j && j.error && j.error.code) || "pair_failed" };
    await chrome.storage.local.set({ connectorKey: j.connectorKey, panelOrigin: origin, enabled: true });
    await sendHeartbeat(); // immediate heartbeat so the panel flips to paired
    return { ok: true };
  } catch { return { ok: false, error: "panel_unreachable" }; }
}

async function disconnect() {
  const cfg = await getConfig();
  const origin = validateOrigin(cfg.panelOrigin);
  if (origin && cfg.connectorKey) { try { await fetch(origin + DISCONNECT_PATH, { method: "POST", headers: { Authorization: "Connector " + cfg.connectorKey } }); } catch { /* */ } }
  // Close any temp tabs we still own.
  const all = (await chrome.storage.session.get("tabAssoc")).tabAssoc || {};
  for (const a of Object.values(all)) { if (a.createdByExt && !a.login) await closeTempTab(a.tabId); }
  await chrome.storage.local.remove(["connectorKey", "lastResult"]);
  await chrome.storage.local.set({ deliveryStatus: "idle" });
  return { ok: true };
}

async function publicState() {
  const cfg = await getConfig();
  return {
    enabled: cfg.enabled, panelOrigin: cfg.panelOrigin, autoCapture: cfg.autoCapture,
    paired: !!cfg.connectorKey, lastCapture: cfg.lastCapture, lastResult: cfg.lastResult, deliveryStatus: cfg.deliveryStatus,
  };
}

// ---- Ocean Analyzer ----
// The analyzer needs no pairing: it reads public metadata plus this user's own
// analytics from the local panel service. The connector key is attached only if
// one already exists, and no Spotify token/cookie is involved at any point.
const ANALYZER_KINDS = { track: 1, album: 1, artist: 1, playlist: 1 };
const ANALYZER_FETCH = "OCEAN_ANALYZER_FETCH";
const ANALYZER_RESULT = "OCEAN_ANALYZER_RESULT";
const ANALYZER_ERROR = "OCEAN_ANALYZER_ERROR";
const ANALYZER_DASHBOARD = "OCEAN_ANALYZER_OPEN_DASHBOARD";

function validAnalyzerTarget(t) {
  return !!(t && ANALYZER_KINDS[t.kind] === 1 && BASE62.test(String(t.id || "")));
}

/**
 * Fetch one analyzer target from the panel service.
 * `licensorUuid` comes from this session's own capture for that track when the
 * observer has already seen it — the public API never exposes it, and it is
 * never inferred from anything else.
 */
async function analyzerFetch(target, days) {
  if (!validAnalyzerTarget(target)) return { error: { code: "INVALID_TARGET", message: "This item could not be identified." } };

  const cfg = await getConfig();
  const origin = validateOrigin(cfg.panelOrigin);
  if (!origin) return { error: { code: "BAD_ORIGIN", message: "The panel address is not configured." } };

  let licensorUuid = null;
  if (target.kind === "track") {
    const captured = (await chrome.storage.session.get("licensorByTrack")).licensorByTrack || {};
    const seen = captured[target.id];
    if (seen && HEX32.test(String(seen))) licensorUuid = seen;
    else if (cfg.lastCapture && cfg.lastCapture.spotifyTrackId === target.id) licensorUuid = cfg.lastCapture.licensorUuid || null;
  }

  const url = new URL(origin + "/api/analyzer/" + target.kind + "/" + target.id);
  const safeDays = Number.isFinite(days) ? Math.min(365, Math.max(7, Math.round(days))) : 30;
  url.searchParams.set("days", String(safeDays));
  if (licensorUuid) url.searchParams.set("licensorUuid", licensorUuid);

  try {
    const res = await fetch(url.toString(), {
      headers: cfg.connectorKey ? { Authorization: "Connector " + cfg.connectorKey } : {},
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      return { error: (json && json.error) || { code: "ANALYZER_HTTP_" + res.status, message: "The analyzer service returned an error." } };
    }
    return { payload: json };
  } catch {
    return { error: { code: "PANEL_UNREACHABLE", message: "The Ocean panel is not running at " + origin + "." } };
  }
}

async function openAnalyzerDashboard(target) {
  if (!validAnalyzerTarget(target)) return;
  const cfg = await getConfig();
  const origin = validateOrigin(cfg.panelOrigin);
  if (!origin) return;
  const input = "https://open.spotify.com/" + target.kind + "/" + target.id;
  await chrome.tabs.create({ url: origin + "/?input=" + encodeURIComponent(input), active: true });
}

// ---- external messages: PANEL ONLY (externally_connectable) ----
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  handleStart(msg, sender && sender.origin).then(sendResponse).catch(() => sendResponse({ ok: false, code: "ERROR" }));
  return true;
});

// ---- internal messages: content bridge + own pages ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Capture from the Spotify tab (origin validated inside forwardCapture).
  if (msg && msg.kind === "SPOTIFY_METADATA") { forwardCapture(msg.payload, sender && sender.origin).then(sendResponse); return true; }

  // Analyzer messages come from our own content scripts on the Spotify origin.
  if (msg && msg.kind === ANALYZER_FETCH) {
    if (!sender || sender.id !== chrome.runtime.id || (sender.origin || "") !== "https://open.spotify.com") {
      sendResponse({ kind: ANALYZER_ERROR, error: { code: "FORBIDDEN", message: "Rejected." } });
      return false;
    }
    analyzerFetch(msg.target, msg.days).then((out) =>
      sendResponse(out.error ? { kind: ANALYZER_ERROR, error: out.error } : { kind: ANALYZER_RESULT, payload: out.payload })
    );
    return true;
  }
  if (msg && msg.kind === ANALYZER_DASHBOARD) {
    if (!sender || sender.id !== chrome.runtime.id || (sender.origin || "") !== "https://open.spotify.com") { sendResponse({ ok: false }); return false; }
    openAnalyzerDashboard(msg.target).then(() => sendResponse({ ok: true }));
    return true;
  }
  // Control messages: allowed only from our own extension pages or the
  // panel-origin content script (sender.id is ours and NOT the Spotify page).
  // A web page cannot forge chrome.runtime.onMessage with our extension id.
  const controlAllowed = sender && sender.id === chrome.runtime.id && (sender.origin || "") !== "https://open.spotify.com";
  if (!controlAllowed) { sendResponse({ ok: false, error: "forbidden" }); return false; }
  if (msg.kind === "GET_STATE") { publicState().then(sendResponse); return true; }
  if (msg.kind === "SET_CONFIG") {
    (async () => {
      const patch = {};
      if (typeof msg.enabled === "boolean") patch.enabled = msg.enabled;
      if (typeof msg.autoCapture === "boolean") patch.autoCapture = msg.autoCapture;
      if (typeof msg.reuseExistingTab === "boolean") patch.reuseExistingTab = msg.reuseExistingTab;
      if (typeof msg.panelOrigin === "string") { const o = validateOrigin(msg.panelOrigin); if (!o) { sendResponse({ ok: false, error: "bad_origin" }); return; } patch.panelOrigin = o; }
      await chrome.storage.local.set(patch);
      sendResponse({ ok: true, state: await publicState() });
    })();
    return true;
  }
  if (msg.kind === "PAIR") { pair(msg.panelOrigin, msg.code).then((r) => r.ok ? publicState().then((s) => sendResponse({ ok: true, state: s })) : sendResponse(r)); return true; }
  if (msg.kind === "DISCONNECT") { disconnect().then(() => publicState().then((s) => sendResponse({ ok: true, state: s }))); return true; }
  if (msg.kind === "CLEAR_HISTORY") { chrome.storage.local.remove(["lastCapture", "lastResult"]).then(() => sendResponse({ ok: true })); return true; }
  sendResponse({ ok: false, error: "unknown" });
  return false;
});
