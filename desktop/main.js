// main.js — Ocean Distro Finder desktop shell.
//
// Boots the bundled Next.js standalone server (same build Docker uses) inside
// an Electron utility process, waits for /api/health, then opens the panel in
// a BrowserWindow. Track data still comes from the Spotify desktop client via
// the Spicetify companion, which POSTs the licensor UUID to this local server.

const { app, BrowserWindow, Menu, Tray, dialog, shell, utilityProcess, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const bridge = require("./spotify-bridge");

// Port 3000 by design: the panel will later sit behind a domain, and keeping
// the local port equal to the hosted default makes that integration trivial.
// Note `npm run dev` also wants 3000 — stop one before starting the other,
// or override with DISTRO_DESKTOP_PORT.
const PORT = Number(process.env.DISTRO_DESKTOP_PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc = null;
let win = null;
let tray = null;
let connectorKey = null;
// Latest bridge status the tray/menu display — same shape reportBridgeStatus()
// returns, kept here purely for UI text so both surfaces never disagree.
let lastKnownStatus = null;
let bridgeTimers = [];
const inFlight = new Set();
// True when a healthy Ocean panel already answered on PORT (usually `npm run
// dev`): we attach to it instead of fighting over the port with a second
// server. The health monitor takes over if that server later goes away.
let adoptedServer = false;
let ensuringServer = false;

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}

function serverDir() {
  return path.join(resourceRoot(), "server");
}

// ── Local panel server (Next.js standalone) ─────────────────
/** Is a healthy Ocean panel already answering on PORT? */
async function oceanPanelHealthy() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    // Shape-check so a random dev server on the port is not mistaken for ours.
    return !!j && j.status === "ok" && "uuidMappingLoaded" in j;
  } catch {
    return false;
  }
}

function forkServer() {
  const entry = path.join(serverDir(), "server.js");
  if (!fs.existsSync(entry)) {
    dialog.showErrorBox(
      "Server bundle missing",
      "desktop/server/server.js not found.\n\nRun from the repo root:\n  npm run desktop:prepare"
    );
    return false;
  }
  serverProc = utilityProcess.fork(entry, [], {
    cwd: serverDir(), // json/uuid's.json is read relative to cwd
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      // Connector pairings must survive server-bundle refreshes and app
      // updates — keep them in Electron's per-user data dir, not the bundle.
      DISTRO_CONNECTORS_PATH:
        process.env.DISTRO_CONNECTORS_PATH || path.join(app.getPath("userData"), "connectors.json"),
      // The linked Spotify account (OAuth refresh token) equally belongs to
      // the user, not the app bundle — one consent must outlive app updates.
      DISTRO_SPOTIFY_ACCOUNT_PATH:
        process.env.DISTRO_SPOTIFY_ACCOUNT_PATH || path.join(app.getPath("userData"), "spotify-account.json"),
    },
    stdio: "pipe",
    serviceName: "distro-finder-server",
  });
  serverProc.stdout?.on("data", (d) => console.log("[server]", String(d).trimEnd()));
  serverProc.stderr?.on("data", (d) => console.error("[server]", String(d).trimEnd()));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (!app.isQuitting && code !== 0) {
      // Self-heal instead of dying with a modal: another Ocean server may have
      // taken the port (adopt it), or a transient crash deserves a restart.
      console.warn("[server] exited unexpectedly (code", code + "), recovering…");
      setTimeout(() => { ensureServer().catch(() => {}); }, 2000);
    }
  });
  return true;
}

/**
 * Make sure SOMETHING healthy serves the panel on PORT — adopt an existing
 * Ocean server (e.g. `npm run dev`) or fork the bundled one. Retries; never
 * shows a blocking dialog unless every path failed.
 */
async function ensureServer() {
  if (ensuringServer) return true;
  ensuringServer = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await oceanPanelHealthy()) { adoptedServer = !serverProc; return true; }
      adoptedServer = false;
      if (!serverProc) {
        if (!forkServer()) return false; // bundle missing — dialog already shown
      }
      if (await waitForHealth(20000)) return true;
      serverProc?.kill();
      serverProc = null;
    }
    dialog.showErrorBox(
      "Panel server not responding",
      `No response from ${BASE}/api/health. Is port ${PORT} used by another program? (Override with DISTRO_DESKTOP_PORT.)`
    );
    return false;
  } finally {
    ensuringServer = false;
  }
}

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── Spotify bridge ──────────────────────────────────────────
// The desktop app pairs with its OWN server automatically (the pairing code
// never leaves this process), then answers pending lookups by reading the
// Spotify client's own metadata response over the DevTools protocol. The user
// never enters a code; the Spicetify companion is not involved.
async function api(method, pathname, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(connectorKey ? { Authorization: "Connector " + connectorKey, "X-Connector-Key": connectorKey } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401) { connectorKey = null; clearPersistedKey(); throw new Error("UNAUTHORIZED"); }
  return json;
}

