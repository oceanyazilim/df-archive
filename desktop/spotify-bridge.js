// spotify-bridge.js — read track metadata straight from the running Spotify
// desktop client, no Spicetify companion and no pairing involved.
//
// How: Spotify is a Chromium app, so it exposes the DevTools protocol when
// started with --remote-debugging-port. The bridge attaches over a plain
// WebSocket (no puppeteer dependency), asks the renderer to perform ITS OWN
// authenticated metadata request, and receives the raw protobuf bytes as
// base64. Decoding and distributor resolution happen in this process.
//
// The session token stays inside the Spotify renderer: the evaluated snippet
// uses it for the client's own request and only the response body comes back.
// Nothing is uploaded anywhere.

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const PORT = Number(process.env.DISTRO_SPOTIFY_CDP_PORT || 9222);
const HOST = "127.0.0.1";

function spotifyExe() {
  const candidates = [
    path.join(process.env.APPDATA || "", "Spotify", "Spotify.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "Spotify.exe"),
    path.join(process.env.ProgramFiles || "", "Spotify", "Spotify.exe"),
    path.join(os.homedir(), "AppData", "Roaming", "Spotify", "Spotify.exe"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function getJson(pathname, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: pathname, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
  });
}

/** Is a debuggable Spotify renderer listening right now? */
async function isConnected() {
  try {
    const targets = await getJson("/json");
    return Array.isArray(targets) && targets.some((t) => t.type === "page" && String(t.url).includes("xpui"));
  } catch {
    return false;
  }
}

/** Is Spotify.exe running at all (debuggable or not)? */
function isSpotifyRunning() {
  return new Promise((resolve) => {
    const p = spawn("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/FO", "CSV", "/NH"], { windowsHide: true });
    let out = "";
    p.stdout?.on("data", (d) => (out += String(d)));
    p.on("exit", () => resolve(/Spotify\.exe/i.test(out)));
    p.on("error", () => resolve(false));
  });
}

/**
 * Make every way Spotify can start carry the CDP flag.
 *
 * The Start Menu shortcut was patched earlier, but Spotify's own login
 * autostart (HKCU\...\Run\Spotify → "--autostart --minimized") bypasses it, so
 * a reboot silently broke the bridge. Idempotent; safe to run on every app
 * start — Spotify updates may rewrite these entries.
 */
function patchLaunchEntries() {
  const flags = `--remote-debugging-port=${PORT} --remote-allow-origins=*`;
  const script = `
$flags = '${flags}'
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
try {
  $v = (Get-ItemProperty $run -Name Spotify -ErrorAction SilentlyContinue).Spotify
  if ($v -and $v -notmatch 'remote-debugging-port') { Set-ItemProperty $run -Name Spotify -Value ($v + ' ' + $flags) }
} catch {}
try {
  $ws = New-Object -ComObject WScript.Shell
  foreach ($p in @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Spotify.lnk", "$env:USERPROFILE\\Desktop\\Spotify.lnk")) {
    if (Test-Path $p) {
      $s = $ws.CreateShortcut($p)
      if ($s.TargetPath -match 'Spotify\\.exe' -and $s.Arguments -notmatch 'remote-debugging-port') {
        $s.Arguments = ($s.Arguments + ' ' + $flags).Trim(); $s.Save()
      }
    }
  }
} catch {}
`;
  return new Promise((resolve) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

/** Force-stop Spotify (used before patching its app files on disk). */
function killSpotify() {
  return new Promise((resolve) => {
    const k = spawn("taskkill", ["/F", "/IM", "Spotify.exe"], { windowsHide: true });
    k.on("exit", () => resolve(true));
    k.on("error", () => resolve(false));
  });
}

/** Restart Spotify with the debugging port enabled. Resolves once reachable. */
async function launch({ restart = true } = {}) {
  if (await isConnected()) return { ok: true, alreadyRunning: true };
  const exe = spotifyExe();
  if (!exe) return { ok: false, code: "SPOTIFY_NOT_FOUND", message: "Spotify desktop app was not found on this computer." };
  // Keep autostart/shortcuts debuggable so the link survives reboots and
  // Spotify's own restarts. Best effort — the direct spawn below is enough
  // for the current session either way.
  await patchLaunchEntries();

  if (restart) {
    await new Promise((resolve) => {
      const k = spawn("taskkill", ["/F", "/IM", "Spotify.exe"], { windowsHide: true });
      k.on("exit", resolve);
      k.on("error", resolve);
    });
    await new Promise((r) => setTimeout(r, 1500));
  }
  spawn(exe, [`--remote-debugging-port=${PORT}`, "--remote-allow-origins=*"], { detached: true, stdio: "ignore", windowsHide: false }).unref();

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isConnected()) return { ok: true, alreadyRunning: false };
    await new Promise((r) => setTimeout(r, 700));
  }
  return { ok: false, code: "SPOTIFY_TIMEOUT", message: "Spotify did not become reachable in time." };
}

// ── Tiny CDP client over a raw WebSocket (no external dependency) ──
// Only Runtime.evaluate is needed, so a minimal text-frame implementation of
// RFC 6455 is enough. Frames are small; continuation frames never occur here.
const crypto = require("crypto");
const net = require("net");

function cdpEvaluate(wsUrl, expression, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, val) => { if (!settled) { settled = true; try { sock.destroy(); } catch { /* closed */ } err ? reject(err) : resolve(val); } };
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect({ host: u.hostname, port: Number(u.port) }, () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${HOST}:${PORT}\r\n\r\n`
      );
    });
    const timer = setTimeout(() => done(new Error("CDP evaluate timed out")), timeoutMs);
    let handshakeDone = false;
    let buf = Buffer.alloc(0);

    const sendFrame = (text) => {
      const payload = Buffer.from(text, "utf8");
      const mask = crypto.randomBytes(4);
      const len = payload.length;
      let header;
      if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
      else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      sock.write(Buffer.concat([header, mask, masked]));
    };

    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString();
        if (!/HTTP\/1\.1 101/.test(head)) return done(new Error("CDP handshake refused: " + head.split("\r\n")[0]));
        buf = buf.subarray(end + 4);
        handshakeDone = true;
        sendFrame(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      }
      // Parse server frames (never masked).
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, offset = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
        if (buf.length < offset + len) return;
        const payload = buf.subarray(offset, offset + len);
        buf = buf.subarray(offset + len);
        if (opcode === 8) return done(new Error("CDP socket closed"));
        if (opcode !== 1) continue;
        let msg;
        try { msg = JSON.parse(payload.toString("utf8")); } catch { continue; }
        if (msg.id !== 1) continue;
        clearTimeout(timer);
        if (msg.error) return done(new Error(msg.error.message || "CDP error"));
        const r = msg.result?.result;
        if (msg.result?.exceptionDetails) return done(new Error(msg.result.exceptionDetails.text || "evaluate threw"));
        return done(null, r?.value);
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); done(e); });
    sock.on("close", () => { clearTimeout(timer); done(new Error("CDP socket closed")); });
  });
}

async function rendererTarget() {
  const targets = await getJson("/json");
  const page = targets.find((t) => t.type === "page" && String(t.url).includes("xpui"));
  if (!page?.webSocketDebuggerUrl) throw new Error("Spotify renderer is not debuggable — reconnect from the app menu.");
  return page.webSocketDebuggerUrl;
}

const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function base62ToGid(id) {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;
  let n = 0n;
  for (const ch of id) {
    const i = B62.indexOf(ch);
    if (i < 0) return null;
    n = n * 62n + BigInt(i);
  }
  return n.toString(16).padStart(32, "0");
}

/**
 * Fetch one track's metadata protobuf via the client's own session.
 * Returns a Buffer, or throws with a user-safe message.
 */
async function fetchTrackProtobuf(spotifyTrackId) {
  const gid = base62ToGid(spotifyTrackId);
  if (!gid) throw new Error("Invalid Spotify track id.");
  const wsUrl = await rendererTarget();
  // The snippet runs inside the renderer; the token never leaves it.
  const expression = `(async () => {
    try {
      // Platform.Session.accessToken goes stale after ~1h and is never
      // refreshed in place, which makes spclient answer 401. The client's own
      // token provider hands back a fresh one, so prefer it and fall back to
      // the session copy only if that entry point is missing.
      let token = null;
      try {
        const tp = Spicetify?.Platform?.AuthorizationAPI?._tokenProvider;
        if (tp && typeof tp.loadToken === "function") {
          const t = await tp.loadToken({ preferCached: false });
          token = t?.accessToken ?? null;
        }
      } catch (e) { /* fall through to the session copy */ }
      if (!token) token = Spicetify?.Platform?.Session?.accessToken ?? null;
      if (!token) return { ok: false, code: "NO_SESSION" };
      const res = await fetch("https://spclient.wg.spotify.com/metadata/4/track/${gid}", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) return { ok: false, code: "HTTP_" + res.status };
      const buf = new Uint8Array(await res.arrayBuffer());
      let s = ""; for (const b of buf) s += String.fromCharCode(b);
      return { ok: true, b64: btoa(s) };
    } catch (e) { return { ok: false, code: "FETCH_FAILED", detail: String(e && e.message || e).slice(0, 120) }; }
  })()`;
  // A burst of catalogue lookups can make spclient answer 401 even though the
  // session is valid — it is rate limiting, not a signed-out client. Back off
  // briefly and re-read the (possibly refreshed) token once before giving up.
  let out = await cdpEvaluate(wsUrl, expression);
  if (out && !out.ok && /^HTTP_(401|429)$/.test(String(out.code))) {
    await new Promise((r) => setTimeout(r, 1200));
    out = await cdpEvaluate(await rendererTarget(), expression);
  }
  if (!out || !out.ok) {
    const code = out?.code ?? "UNKNOWN";
    if (code === "NO_SESSION") throw new Error("Spotify is not signed in yet.");
    throw new Error("Spotify did not return metadata (" + code + ").");
  }
  return Buffer.from(out.b64, "base64");
}

/**
 * Read a playlist's tracks via the client's own Web API session, with paging.
 * Client-credentials app tokens no longer receive playlist tracks at all
 * (2026-08), but the user's client token still sees every playlist it can
 * open — including editorial ones. Returns { items, total, playlistName };
 * items are slim plain-JSON objects (never the raw response).
 */
async function fetchPlaylistTracks(playlistId, maxTracks = 1000) {
  if (!/^[A-Za-z0-9]{22}$/.test(playlistId)) throw new Error("Invalid Spotify playlist id.");
  const wsUrl = await rendererTarget();
  // The snippet runs inside the renderer; the token never leaves it.
  const expression = `(async () => {
    try {
      let token = null;
      try {
        const tp = Spicetify?.Platform?.AuthorizationAPI?._tokenProvider;
        if (tp && typeof tp.loadToken === "function") {
          const t = await tp.loadToken({ preferCached: false });
          token = t?.accessToken ?? null;
        }
      } catch (e) { /* fall through to the session copy */ }
      if (!token) token = Spicetify?.Platform?.Session?.accessToken ?? null;
      if (!token) return { ok: false, code: "NO_SESSION" };

      let name = null;
      try {
        const metaRes = await fetch("https://api.spotify.com/v1/playlists/${playlistId}?fields=name", { headers: { Authorization: "Bearer " + token } });
        if (metaRes.ok) name = (await metaRes.json()).name ?? null;
      } catch (e) { /* name is cosmetic */ }

      const items = [];
      let total = null;
      let url = "https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&market=from_token&additional_types=track";
      for (let page = 0; page < ${Math.ceil(maxTracks / 100)} && url; page++) {
        const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) return items.length ? { ok: true, partial: true, name, total, items } : { ok: false, code: "HTTP_" + res.status };
        const j = await res.json();
        total = typeof j.total === "number" ? j.total : total;
        for (const it of (j.items || [])) {
          const t = it && it.track;
          if (t && t.is_local) continue; // local files are not distribution
          if (!t) { items.push({ addedAt: it && it.added_at || null, gone: true }); continue; }
          items.push({
            addedAt: it.added_at || null,
            id: t.id || null,
            title: t.name || "",
            artists: (t.artists || []).map((a) => a && a.name).filter(Boolean),
            albumId: t.album && t.album.id || null,
            albumTitle: t.album && t.album.name || null,
            albumType: t.album && t.album.album_type || null,
            releaseDate: t.album && t.album.release_date || null,
            durationMs: typeof t.duration_ms === "number" ? t.duration_ms : null,
            discNumber: typeof t.disc_number === "number" ? t.disc_number : null,
            trackNumber: typeof t.track_number === "number" ? t.track_number : null,
            explicit: typeof t.explicit === "boolean" ? t.explicit : null,
            isrc: t.external_ids && t.external_ids.isrc || null,
            isPlayable: typeof t.is_playable === "boolean" ? t.is_playable : null,
            restriction: t.restrictions && t.restrictions.reason || null,
          });
          if (items.length >= ${maxTracks}) break;
        }
        url = items.length >= ${maxTracks} ? null : (j.next || null);
      }
      return { ok: true, name, total, items };
    } catch (e) { return { ok: false, code: "FETCH_FAILED", detail: String(e && e.message || e).slice(0, 120) }; }
  })()`;
  // The client's INTERNAL playlist API — independent of Web API rate limits
  // (they can throttle by IP for minutes at a time). No ISRC here, but the
  // resolve/recovery pipeline fills identifiers per track afterwards.
  const platformExpression = `(async () => {
    try {
      const api = Spicetify?.Platform?.PlaylistAPI;
      if (!api || typeof api.getContents !== "function") return { ok: false, code: "NO_PLAYLIST_API" };
      const meta = await (typeof api.getMetadata === "function"
        ? api.getMetadata("spotify:playlist:${playlistId}").catch(() => null)
        : null);
      const c = await api.getContents("spotify:playlist:${playlistId}");
      const raw = Array.isArray(c?.items) ? c.items : [];
      const items = [];
      for (const it of raw.slice(0, ${maxTracks})) {
        const uri = String(it?.uri || "");
        const m = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/);
        if (!m) { if (/^spotify:local:/.test(uri)) continue; items.push({ addedAt: it?.addedAt || null, gone: true }); continue; }
        const albumUri = String(it?.album?.uri || "");
        const am = albumUri.match(/^spotify:album:([A-Za-z0-9]{22})$/);
        items.push({
          addedAt: it?.addedAt || null,
          id: m[1],
          title: it?.name || "",
          artists: (it?.artists || []).map((a) => a && a.name).filter(Boolean),
          albumId: am ? am[1] : null,
          albumTitle: it?.album?.name || null,
          albumType: null,
          releaseDate: null,
          durationMs: it?.duration?.milliseconds ?? null,
          discNumber: null,
          trackNumber: null,
          explicit: typeof it?.isExplicit === "boolean" ? it.isExplicit : null,
          isrc: null,
          isPlayable: typeof it?.isPlayable === "boolean" ? it.isPlayable : null,
          restriction: null,
        });
      }
      const total = typeof c?.totalLength === "number" ? c.totalLength : items.length;
      return { ok: true, viaPlatform: true, name: (meta && meta.name) || null, total, items };
    } catch (e) { return { ok: false, code: "PLATFORM_FAILED", detail: String(e && e.message || e).slice(0, 120) }; }
  })()`;

  let out = await cdpEvaluate(wsUrl, expression, 60000);
  // 429 here is the Web API pacing this machine, not a broken session — retry
  // once after the advertised window, then switch to the internal API.
  if (out && !out.ok && String(out.code) === "HTTP_429") {
    await new Promise((r) => setTimeout(r, 8000));
    out = await cdpEvaluate(await rendererTarget(), expression, 60000);
    if (out && !out.ok && String(out.code) === "HTTP_429") {
      out = await cdpEvaluate(await rendererTarget(), platformExpression, 60000);
    }
  } else if (out && !out.ok && String(out.code) === "HTTP_401") {
    await new Promise((r) => setTimeout(r, 1200));
    out = await cdpEvaluate(await rendererTarget(), expression, 60000);
  }
  if (!out || !out.ok) {
    const code = out?.code ?? "UNKNOWN";
    if (code === "NO_SESSION") throw new Error("Spotify is not signed in yet.");
    if (code === "HTTP_404") throw new Error("This playlist was not found (deleted or private to another account).");
    if (code === "HTTP_429") throw new Error("Spotify is rate-limiting playlist reads right now — try again in a minute.");
    throw new Error("The Spotify client could not read this playlist (" + code + ").");
  }
  return { items: out.items || [], total: out.total ?? (out.items || []).length, playlistName: out.name ?? null, partial: !!out.partial, viaPlatform: !!out.viaPlatform };
}

// ── Analyzer channel ────────────────────────────────────────
// The Spotify renderer cannot reach a localhost server by any channel, so the
// in-app analyzer asks for data by parking a request on `window.__oceanAnalyzer`
// and this process delivers the answer back through the same object over CDP.
// Only plain JSON crosses; no token or credential is ever read from the page.

/** Read a pending analyzer request, or null. */
async function readAnalyzerRequest() {
  const wsUrl = await rendererTarget();
  const out = await cdpEvaluate(wsUrl, `(() => {
    try {
      const c = window.__oceanAnalyzer;
      if (!c || !c.req || c.req.served) return null;
      return JSON.stringify(c.req);
    } catch (e) { return null; }
  })()`, 8000);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

/** Deliver a response (or error) for one request id. */
async function writeAnalyzerResponse(requestId, payload) {
  const wsUrl = await rendererTarget();
  const json = JSON.stringify({ id: requestId, ...payload });
  // The literal is embedded as a JSON string, so nothing can break out of it.
  await cdpEvaluate(wsUrl, `(() => {
    try {
      const c = window.__oceanAnalyzer;
      if (!c) return false;
      if (c.req && c.req.id === ${JSON.stringify(requestId)}) c.req.served = true;
      c.res = JSON.parse(${JSON.stringify(json)});
      return true;
    } catch (e) { return false; }
  })()`, 8000);
}

module.exports = {
  isConnected, isSpotifyRunning, launch, killSpotify, patchLaunchEntries, fetchTrackProtobuf, fetchPlaylistTracks, spotifyExe, PORT,
  readAnalyzerRequest, writeAnalyzerResponse,
};