// The connector key is persisted so restarts reuse one pairing instead of
// minting a new connector every launch (the server prunes stale ones, but
// there is no reason to create them in the first place).
function keyFile() {
  return path.join(app.getPath("userData"), "bridge-key.json");
}
function loadPersistedKey() {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile(), "utf8"));
    if (j && typeof j.key === "string" && j.key.length >= 16) return j.key;
  } catch { /* first run */ }
  return null;
}
function persistKey(k) {
  try { fs.writeFileSync(keyFile(), JSON.stringify({ key: k }), { mode: 0o600 }); } catch { /* best effort */ }
}
function clearPersistedKey() {
  try { fs.unlinkSync(keyFile()); } catch { /* already gone */ }
}

let pairingPromise = null;
async function ensurePaired() {
  if (connectorKey) return true;
  if (pairingPromise) return pairingPromise;
  pairingPromise = (async () => {
    // Reuse the stored key if the server still accepts it (api() clears it on 401).
    const stored = loadPersistedKey();
    if (stored) {
      connectorKey = stored;
      try {
        await api("POST", "/api/connector/bridge-status", { spotifyRunning: false, debuggable: false });
        return true;
      } catch (err) {
        console.warn("[bridge] stored connector key rejected by server, pairing fresh:", err?.message ?? err);
        connectorKey = null;
      }
    }
    try {
      const start = await api("POST", "/api/connector/pair/start", {});
      const code = start?.pairingCode ?? start?.code;
      if (!code) { console.warn("[bridge] pair/start returned no pairing code:", start); return false; }
      const done = await api("POST", "/api/connector/pair/complete", { code });
      connectorKey = done?.connectorKey ?? null;
      if (connectorKey) persistKey(connectorKey);
      else console.warn("[bridge] pair/complete returned no connectorKey:", done);
      return !!connectorKey;
    } catch (err) {
      console.warn("[bridge] pairing failed, will retry next beat:", err?.message ?? err);
      return false;
    }
  })().finally(() => { pairingPromise = null; });
  return pairingPromise;
}

/** Report the real state of the Spotify link so the panel can show it honestly. */
async function reportBridgeStatus() {
  if (!connectorKey) return null;
  const debuggable = await bridge.isConnected();
  const spotifyRunning = debuggable || (await bridge.isSpotifyRunning());
  try { await api("POST", "/api/connector/bridge-status", { spotifyRunning, debuggable }); }
  catch (err) { console.warn("[bridge] failed to report bridge status to server:", err?.message ?? err); }
  return { spotifyRunning, debuggable };
}

/**
 * Answer one pending lookup from the Spotify client's own response.
 *
 * Captures are serialized: spclient starts answering 401 when a catalogue run
 * fires many metadata reads at once, so one at a time (with a small gap) is
 * both faster overall and far more reliable than parallel bursts.
 */
let captureChain = Promise.resolve();
async function answerPending(trackId) {
  if (inFlight.has(trackId)) return;
  inFlight.add(trackId);
  captureChain = captureChain.then(() => captureOne(trackId)).catch(() => {});
  return captureChain;
}

async function captureOne(trackId) {
  try {
    const pb = await bridge.fetchTrackProtobuf(trackId);
    await api("POST", "/api/connector/spotify-metadata", {
      spotifyTrackId: trackId,
      metadataBase64: pb.toString("base64"),
    });
    inFlight.delete(trackId); // answered — a later request may ask again
    console.log("[bridge] answered", trackId);
    await new Promise((r) => setTimeout(r, 150)); // gentle pacing for spclient
  } catch (e) {
    console.warn("[bridge] capture failed for", trackId, "-", e?.message || e);
    // Cool-down only on failure, so a bad track cannot spin the poll loop.
    setTimeout(() => inFlight.delete(trackId), 8000);
  }
}

/**
 * Serve one analyzer request parked in the Spotify renderer. The in-app modal
 * has no other way to reach the panel service, so this process fetches on its
 * behalf and writes the result back through the same CDP channel.
 */
const ANALYZER_KINDS = new Set(["track", "album", "artist", "playlist"]);
let lastAnalyzerId = null;

async function pumpAnalyzer() {
  let req;
  try { req = await bridge.readAnalyzerRequest(); } catch { return; }
  if (!req || !req.id || req.id === lastAnalyzerId) return;
  lastAnalyzerId = req.id;

  const kind = String(req.kind || "");
  const id = String(req.spotifyId || "");
  if (!ANALYZER_KINDS.has(kind) || !/^[A-Za-z0-9]{22}$/.test(id)) {
    await bridge.writeAnalyzerResponse(req.id, { error: { code: "INVALID_TARGET", message: "This item could not be identified." } }).catch(() => {});
    return;
  }
  const days = Number.isFinite(req.days) ? Math.min(365, Math.max(7, Math.round(req.days))) : 30;
  const licensor = typeof req.licensorUuid === "string" && /^[a-f0-9]{32}$/.test(req.licensorUuid) ? req.licensorUuid : null;

  let payload;
  try {
    const url = `/api/analyzer/${kind}/${id}?days=${days}` + (licensor ? `&licensorUuid=${licensor}` : "");
    const json = await api("GET", url);
    payload = json?.error ? { error: json.error } : { payload: json };
  } catch (e) {
    payload = { error: { code: "PANEL_UNREACHABLE", message: "The Ocean panel is not reachable." } };
  }
  await bridge.writeAnalyzerResponse(req.id, payload).catch(() => {});
}

/**
 * Answer one queued playlist fetch by reading the tracks through the user's
 * own Spotify client (app tokens no longer receive playlist tracks at all).
 * One at a time — a playlist read is many renderer fetches.
 */
const playlistFetchesInFlight = new Set();
async function answerPlaylistFetch(reqInfo) {
  const requestId = String(reqInfo?.requestId ?? "");
  const playlistId = String(reqInfo?.playlistId ?? "");
  if (!requestId || playlistFetchesInFlight.size > 0 || playlistFetchesInFlight.has(requestId)) return;
  playlistFetchesInFlight.add(requestId);
  try {
    const r = await bridge.fetchPlaylistTracks(playlistId);
    await api("POST", "/api/connector/playlist-tracks", {
      requestId,
      items: r.items,
      total: r.total,
      playlistName: r.playlistName,
      viaPlatform: !!r.viaPlatform,
    });
    console.log("[bridge] playlist answered:", playlistId, `(${r.items.length} tracks)`);
  } catch (e) {
    await api("POST", "/api/connector/playlist-tracks", {
      requestId,
      error: e?.message || "The Spotify client could not read this playlist.",
    }).catch(() => {});
    console.warn("[bridge] playlist fetch failed for", playlistId, "-", e?.message || e);
  } finally {
    playlistFetchesInFlight.delete(requestId);
  }
}

let reconnecting = false;
let brokenLinkBeats = 0;
let lastAutoReconnectAt = 0;
/** Execute a panel-queued command (currently only "reconnect"). */
async function runBridgeCommand(cmd) {
  if (!cmd || cmd.action !== "reconnect" || reconnecting) return;
  reconnecting = true;
  try {
    const r = await bridge.launch();
    const online = r.ok && (await bridge.isConnected());
    await api("POST", "/api/connector/bridge-command", {
      completeId: cmd.id,
      ok: online,
      message: online ? null : (r.message || "Could not connect to Spotify."),
    }).catch(() => {});
  } finally {
    reconnecting = false;
    await reportBridgeStatus();
  }
}

function startBridgeLoops() {
  stopBridgeLoops();
  const poll = async () => {
    if (!(await ensurePaired())) return;
    // Panel-queued commands must run even while the bridge is down — that is
    // exactly when the user clicks "Connect to Spotify" in the panel.
    try {
      const c = await api("GET", "/api/connector/bridge-command?take=1");
      if (c?.command) runBridgeCommand(c.command);
    } catch { /* transient */ }
    if (!(await bridge.isConnected())) return; // Spotify closed or not debuggable
    try {
      const out = await api("GET", "/api/connector/pending");
      for (const id of out?.pendingTrackIds ?? []) answerPending(id);
      if (out?.playlistFetch) answerPlaylistFetch(out.playlistFetch);
    } catch { /* transient; next tick retries */ }
  };
  const beat = async () => {
    // Watchdog first: if the server we rely on (own or adopted) went away,
    // bring one back before anything else.
    if (!(await oceanPanelHealthy())) { console.warn("[bridge] Ocean panel server unhealthy, restarting it"); await ensureServer(); }
    if (!(await ensurePaired())) { console.warn("[bridge] not paired with server, skipping this heartbeat"); return; }
    const st = await reportBridgeStatus();
    lastKnownStatus = st;
    updateTrayStatus();
    // Heartbeat still means "lookups can actually be answered right now".
    if (st?.debuggable) { try { await api("POST", "/api/connector/heartbeat", {}); } catch { /* ignore */ } }
    // Self-heal the Spotify link: if Spotify keeps running without the CDP
    // flag (autostart raced us, or an update restarted it), relaunch it with
    // the flag — automatically, with a cooldown so a stubborn failure cannot
    // restart Spotify in a loop.
    if (st && st.spotifyRunning && !st.debuggable) {
      brokenLinkBeats++;
      if (brokenLinkBeats >= 3 && Date.now() - lastAutoReconnectAt > 30 * 60 * 1000 && !reconnecting) {
        lastAutoReconnectAt = Date.now();
        brokenLinkBeats = 0;
        console.log("[bridge] Spotify running without the app link — reconnecting automatically");
        reconnecting = true;
        try { await bridge.launch(); } catch { /* next beat re-evaluates */ }
        reconnecting = false;
        lastKnownStatus = await reportBridgeStatus();
        updateTrayStatus();
      }
    } else {
      brokenLinkBeats = 0;
    }
    // A Spotify self-update also wipes the Spicetify companion — repair it
    // automatically (guarded by its own cooldown; cheap FS checks otherwise).
    maybeRepairCompanion().catch(() => {});
  };
  // The analyzer pump runs on its own cadence: it must feel instant in the
  // Spotify UI, but it is a single cheap evaluate when nothing is pending.
  let pumping = false;
  const analyzerTick = async () => {
    if (pumping) return;
    pumping = true;
    try { if (await bridge.isConnected()) await pumpAnalyzer(); }
    catch { /* transient */ }
    finally { pumping = false; }
  };
  bridgeTimers = [setInterval(poll, 2000), setInterval(beat, 30000), setInterval(analyzerTick, 800)];
  ensurePaired().then(beat);
}

function stopBridgeLoops() {
  bridgeTimers.forEach(clearInterval);
  bridgeTimers = [];
}

async function connectSpotify() {
  const r = await bridge.launch();
  const online = r.ok && (await bridge.isConnected());
  await reportBridgeStatus();
  dialog.showMessageBox(win, {
    type: online ? "info" : "error",
    title: "Spotify connection",
    message: online
      ? (r.alreadyRunning ? "Already connected to Spotify." : "Connected — Spotify was restarted with the app link enabled.")
      : "Could not connect to Spotify.",
    detail: online
      ? "Paste a track URL in the panel and the distributor resolves automatically while Spotify stays open."
      : (r.message || "Start Spotify, then try again."),
  });
}

/**
 * Windows-login autostart can launch Spotify WITHOUT the CDP flag (it races
 * the entry patching). Fix it silently at startup — no dialogs, no questions:
 * the user asked for this to be fully automatic.
 */
async function autoConnectAtStartup() {
  try {
    if (await bridge.isConnected()) return;
    if (!(await bridge.isSpotifyRunning())) return; // don't force-start Spotify for the user
    console.log("[bridge] Spotify running without the app link at startup — reconnecting automatically");
    lastAutoReconnectAt = Date.now();
    reconnecting = true;
    try { await bridge.launch(); } finally { reconnecting = false; }
    await reportBridgeStatus();
  } catch { /* the beat-loop self-heal retries later */ }
}

// ── Spicetify companion installer ───────────────────────────
// Single implementation lives in scripts/install-spicetify.mjs; run it with
// the bundled Node runtime so the menu action, the CLI and the auto-repair
// watchdog stay identical.
function runCompanionInstaller(extraArgs = []) {
  const script = path.join(resourceRoot(), "scripts", "install-spicetify.mjs");
  const source = path.join(resourceRoot(), "spicetify", "distro-finder.js");
  const mapping = path.join(serverDir(), "json", "uuid's.json");
  return new Promise((resolve) => {
    const proc = utilityProcess.fork(script, ["--source", source, "--mapping", mapping, ...extraArgs], {
      stdio: "pipe",
      serviceName: "spicetify-installer",
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += String(d)));
    proc.stderr?.on("data", (d) => (output += String(d)));
    proc.on("exit", (code) => resolve({ code, output }));
  });
}

function installCompanion() {
  runCompanionInstaller().then(({ code, output }) => {
    dialog.showMessageBox(win, {
      type: code === 0 ? "info" : "error",
      title: "Spotify companion",
      message: code === 0 ? "Spotify companion installed with the current distributor mapping. Spotify will restart." : "Companion install failed.",
      detail: output.trim().slice(-1500),
    });
  });
}

// ── Companion watchdog ──────────────────────────────────────
// Spotify self-updates rewrite the client files (xpui.spa returns) and wipe
// the Spicetify patch: the right-click panel and the in-Spotify analyzer
// silently vanish. Detect that state and reinstall automatically — the user
// asked for the whole pipeline to work with zero manual steps.
function spotifyAppsDir() {
  return path.join(process.env.APPDATA || "", "Spotify", "Apps");
}

/** True only when the companion WAS installed here and a Spotify update wiped it. */
function companionWiped() {
  try {
    // Opt-in guard: never install on a machine where it was never set up.
    const everInstalled = fs.existsSync(path.join(process.env.APPDATA || "", "spicetify", "Extensions", "distro-finder.js"));
    if (!everInstalled) return false;
    const apps = spotifyAppsDir();
    if (!fs.existsSync(apps)) return false; // Spotify not installed
    // Patched state = extracted xpui folder carrying our extension and no
    // xpui.spa. An update restores an unpatched xpui.spa and/or drops the
    // extension file from the extracted folder.
    const spaRestored = fs.existsSync(path.join(apps, "xpui.spa"));
    const extensionPresent = fs.existsSync(path.join(apps, "xpui", "extensions", "distro-finder.js"));
    return spaRestored || !extensionPresent;
  } catch {
    return false;
  }
}

let repairingCompanion = false;
let lastCompanionRepairAt = 0;
let companionRepairFailures = 0;
async function maybeRepairCompanion() {
  if (repairingCompanion) return;
  if (companionRepairFailures >= 3) return; // a broken setup needs the menu action, not a loop
  if (Date.now() - lastCompanionRepairAt < 15 * 60 * 1000) return;
  if (!companionWiped()) { companionRepairFailures = 0; return; }
  repairingCompanion = true;
  lastCompanionRepairAt = Date.now();
  console.log("[companion] Spotify update wiped the Spicetify patch — reinstalling automatically");
  try {
    // Patch with Spotify stopped so no file is locked mid-write, then bring it
    // back with the app link enabled — same behavior as the existing
    // link self-heal, which already restarts Spotify automatically.
    const wasRunning = await bridge.isSpotifyRunning();
    if (wasRunning) await bridge.killSpotify();
    const { code, output } = await runCompanionInstaller(["--no-restart"]);
    if (code === 0) {
      companionRepairFailures = 0;
      console.log("[companion] repaired:", output.trim().split("\n").pop());
    } else {
      companionRepairFailures++;
      console.warn("[companion] auto-repair failed (exit", code + "):", output.trim().slice(-400));
    }
    if (wasRunning) {
      // Restart even if patching failed — never leave the user with Spotify closed.
      try { await bridge.launch(); } catch { /* beat self-heal retries */ }
      lastKnownStatus = await reportBridgeStatus();
      updateTrayStatus();
    }
  } finally {
    repairingCompanion = false;
  }
}

// ── Window ──────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    // Pure black to match the panel's single dark theme — no color flash
    // while the page loads.
    backgroundColor: "#000000",
    icon: nativeImage.createFromDataURL(TRAY_ICON_DATAURL),
    show: false,
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win.show());
  // External links open in the default browser, never inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(BASE);
  // If the panel can't be reached (server switching over, dev server just
  // closed), keep retrying until it is back — the user must never be left
  // staring at a dead error page.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: navigation superseded */) return;
    setTimeout(async () => {
      if (!win || app.isQuitting) return;
      await ensureServer().catch(() => {});
      win.loadURL(BASE);
    }, 2000);
  });
  // Closing the window hides it to the tray: the server, the bridge and the
  // in-Spotify analyzer keep working with no panel window open.
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => (win = null));
}

function showWindow() {
  if (win) {
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    createWindow();
  }
}

// A generated 16×16 dot keeps the tray free of asset files.
const TRAY_ICON_DATAURL =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#1db954"/><circle cx="8" cy="8" r="3" fill="#000"/></svg>'
  ).toString("base64");

// Same wording as the web panel's SystemStatusCard, so the tray/menu and the
// panel never disagree about the Spotify link state.
function bridgeStatusLabel() {
  if (!lastKnownStatus) return "Checking…";
  if (lastKnownStatus.debuggable) return "Connected";
  if (lastKnownStatus.spotifyRunning) return "Link inactive";
  return "Spotify closed";
}

function trayContextMenuTemplate() {
  return [
    { label: `Spotify: ${bridgeStatusLabel()}`, enabled: false },
    { type: "separator" },
    { label: "Open panel", click: showWindow },
    { label: "Connect to Spotify", click: connectSpotify },
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
  ];
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATAURL);
  tray = new Tray(icon);
  tray.on("double-click", showWindow);
  updateTrayStatus();
}

/** Called after every beat() tick — keeps the tray tooltip/menu and the app
 *  menu's Spotify status line in sync with the real bridge state. No
 *  separate polling: it just re-renders whatever beat() already computed. */
function updateTrayStatus() {
  if (tray) {
    tray.setToolTip(`Ocean Distro Finder — ${bridgeStatusLabel()}`);
    tray.setContextMenu(Menu.buildFromTemplate(trayContextMenuTemplate()));
  }
  if (Menu.getApplicationMenu()) buildMenu();
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "App",
        submenu: [
          { label: "Reload panel", accelerator: "CmdOrCtrl+R", click: () => win?.reload() },
          { label: "Open in browser", click: () => shell.openExternal(BASE) },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Spotify",
        submenu: [
          { label: `Status: ${bridgeStatusLabel()}`, enabled: false },
          { type: "separator" },
          { label: "Connect to Spotify (restarts it)", click: connectSpotify },
          { label: "Install right-click panel (Spicetify)", click: installCompanion },
          { type: "separator" },
          {
            label: "How it works",
            click: () =>
              dialog.showMessageBox(win, {
                type: "info",
                title: "How it works",
                message: "Two independent ways to read the distributor — both from your own Spotify client.",
                detail:
                  "1. Panel lookups: this app talks to the running Spotify desktop app and reads the " +
                  "licensor UUID from Spotify's own metadata response. Use “Connect to Spotify” once; " +
                  "no pairing code is needed.\n\n" +
                  "2. Right-click panel: the Spicetify companion shows the distributor inside Spotify " +
                  "itself, using the same canonical mapping embedded at install time.\n\n" +
                  "Your Spotify login, tokens and cookies are never read or sent anywhere.",
              }),
          },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
      },
    ])
  );
}

// ── Lifecycle ───────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(async () => {
    buildMenu();
    // The installed app starts with Windows so the whole pipeline (server +
    // Spotify link + analyzer pump) is up without anyone launching anything.
    if (app.isPackaged) {
      try { app.setLoginItemSettings({ openAtLogin: true, path: process.execPath }); } catch { /* best effort */ }
    }
    if (!(await ensureServer())) return app.quit();
    createWindow();
    createTray();
    startBridgeLoops();
    // Keep Spotify's autostart/shortcuts debuggable (idempotent, best effort) —
    // Spotify updates occasionally rewrite them.
    bridge.patchLaunchEntries().catch(() => {});
    autoConnectAtStartup();
    // If Spotify updated itself while this app was not running, the companion
    // is already gone at boot — check once right away, not only on the beat.
    maybeRepairCompanion().catch(() => {});
  });

  // Tray keeps the app alive with every window closed — quit comes from the
  // tray or app menu only.
  app.on("window-all-closed", () => { /* keep running in tray */ });
  app.on("before-quit", () => {
    app.isQuitting = true;
    stopBridgeLoops();
    tray?.destroy();
    serverProc?.kill();
  });
}
