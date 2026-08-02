// distro-finder.js — Ocean Distro Finder · Spicetify extension
//
//   right-click a track  →  read the licensor UUID from the Spotify desktop
//   client's OWN authenticated metadata response  →  resolve it against the
//   canonical distributor mapping  →  show a panel.
//
// Why it works this way (measured against the live client, 2026-07):
//   * `metadata/4/track/{gid}` ALWAYS answers protobuf
//     (content-type: vnd.spotify/metadata-track) — never JSON, whatever the
//     Accept header says. Cosmos' internal JSON.parse is what produced the
//     old "Unexpected token … is not valid JSON". So we read the raw bytes and
//     decode the two fields we need ourselves.
//   * CosmosAsync is unusable in current clients ("Resolver not found" even for
//     sp:// URLs), and the renderer cannot reach a localhost backend by ANY
//     channel (fetch / XHR / WebSocket / SSE / img are all blocked).
//     Therefore the mapping is embedded at install time and this extension
//     resolves the distributor entirely offline. Same canonical source
//     (json/uuid's.json), same exact-match rule, no network dependency.
//
// The session token is used only for the client's own metadata request and
// never leaves the client. Nothing is uploaded anywhere.

(function DistroFinder() {
  // The context-menu item constructor builds its icon through Spicetify's
  // React wrapper — on a fast startup that wrapper may not be captured yet
  // and construction dies with "Cannot read properties of undefined (reading
  // 'jsx')", killing the whole extension. Wait for ALL of it.
  if (
    !window.Spicetify?.ContextMenu ||
    !Spicetify?.Platform?.Session ||
    !Spicetify?.React ||
    !Spicetify?.ReactJSX
  ) {
    setTimeout(DistroFinder, 500);
    return;
  }

  // ── Canonical mapping, injected by the installer ──────────
  // Shape: { "<32-hex licensor uuid>": "<exact distributor name>" }.
  // Conflicting UUIDs are excluded upstream — never guessed here.
  const MAPPING = /*__ODF_MAPPING__*/ {};
  const MAPPING_BUILT_AT = /*__ODF_MAPPING_BUILT_AT__*/ "";

  const META_BASE = "https://spclient.wg.spotify.com/metadata/4/track/";
  const cache = new Map();

  function withTimeout(promise, ms, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out after " + Math.round(ms / 1000) + "s")), ms)),
    ]);
  }

  // ── base62 track id → 32-hex GID ─────────────────────────
  // Verified against the fixture: 5MH8rf9BdkrFlBEeaYkFZ3 → be172e79403e48edb9742d98baf252cd
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

  // ── Minimal protobuf reader (wire format only) ────────────
  // Field map of the track message, decoded from the live response:
  //   1  track gid            2  name              4  artist{1:gid,2:name}
  //   3  album{1:gid, 2:name, 17:cover_group{1:image{1:file_id,3:w}}, 25:licensor{1:uuid}}
  //   7  duration_ms         10 external_id{1:type,2:id}
  //   21 licensor{1:uuid}    24 original_audio{1:uuid}   ← 24 is NEVER the licensor
  function readVarint(b, i) {
    let r = 0, shift = 0, pos = i;
    while (pos < b.length) {
      const byte = b[pos++];
      r += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return [r, pos];
  }

  /** Decode one protobuf message into { fieldNumber: [values] }. */
  function decode(b) {
    const out = {};
    let i = 0;
    while (i < b.length) {
      const start = i;
      let key; [key, i] = readVarint(b, i);
      const field = key >>> 3, wire = key & 7;
      if (!field) break;
      let value;
      if (wire === 0) { [value, i] = readVarint(b, i); }
      else if (wire === 2) {
        let len; [len, i] = readVarint(b, i);
        if (i + len > b.length) break;
        value = b.subarray(i, i + len);
        i += len;
      } else if (wire === 5) { value = null; i += 4; }
      else if (wire === 1) { value = null; i += 8; }
      else break;
      (out[field] ||= []).push(value);
      if (i <= start) break;
    }
    return out;
  }

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const utf8 = (bytes) => new TextDecoder().decode(bytes);
  const sub = (msg, field) => (msg[field]?.[0] instanceof Uint8Array ? decode(msg[field][0]) : null);

  /**
   * Licensor UUID: track-level (field 21) first, album-level (3.25) fallback.
   * NEVER original_audio (24), gid (1), album gid (3.1), artist gid, or ISRC.
   */
  function extractLicensorUuid(track) {
    const pick = (m) => {
      const u = m?.[1]?.[0];
      return u instanceof Uint8Array && u.length === 16 ? hex(u) : null;
    };
    return pick(sub(track, 21)) ?? pick(sub(sub(track, 3) ?? {}, 25));
  }

  /** Turn the decoded protobuf into the display model the panel renders. */
  function toModel(track, trackId) {
    const album = sub(track, 3);
    let isrc = null;
    for (const raw of track[10] ?? []) {
      const e = decode(raw);
      const type = e[1]?.[0] instanceof Uint8Array ? utf8(e[1][0]) : "";
      if (type.toLowerCase() === "isrc" && e[2]?.[0] instanceof Uint8Array) { isrc = utf8(e[2][0]); break; }
    }
    const artists = (track[4] ?? []).map((raw) => {
      const a = decode(raw);
      return a[2]?.[0] instanceof Uint8Array ? utf8(a[2][0]) : null;
    }).filter(Boolean);

    // Largest cover image in album.cover_group.image[].
    let artworkUrl = "";
    const group = sub(album ?? {}, 17);
    if (group) {
      let best = null, bestW = -1;
      for (const raw of group[1] ?? []) {
        const img = decode(raw);
        const fileId = img[1]?.[0];
        const w = typeof img[3]?.[0] === "number" ? img[3][0] : 0;
        if (fileId instanceof Uint8Array && w > bestW) { best = fileId; bestW = w; }
      }
      if (best) artworkUrl = "https://i.scdn.co/image/" + hex(best);
    }

    return {
      trackId,
      name: track[2]?.[0] instanceof Uint8Array ? utf8(track[2][0]) : "",
      artist: artists.join(", "),
      album: album?.[2]?.[0] instanceof Uint8Array ? utf8(album[2][0]) : "",
      isrc,
      durationMs: typeof track[7]?.[0] === "number" ? track[7][0] : null,
      artworkUrl,
      licensorUuid: extractLicensorUuid(track),
    };
  }

  // ── Fetch the client's own metadata (protobuf) ────────────
  /**
   * A currently-valid session token.
   *
   * `Platform.Session.accessToken` is a snapshot that goes stale after about an
   * hour and is never refreshed in place — spclient then answers 401. The
   * client's own token provider returns a fresh token, so ask it first.
   */
  async function sessionToken() {
    try {
      const tp = Spicetify?.Platform?.AuthorizationAPI?._tokenProvider;
      if (tp && typeof tp.loadToken === "function") {
        const t = await tp.loadToken({ preferCached: false });
        if (t?.accessToken) return t.accessToken;
      }
    } catch (e) { /* fall back to the session copy */ }
    return Spicetify?.Platform?.Session?.accessToken ?? null;
  }

  async function fetchTrackMetadata(gid) {
    console.log("[Metadata] Request started");
    const token = await sessionToken();
    if (!token) { console.warn("[Metadata] Invalid response format — no client session"); return null; }
    let res;
    try {
      res = await withTimeout(fetch(META_BASE + gid, { headers: { Authorization: "Bearer " + token } }), 10000, "Metadata request");
    } catch (e) {
      console.warn("[Metadata] Invalid response format —", e?.message || e);
      return null;
    }
    if (!res.ok) { console.warn("[Metadata] Invalid response format — HTTP " + res.status); return null; }
    let track;
    try {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 8) { console.warn("[Metadata] Invalid response format — empty body"); return null; }
      track = decode(bytes);
    } catch (e) {
      console.warn("[Metadata] Invalid response format —", e?.message || e);
      return null;
    }
    // Shape check: a real track message always carries a 16-byte gid in field 1.
    if (!(track[1]?.[0] instanceof Uint8Array) || track[1][0].length !== 16) {
      console.warn("[Metadata] Invalid response format — unexpected message shape");
      return null;
    }
    console.log("[Metadata] Response received");
    return track;
  }

  // ── Distributor: exact match against the embedded mapping ──
  function resolveDistributor(licensorUuid) {
    if (!licensorUuid) return { distributor: null, licensorUuid: null, status: "uuid_unavailable" };
    const norm = String(licensorUuid).trim().toLowerCase().replace(/-/g, "");
    if (!/^[a-f0-9]{32}$/.test(norm)) return { distributor: null, licensorUuid: null, status: "invalid_uuid" };
    if (!Object.keys(MAPPING).length) return { distributor: null, licensorUuid: norm, status: "mapping_unavailable" };
    const name = MAPPING[norm];
    return name
      ? { distributor: name, licensorUuid: norm, status: "verified" }
      : { distributor: null, licensorUuid: norm, status: "uuid_not_mapped" };
  }

  async function analyze(trackId, onStep) {
    const cached = cache.get(trackId);
    if (cached) return cached;
    if (onStep) onStep("Reading track metadata…");

    const gid = base62ToGid(trackId);
    if (!gid) throw new Error("This does not look like a Spotify track.");

    const track = await fetchTrackMetadata(gid);
    if (!track) throw new Error("Track metadata is unavailable right now.");

    const model = toModel(track, trackId);
    const resolved = resolveDistributor(model.licensorUuid);
    console.log(resolved.distributor ? "[Metadata] Distributor resolved" : "[Metadata] Distributor unavailable");

    const data = { ...model, ...resolved };
    cache.set(trackId, data);
    return data;
  }

  // ── Styles — Spotify look: black card, green labels, white values ──
  const style = document.createElement("style");
  style.textContent = `
    #odf-panel { position: fixed; top: 50%; right: 24px; transform: translateY(-50%);
      background: #000; border: 1px solid #282828;
      border-radius: 12px; width: 300px; z-index: 9999; box-shadow: 0 16px 48px rgba(0,0,0,.8);
      display: none; overflow: hidden; font-family: var(--font-family, "CircularSp", inherit); }
    #odf-panel.open { display: block; }
    #odf-head { display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; background: #000; border-bottom: 1px solid #1f1f1f; }
    #odf-head b { font-size: 14px; font-weight: 800; color: #1db954; letter-spacing: .2px; }
    #odf-close { background: none; border: none; color: #b3b3b3;
      cursor: pointer; font-size: 15px; line-height: 1; }
    #odf-close:hover { color: #fff; }
    #odf-art { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: #121212; }
    #odf-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #odf-art .ov { position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 16px 12px;
      background: linear-gradient(transparent, rgba(0,0,0,.92)); }
    #odf-art .nm { font-size: 15px; font-weight: 700; color: #fff; margin: 0 0 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #odf-art .ar { font-size: 12px; color: #b3b3b3; margin: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #odf-body { padding: 12px 16px 16px; background: #000; }
    .odf-row { display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid #1a1a1a; font-size: 12px; }
    .odf-row:last-child { border-bottom: none; }
    .odf-k { color: #1db954; font-weight: 700; flex-shrink: 0; }
    .odf-v { color: #fff; font-size: 11.5px; text-align: right; word-break: break-all;
      font-variant-numeric: tabular-nums; }
    .odf-v.ok { color: #fff; font-weight: 700; }
    .odf-v.warn { color: #e0a458; }
    .odf-v.muted { color: #b3b3b3; }
    .odf-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
    .odf-badge.ok { color: #000; background: #1db954; }
    .odf-badge.warn { color: #000; background: #e0a458; }
    .odf-badge.muted { color: #b3b3b3; background: #1f1f1f; }
    .odf-status { padding: 26px 16px; text-align: center; font-size: 13px; color: #b3b3b3; background: #000; }
    .odf-retry { margin-top: 12px; width: 100%; padding: 9px; border-radius: 999px; border: none;
      background: #1db954; color: #000; font-weight: 700; font-size: 12px; cursor: pointer; }
    .odf-retry:hover { background: #1ed760; }
  `;
  document.head.appendChild(style);

  // ── Panel ────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = "odf-panel";
  panel.innerHTML = `
    <div id="odf-head"><b>🌊 Ocean Distro Finder</b><button id="odf-close" title="Close">✕</button></div>
    <div id="odf-content"><div class="odf-status">Select a track…</div></div>`;
  document.body.appendChild(panel);
  panel.querySelector("#odf-close").addEventListener("click", () => panel.classList.remove("open"));

  function setContent(html) { panel.querySelector("#odf-content").innerHTML = html; }

  function fmtDuration(ms) {
    if (!ms) return "N/A";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // One clear distributor line + one status badge (never repeated messages).
  function distPresentation(d) {
    switch (d.status) {
      case "verified": return { dist: d.distributor, distCls: "ok", badge: "Verified", badgeCls: "ok" };
      case "uuid_not_mapped": return { dist: "Unknown distributor", distCls: "warn", badge: "UUID not mapped", badgeCls: "warn" };
      case "invalid_uuid": return { dist: "Unknown distributor", distCls: "muted", badge: "Invalid UUID", badgeCls: "warn" };
      case "mapping_unavailable": return { dist: "Data unavailable", distCls: "muted", badge: "Mapping missing", badgeCls: "muted" };
      default: return { dist: "Unknown distributor", distCls: "muted", badge: "No licensor UUID", badgeCls: "muted" };
    }
  }

  function render(d) {
    const p = distPresentation(d);
    const rows = [
      ["Distributor", escapeHtml(p.dist), p.distCls],
      ["Status", `<span class="odf-badge ${p.badgeCls}">${p.badge}</span>`, ""],
      ["Licensor UUID", d.licensorUuid || "N/A", d.licensorUuid ? "" : "muted"],
      ["ISRC", escapeHtml(d.isrc || "N/A"), ""],
      ["Album", escapeHtml(d.album || "N/A"), ""],
      ["Duration", fmtDuration(d.durationMs), ""],
    ].map(([k, v, cls]) => `<div class="odf-row"><span class="odf-k">${k}</span><span class="odf-v ${cls}">${v}</span></div>`).join("");

    setContent(`
      <div id="odf-art">
        ${d.artworkUrl ? `<img src="${d.artworkUrl}" alt="" />` : ""}
        <div class="ov">
          <p class="nm">${escapeHtml(d.name)}</p>
          <p class="ar">${escapeHtml(d.artist)}</p>
        </div>
      </div>
      <div id="odf-body">${rows}</div>`);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function showTrack(trackId) {
    panel.classList.add("open");
    const step = (t) => setContent(`<div class="odf-status">${escapeHtml(t)}</div>`);
    step("Reading track metadata…");
    try {
      render(await analyze(trackId, step));
    } catch (err) {
      setContent(`<div class="odf-status" style="color:#e05555">⚠️ ${escapeHtml(err.message || "Lookup failed")}
        <button class="odf-retry" id="odf-retry">Retry</button></div>`);
      const btn = panel.querySelector("#odf-retry");
      if (btn) btn.addEventListener("click", () => { cache.delete(trackId); showTrack(trackId); });
    }
  }

  // ═══ Ocean Analyzer ═══════════════════════════════════════
  // A full analysis window inside Spotify itself. Track identity, ISRC and the
  // distributor are resolved locally and appear immediately; streaming
  // analytics arrive through the desktop app, which is the only component that
  // can reach the panel service (this renderer cannot open ANY localhost
  // connection). Without the desktop app the modal still shows everything it
  // can compute locally and says plainly what is missing.

  var analyzerBridge = (function () {
    var pending = new Map();
    var seq = 0;
    var poller = null;

    function ensureChannel() {
      if (!window.__oceanAnalyzer) window.__oceanAnalyzer = { req: null, res: null };
      return window.__oceanAnalyzer;
    }

    function startPolling() {
      if (poller) return;
      poller = setInterval(function () {
        var c = ensureChannel();
        if (!c.res) return;
        var res = c.res;
        c.res = null;
        var waiter = pending.get(res.id);
        if (!waiter) return;
        pending.delete(res.id);
        clearTimeout(waiter.timer);
        if (!pending.size) { clearInterval(poller); poller = null; }
        waiter.resolve(res);
      }, 200);
    }

    /**
     * Ask the desktop app for one analyzer target.
     * Resolves with { payload } or { error } — never rejects.
     */
    function request(kind, spotifyId, opts) {
      opts = opts || {};
      var c = ensureChannel();
      var id = "oa" + (++seq) + "_" + String(Date.now());
      c.req = { id: id, kind: kind, spotifyId: spotifyId, days: opts.days || 30, licensorUuid: opts.licensorUuid || null, served: false };
      c.res = null;
      startPolling();
      return new Promise(function (resolve) {
        var timer = setTimeout(function () {
          pending.delete(id);
          if (!pending.size && poller) { clearInterval(poller); poller = null; }
          resolve({ error: { code: "DESKTOP_APP_OFFLINE", message: "Ocean Distro Finder desktop app is not connected." } });
        }, 12000);
        pending.set(id, { resolve: resolve, timer: timer });
      });
    }

    return { request: request };
  })();

  // ── Analyzer styles (scoped by the #oa- prefix) ───────────
  var analyzerStyle = document.createElement("style");
  analyzerStyle.textContent = `
    #oa-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.72);
      display: none; align-items: center; justify-content: center; padding: 3vh 2vw; }
    #oa-overlay.open { display: flex; }
    #oa-modal { width: min(1120px, 82vw); max-height: 92vh; background: #121212; color: #fff;
      border: 1px solid #282828; border-radius: 10px; box-shadow: 0 24px 80px rgba(0,0,0,.8);
      display: flex; flex-direction: column; overflow: hidden; font-family: var(--font-family, "CircularSp", inherit); }
    #oa-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: 18px 22px 14px; border-bottom: 1px solid #232323; }
    #oa-head h2 { font-size: 19px; font-weight: 700; margin: 0; color: #fff; }
    #oa-sub { font-size: 12px; color: #b3b3b3; margin: 3px 0 0; }
    #oa-back { background: none; border: none; color: #1db954; font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
    #oa-back:hover { text-decoration: underline; }
    #oa-close { background: none; border: none; color: #b3b3b3; font-size: 21px; cursor: pointer;
      line-height: 1; padding: 2px 7px; border-radius: 50%; }
    #oa-close:hover { color: #fff; background: #242424; }
    #oa-identity { display: flex; gap: 16px; padding: 16px 22px; border-bottom: 1px solid #232323; align-items: center; }
    #oa-identity img, .oa-art-ph { width: 84px; height: 84px; border-radius: 6px; object-fit: cover; background: #242424; flex-shrink: 0; }
    .oa-art-ph { display: grid; place-items: center; color: #6a6a6a; font-size: 26px; }
    .oa-name { font-size: 20px; font-weight: 700; margin: 0 0 2px; overflow-wrap: anywhere; }
    .oa-subline { font-size: 13px; color: #b3b3b3; margin: 0; overflow-wrap: anywhere; }
    .oa-facts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 11.5px; color: #a7a7a7; }
    .oa-facts b { color: #fff; font-weight: 600; }
    #oa-tabs { display: flex; gap: 2px; padding: 0 22px; border-bottom: 1px solid #232323; overflow-x: auto; }
    .oa-tab { background: none; border: none; border-bottom: 2px solid transparent; color: #b3b3b3;
      font: inherit; font-size: 12.5px; padding: 11px 12px; cursor: pointer; white-space: nowrap; }
    .oa-tab:hover { color: #fff; }
    .oa-tab.active { color: #fff; border-bottom-color: #1db954; }
    #oa-body { padding: 18px 22px 22px; overflow-y: auto; flex: 1; }
    .oa-hero { background: linear-gradient(135deg, rgba(29,185,84,.16), rgba(29,185,84,.04));
      border: 1px solid rgba(29,185,84,.28); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
    .oa-hero .lbl { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: #1db954; font-weight: 700; }
    .oa-hero .val { font-size: 38px; font-weight: 750; margin: 6px 0 2px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .oa-hero .sub { font-size: 12.5px; color: #b3b3b3; }
    .oa-hero.empty { background: #181818; border-color: #282828; }
    .oa-hero.empty .lbl { color: #b3b3b3; }
    .oa-hero.empty .val { font-size: 19px; font-weight: 600; color: #d6d6d6; }
    .oa-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px,1fr)); gap: 10px; margin-bottom: 16px; }
    .oa-card { background: #181818; border: 1px solid #262626; border-radius: 8px; padding: 12px 14px; }
    .oa-card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #a7a7a7; }
    .oa-card .v { font-size: 20px; font-weight: 680; margin-top: 5px; font-variant-numeric: tabular-nums; }
    .oa-card .v.muted { font-size: 13px; font-weight: 500; color: #8b8b8b; }
    .oa-card .s { font-size: 11px; color: #8b8b8b; margin-top: 2px; }
    .oa-up { color: #1db954 } .oa-down { color: #e0525b }
    .oa-chart-panel { background: #181818; border: 1px solid #262626; border-radius: 8px; padding: 14px 16px 10px; margin-bottom: 16px; }
    .oa-chart-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; align-items: flex-start; }
    .oa-chart-head h4 { font-size: 13px; font-weight: 650; margin: 0; }
    .oa-chart-head p { font-size: 11px; color: #8b8b8b; margin: 2px 0 0; }
    .oa-seg { display: inline-flex; background: #0f0f0f; border: 1px solid #2b2b2b; border-radius: 999px; padding: 2px; margin-left: 6px; }
    .oa-seg button { background: none; border: none; color: #a7a7a7; font: inherit; font-size: 11px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
    .oa-seg button.active { background: #1db954; color: #000; font-weight: 700; }
    .oa-chart-wrap { position: relative; }
    .oa-svg { width: 100%; height: 280px; display: block; }
    .oa-grid { stroke: #232323; stroke-width: 1 }
    .oa-axis { fill: #6f6f6f; font-size: 10px }
    .oa-line { fill: none; stroke: #1db954; stroke-width: 2.2 }
    .oa-areaf { fill: url(#oaGrad) }
    .oa-barr { fill: #1db954; opacity: .85 }
    .oa-tip { position: absolute; background: #0a0a0a; border: 1px solid #333; border-radius: 6px;
      padding: 7px 10px; pointer-events: none; min-width: 150px; display: none; }
    .oa-tip .d { font-size: 10.5px; color: #a7a7a7 }
    .oa-tip .v { font-size: 13px; font-weight: 650; margin-top: 2px; font-variant-numeric: tabular-nums }
    .oa-table-wrap { overflow-x: auto; border: 1px solid #262626; border-radius: 8px; }
    table.oa-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .oa-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em;
      color: #a7a7a7; font-weight: 600; padding: 9px 12px; background: #181818; border-bottom: 1px solid #262626; white-space: nowrap; }
    .oa-table td { padding: 9px 12px; border-bottom: 1px solid #1e1e1e; color: #ddd; font-variant-numeric: tabular-nums; }
    .oa-table tr.click { cursor: pointer }
    .oa-table tr.click:hover td { background: #1c1c1c; color: #fff }
    .oa-ell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .oa-kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px,1fr)); gap: 10px 20px; }
    .oa-kv-item { border-bottom: 1px solid #1e1e1e; padding-bottom: 8px; min-width: 0; }
    .oa-kv-item .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: #a7a7a7;
      display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .oa-kv-item .v { font-size: 12.5px; margin-top: 3px; overflow-wrap: anywhere; }
    .oa-kv-item .v.mono { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; }
    .oa-copy { background: none; border: none; color: #7a7a7a; cursor: pointer; font: inherit; font-size: 10px; padding: 1px 5px; border-radius: 3px; }
    .oa-copy:hover { color: #1db954; background: #1e1e1e }
    .oa-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px,1fr)); gap: 8px; }
    .oa-link { display: flex; align-items: center; gap: 9px; padding: 9px 12px; background: #181818;
      border: 1px solid #262626; border-radius: 8px; color: #ddd; text-decoration: none; font-size: 12px; cursor: pointer; }
    .oa-link:hover { background: #1f1f1f; color: #fff }
    .oa-link .ico { width: 20px; height: 20px; border-radius: 4px; background: #2a2a2a; display: grid;
      place-items: center; font-size: 10px; font-weight: 700; color: #1db954; flex-shrink: 0 }
    .oa-badge { display: inline-block; font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; vertical-align: middle; }
    .oa-badge.ok { background: #1db954; color: #000 } .oa-badge.warn { background: #e0a458; color: #000 }
    .oa-badge.muted { background: #2a2a2a; color: #b3b3b3 }
    .oa-empty { padding: 34px 16px; text-align: center; color: #8b8b8b; font-size: 12.5px;
      background: #181818; border: 1px solid #262626; border-radius: 8px; }
    .oa-empty .hint { font-size: 11.5px; color: #6f6f6f; margin-top: 5px; }
    .oa-retry2 { margin-top: 12px; background: #1db954; color: #000; border: none; border-radius: 999px;
      padding: 7px 18px; font: inherit; font-weight: 700; font-size: 11.5px; cursor: pointer; }
    .oa-skel { background: linear-gradient(90deg,#1c1c1c 25%,#242424 37%,#1c1c1c 63%); background-size: 400% 100%;
      animation: oaShim 1.3s ease-in-out infinite; border-radius: 6px; }
    @keyframes oaShim { 0% { background-position: 100% 50% } 100% { background-position: 0 50% } }
    #oa-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 22px; border-top: 1px solid #232323; background: #141414; flex-wrap: wrap; }
    #oa-foot .src { font-size: 11px; color: #7a7a7a }
    .oa-btn { background: #242424; border: 1px solid #333; color: #fff; border-radius: 999px;
      padding: 7px 16px; font: inherit; font-size: 11.5px; cursor: pointer; }
    .oa-btn:hover { background: #2e2e2e }
    .oa-btn.primary { background: #1db954; border-color: #1db954; color: #000; font-weight: 700 }
  `;
  document.head.appendChild(analyzerStyle);

  // ── Analyzer modal ────────────────────────────────────────
  var analyzer = (function () {
    var LOCALE = navigator.language || undefined;
    var TAB_SETS = {
      track: ["overview", "streams", "metadata", "links"],
      album: ["overview", "tracks", "metadata"],
      artist: ["overview", "releases"],
      playlist: ["overview", "tracks"],
    };
    var TAB_LABELS = { overview: "Overview", streams: "Streams", metadata: "Metadata", links: "Links", tracks: "Tracks", releases: "Releases" };
    var KIND_SUB = { track: "Track Analytics", album: "Album Analytics", artist: "Artist Analytics", playlist: "Playlist Analytics" };

    var state = { target: null, local: null, remote: null, error: null, tab: "overview", days: 30, chartView: "daily", chartType: "area", stack: [], token: 0 };
    var overlay, modalEl, bodyEl, subEl, headEl, identityEl, tabsEl, footEl;

    function el(tag, attrs, kids) {
      var n = document.createElement(tag);
      attrs = attrs || {};
      for (var k in attrs) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
      }
      (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
      return n;
    }
    function nfmt(n) { return typeof n === "number" && isFinite(n) ? n.toLocaleString(LOCALE) : null; }
    function dfmt(iso) { if (!iso) return null; var d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(LOCALE, { year: "numeric", month: "short", day: "numeric" }); }
    function compact(n) {
      var a = Math.abs(n);
      if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(Math.round(n));
    }
    function sum(pts) { return (pts || []).reduce(function (a, p) { return a + p.value; }, 0); }

    function card(k, v, s, tone) {
      return el("div", { class: "oa-card" }, [
        el("div", { class: "k", text: k }),
        el("div", { class: "v" + (v === null ? " muted" : "") + (tone ? " oa-" + tone : ""), text: v === null ? "Unavailable" : v }),
        s ? el("div", { class: "s", text: s }) : null,
      ]);
    }
    function kvItem(k, v, mono) {
      var has = v !== null && v !== undefined && v !== "";
      return el("div", { class: "oa-kv-item" }, [
        el("div", { class: "k" }, [
          el("span", { text: k }),
          has ? el("button", {
            class: "oa-copy", text: "Copy",
            onclick: function (e) {
              var b = e.currentTarget;
              Spicetify.Platform?.ClipboardAPI?.copy?.(String(v));
              b.textContent = "Copied";
              setTimeout(function () { b.textContent = "Copy"; }, 1200);
            },
          }) : null,
        ]),
        el("div", { class: "v" + (mono ? " mono" : ""), text: has ? String(v) : "—" }),
      ]);
    }
    function emptyBox(msg, hint, onRetry) {
      return el("div", { class: "oa-empty" }, [
        el("div", { text: msg }),
        hint ? el("div", { class: "hint", text: hint }) : null,
        onRetry ? el("button", { class: "oa-retry2", text: "Retry", onclick: onRetry }) : null,
      ]);
    }

    function build() {
      bodyEl = el("div", { id: "oa-body" });
      subEl = el("div", { id: "oa-sub" });
      identityEl = el("div", { id: "oa-identity" });
      tabsEl = el("div", { id: "oa-tabs" });
      footEl = el("div", { id: "oa-foot" });
      headEl = el("div", { id: "oa-head" }, [
        el("div", {}, [el("h2", { text: "Ocean Analyzer" }), subEl]),
        el("button", { id: "oa-close", text: "✕", title: "Close (Esc)", onclick: close }),
      ]);
      modalEl = el("div", { id: "oa-modal" }, [headEl, identityEl, tabsEl, bodyEl, footEl]);
      overlay = el("div", { id: "oa-overlay" }, [modalEl]);
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
      document.body.appendChild(overlay);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay.classList.contains("open")) { e.stopPropagation(); close(); }
      }, true);
    }

    function open(target) {
      if (!overlay) build();
      state.stack = [];
      overlay.classList.add("open");
      load(target);
    }
    function close() {
      if (overlay) overlay.classList.remove("open");
      state.token++; // orphan any in-flight load
    }

    function load(target) {
      var token = ++state.token;
      state.target = target;
      state.local = null;
      state.remote = null;
      state.error = null;
      state.tab = "overview";
      render();

      // Tracks resolve locally first so the window is useful instantly.
      if (target.kind === "track") {
        analyze(target.id).then(function (d) {
          if (token !== state.token) return;
          state.local = d;
          render();
          requestRemote(token, d.licensorUuid);
        }).catch(function (e) {
          if (token !== state.token) return;
          state.error = { message: e && e.message ? e.message : "Track metadata is unavailable right now." };
          render();
          requestRemote(token, null);
        });
      } else {
        requestRemote(token, null);
      }
    }

    function requestRemote(token, licensorUuid) {
      analyzerBridge.request(state.target.kind, state.target.id, { days: state.days, licensorUuid: licensorUuid })
        .then(function (res) {
          if (token !== state.token) return;
          if (res && res.payload) state.remote = res.payload;
          else state.remote = { __error: (res && res.error) || { message: "No response." } };
          render();
        });
    }

    function drillTo(target) {
      if (state.target) state.stack.push(state.target);
      var stack = state.stack;
      load(target);
      state.stack = stack;
    }

    function render() {
      var t = state.target || {};
      var remote = state.remote && !state.remote.__error ? state.remote.data : null;
      var kind = (remote && remote.kind) || t.kind || "track";

      // header
      subEl.textContent = "";
      if (state.stack.length) {
        subEl.appendChild(el("button", {
          id: "oa-back", text: "← Back",
          onclick: function () { var prev = state.stack.pop(); var s = state.stack; load(prev); state.stack = s; },
        }));
        subEl.appendChild(document.createTextNode(" · " + (KIND_SUB[kind] || "Analytics")));
      } else {
        subEl.textContent = KIND_SUB[kind] || "Analytics";
      }

      renderIdentity(kind, remote);

      // tabs
      var tabs = TAB_SETS[kind] || TAB_SETS.track;
      if (tabs.indexOf(state.tab) === -1) state.tab = tabs[0];
      tabsEl.textContent = "";
      tabs.forEach(function (id) {
        tabsEl.appendChild(el("button", {
          class: "oa-tab" + (state.tab === id ? " active" : ""), text: TAB_LABELS[id] || id,
          onclick: function () { state.tab = id; render(); },
        }));
      });

      // body
      bodyEl.textContent = "";
      if (kind === "track") renderTrack(remote);
      else renderRemoteKind(kind, remote);

      // footer
      footEl.textContent = "";
      var sourceBits = [];
      if (state.local || remote) sourceBits.push("Spotify");
      if (remote && remote.streams && remote.streams.state === "available") sourceBits.push("Soundcharts");
      footEl.appendChild(el("div", { class: "src", text: "Source: " + (sourceBits.length ? sourceBits.join(" + ") : "—") }));
      footEl.appendChild(el("div", {}, [
        el("button", {
          class: "oa-btn primary", text: "Open Full Dashboard",
          onclick: function () {
            var url = "https://open.spotify.com/" + (state.target.kind) + "/" + state.target.id;
            // The desktop app owns the panel; hand it the target through the
            // same channel rather than opening a browser window blindly.
            analyzerBridge.request("dashboard", state.target.id, { days: state.days });
            Spicetify.showNotification("Opening in the Ocean panel…");
            void url;
          },
        }),
      ]));
    }

    function renderIdentity(kind, remote) {
      identityEl.textContent = "";
      var local = state.local;
      var art = (local && local.artworkUrl) || (remote && (remote.artworkUrl || remote.imageUrl)) || (state.target.hint && state.target.hint.artworkUrl) || "";
      var name = (local && local.name) || (remote && (remote.title || remote.name)) || (state.target.hint && state.target.hint.title) || "Loading…";
      var sub = "", facts = [];

      if (kind === "track") {
        sub = (local && local.artist) || (remote && (remote.artists || []).map(function (a) { return a.name; }).join(", ")) || "";
        var album = (local && local.album) || (remote && remote.albumTitle);
        if (album) sub += (sub ? " · " : "") + album;
        var dur = (local && local.durationMs) || (remote && remote.durationMs);
        if (dur) facts.push(["Duration", fmtDuration(dur)]);
        var rel = remote && remote.releaseDate;
        if (rel) facts.push(["Released", dfmt(rel)]);
        var isrc = (local && local.isrc) || (remote && remote.isrc);
        if (isrc) facts.push(["ISRC", isrc]);
        var dist = local && local.status === "verified" ? local.distributor
          : (remote && remote.distributor && remote.distributor.status === "verified" ? remote.distributor.name : "Unknown distributor");
        facts.push(["Distributor", dist]);
      } else if (kind === "album" && remote) {
        sub = (remote.artists || []).map(function (a) { return a.name; }).join(", ");
        facts.push(["Tracks", String(remote.totalTracks)]);
        if (remote.releaseDate) facts.push(["Released", dfmt(remote.releaseDate)]);
        if (remote.label) facts.push(["Label", remote.label]);
      } else if (kind === "artist" && remote) {
        sub = (remote.genres || []).slice(0, 3).join(", ");
        facts.push(["Releases", String((remote.releases || []).length)]);
      } else if (kind === "playlist" && remote) {
        sub = remote.owner ? "by " + remote.owner : "";
        facts.push(["Tracks", String(remote.totalTracks)]);
        if (remote.followers !== null && remote.followers !== undefined) facts.push(["Followers", nfmt(remote.followers)]);
      }

      identityEl.appendChild(art ? el("img", { src: art, alt: "" }) : el("div", { class: "oa-art-ph", text: "♪" }));
      var factNodes = facts.filter(function (f) { return f[1]; }).map(function (f) {
        return el("span", {}, [document.createTextNode(f[0] + ": "), el("b", { text: f[1] })]);
      });
      identityEl.appendChild(el("div", { style: "min-width:0;flex:1" }, [
        el("p", { class: "oa-name", text: name }),
        el("p", { class: "oa-subline", text: sub }),
        factNodes.length ? el("div", { class: "oa-facts" }, factNodes) : null,
      ]));
    }

    function remoteError() {
      return state.remote && state.remote.__error ? state.remote.__error : null;
    }

    function renderTrack(remote) {
      var local = state.local;
      var streams = remote && remote.streams;
      var pts = (streams && streams.points) || [];
      var ok = streams && streams.state === "available" && pts.length > 0;
      var err = remoteError();

      if (state.tab === "overview" || state.tab === "streams") {
        if (ok) {
          var total = sum(pts);
          bodyEl.appendChild(el("div", { class: "oa-hero" }, [
            el("div", { class: "lbl", text: "Total Spotify streams · last " + pts.length + " days" }),
            el("div", { class: "val", text: nfmt(Math.round(total)) }),
            el("div", { class: "sub", text: "Daily average: " + nfmt(Math.round(total / pts.length)) + " streams" }),
          ]));
        } else {
          bodyEl.appendChild(el("div", { class: "oa-hero empty" }, [
            el("div", { class: "lbl", text: "Spotify streams" }),
            el("div", { class: "val", text: err ? "Analytics unavailable" : (state.remote ? "Stream data unavailable" : "Loading…") }),
            el("div", { class: "sub", text: err ? errorText(err) : (state.remote ? streamReason(streams && streams.state) : "Fetching analytics from the Ocean app…") }),
          ]));
        }

        // Cards: local facts are always available, analytics only when real.
        var cards = [];
        if (ok) {
          var l7 = sum(pts.slice(-7)), p7 = sum(pts.slice(-14, -7));
          var growth = p7 > 0 ? ((l7 - p7) / p7) * 100 : null;
          var peak = pts.reduce(function (m, p) { return p.value > m.value ? p : m; }, pts[0]);
          cards.push(card("Last 7 days", nfmt(Math.round(l7)), "7 days"));
          cards.push(card("Daily average", nfmt(Math.round(sum(pts) / pts.length)), "across " + pts.length + " days"));
          cards.push(card("Peak daily", nfmt(Math.round(peak.value)), dfmt(peak.date)));
          cards.push(card("Growth · 7d", growth === null ? null : (growth >= 0 ? "+" : "") + growth.toFixed(1) + "%",
            growth === null ? "needs 14 days" : "vs previous 7 days", growth === null ? null : (growth >= 0 ? "up" : "down")));
        }
        var d = local && local.status ? local : null;
        cards.push(card("Distributor",
          d && d.status === "verified" ? d.distributor : (remote && remote.distributor && remote.distributor.status === "verified" ? remote.distributor.name : "Unknown"),
          d && d.status === "verified" ? "exact UUID match" : "licensor UUID not mapped"));
        if (local && local.isrc) cards.push(card("ISRC", local.isrc, "from your Spotify client"));
        bodyEl.appendChild(el("div", { class: "oa-cards" }, cards));

        bodyEl.appendChild(renderChart(pts, ok, streams && streams.state, err));
      }

      if (state.tab === "metadata") {
        var dd = (remote && remote.distributor) || {};
        var lic = (local && local.licensorUuid) || dd.licensorUuid;
        bodyEl.appendChild(el("div", { class: "oa-kv" }, [
          kvItem("Spotify track ID", state.target.id, true),
          kvItem("Album ID", remote && remote.albumId, true),
          kvItem("ISRC", (local && local.isrc) || (remote && remote.isrc), true),
          kvItem("UPC", remote && remote.upc, true),
          kvItem("Label", remote && remote.label),
          kvItem("Distributor", (local && local.status === "verified") ? local.distributor : (dd.status === "verified" ? dd.name : "Unknown distributor")),
          kvItem("Licensor UUID", lic, true),
          kvItem("Release date", dfmt(remote && remote.releaseDate)),
          kvItem("Duration", fmtDuration((local && local.durationMs) || (remote && remote.durationMs))),
          kvItem("Album", (local && local.album) || (remote && remote.albumTitle)),
          kvItem("Copyright", remote && (remote.copyrights || [])[0]),
        ]));
        if (!remote) bodyEl.appendChild(el("div", { class: "hint", style: "margin-top:12px;color:#6f6f6f;font-size:11.5px", text: err ? errorText(err) : "Loading the rest from the Ocean app…" }));
      }

      if (state.tab === "links") {
        var links = (remote && remote.links) || [];
        if (!links.length) bodyEl.appendChild(emptyBox(err ? "Links need the Ocean desktop app." : "No external links are available for this track.", err ? errorText(err) : null));
        else {
          bodyEl.appendChild(el("div", { class: "oa-links" }, links.map(function (l) {
            return el("div", {
              class: "oa-link", title: l.url,
              onclick: function () { Spicetify.Platform?.ClipboardAPI?.copy?.(l.url); Spicetify.showNotification(l.name + " link copied"); },
            }, [
              el("span", { class: "ico", text: l.name.slice(0, 1).toUpperCase() }),
              el("span", { class: "oa-ell", text: l.name }),
              el("span", { style: "margin-left:auto;color:#6f6f6f;font-size:11px", text: "copy" }),
            ]);
          })));
        }
      }
    }

    function errorText(err) {
      if (!err) return "";
      if (err.code === "DESKTOP_APP_OFFLINE") return "Start the Ocean Distro Finder desktop app to load analytics.";
      if (err.code === "PANEL_UNREACHABLE") return "The Ocean panel service is not responding.";
      return err.message || "Analytics could not be loaded.";
    }
    function streamReason(state_) {
      if (state_ === "not_configured") return "Streaming analytics are not configured.";
      if (state_ === "plan_restricted") return "Not included in the current analytics plan.";
      if (state_ === "unavailable") return "The analytics service did not respond.";
      return "No stream data was found for this track.";
    }

    function renderChart(pts, ok, streamState, err) {
      var panel = el("div", { class: "oa-chart-panel" });
      var head = el("div", { class: "oa-chart-head" }, [
        el("div", {}, [
          el("h4", { text: "Spotify stream trend" }),
          el("p", { text: ok ? "Daily streams over the selected period" : "No data for the selected period" }),
        ]),
      ]);
      var controls = el("div", {});
      [["daily", "Daily"], ["cumulative", "Total"]].forEach(function (v, i, arr) {
        if (i === 0) {
          var seg = el("div", { class: "oa-seg" }, arr.map(function (vv) {
            return el("button", {
              class: state.chartView === vv[0] ? "active" : "", text: vv[1],
              onclick: function () { state.chartView = vv[0]; render(); },
            });
          }));
          controls.appendChild(seg);
        }
      });
      controls.appendChild(el("div", { class: "oa-seg" }, [["line", "Line"], ["area", "Area"], ["bar", "Bar"]].map(function (t) {
        return el("button", { class: state.chartType === t[0] ? "active" : "", text: t[1], onclick: function () { state.chartType = t[0]; render(); } });
      })));
      controls.appendChild(el("div", { class: "oa-seg" }, [[7, "7D"], [30, "30D"], [90, "90D"], [365, "1Y"]].map(function (r) {
        return el("button", {
          class: state.days === r[0] ? "active" : "", text: r[1],
          onclick: function () { state.days = r[0]; state.remote = null; render(); requestRemote(state.token, state.local && state.local.licensorUuid); },
        });
      })));
      head.appendChild(controls);
      panel.appendChild(head);

      if (!ok) {
        panel.appendChild(emptyBox(
          err ? "Analytics unavailable" : (state.remote ? "No analytics data is available for this period." : "Loading analytics…"),
          err ? errorText(err) : (state.remote ? "Try a longer date range." : null),
          state.remote ? function () { state.remote = null; render(); requestRemote(state.token, state.local && state.local.licensorUuid); } : null
        ));
        return panel;
      }
      panel.appendChild(drawChart(pts));
      return panel;
    }

    /** Dependency-free SVG chart; missing days stay gaps, never zeros. */
    function drawChart(points) {
      var NS = "http://www.w3.org/2000/svg";
      function sel(name, attrs) {
        var n = document.createElementNS(NS, name);
        for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
        return n;
      }
      // Insert explicit gaps for absent dates.
      var series = [];
      for (var i = 0; i < points.length; i++) {
        series.push({ date: points[i].date, value: points[i].value });
        var cur = new Date(points[i].date).getTime();
        var nxt = i + 1 < points.length ? new Date(points[i + 1].date).getTime() : null;
        if (nxt === null || isNaN(cur) || isNaN(nxt)) continue;
        var gap = Math.round((nxt - cur) / 86400000);
        if (gap > 1 && gap < 400) for (var g = 1; g < gap; g++) series.push({ date: new Date(cur + g * 86400000).toISOString().slice(0, 10), value: 0, missing: true });
      }
      if (state.chartView === "cumulative") {
        var acc = 0;
        series = series.map(function (p) { acc += p.value; return { date: p.date, value: acc, missing: p.missing }; });
      }

      var W = 920, H = 280, PADL = 56, PADR = 14, PADT = 12, PADB = 28;
      var iW = W - PADL - PADR, iH = H - PADT - PADB;
      var vals = series.map(function (p) { return p.value; });
      var max = Math.max.apply(null, vals.concat([1]));
      var min = state.chartView === "cumulative" ? 0 : Math.min.apply(null, vals.concat([0]));
      var span = (max - min) || 1;
      var X = function (i) { return PADL + (series.length === 1 ? iW / 2 : (i / (series.length - 1)) * iW); };
      var Y = function (v) { return PADT + iH - ((v - min) / span) * iH; };

      var svg = sel("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", class: "oa-svg" });
      var defs = sel("defs");
      var grad = sel("linearGradient", { id: "oaGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
      grad.appendChild(sel("stop", { offset: "0%", "stop-color": "#1db954", "stop-opacity": ".35" }));
      grad.appendChild(sel("stop", { offset: "100%", "stop-color": "#1db954", "stop-opacity": ".02" }));
      defs.appendChild(grad); svg.appendChild(defs);

      [0, .25, .5, .75, 1].forEach(function (f) {
        svg.appendChild(sel("line", { class: "oa-grid", x1: PADL, x2: W - PADR, y1: PADT + iH * f, y2: PADT + iH * f }));
        var tx = sel("text", { class: "oa-axis", x: 8, y: PADT + iH * f + 3.5 });
        tx.textContent = compact(max - (max - min) * f);
        svg.appendChild(tx);
      });
      var ticks = Math.min(6, series.length);
      for (var k = 0; k < ticks; k++) {
        var idx = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (series.length - 1));
        var t2 = sel("text", { class: "oa-axis", x: X(idx), y: H - 8, "text-anchor": k === 0 ? "start" : (k === ticks - 1 ? "end" : "middle") });
        var dd2 = new Date(series[idx].date);
        t2.textContent = isNaN(dd2.getTime()) ? series[idx].date : dd2.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
        svg.appendChild(t2);
      }

      if (state.chartType === "bar" && state.chartView !== "cumulative") {
        var bw = Math.max(1.5, (iW / series.length) * .62);
        series.forEach(function (p, i) {
          if (p.missing) return;
          svg.appendChild(sel("rect", { class: "oa-barr", x: X(i) - bw / 2, y: Y(p.value), width: bw, height: Math.max(0, (PADT + iH) - Y(p.value)), rx: Math.min(2, bw / 2) }));
        });
      } else {
        var runs = [], cur2 = [];
        series.forEach(function (p, i) {
          if (p.missing) { if (cur2.length) { runs.push(cur2); cur2 = []; } return; }
          cur2.push({ x: X(i), y: Y(p.value) });
        });
        if (cur2.length) runs.push(cur2);
        runs.forEach(function (run) {
          var d3 = run.map(function (c, i) { return (i ? "L" : "M") + c.x.toFixed(1) + "," + c.y.toFixed(1); }).join(" ");
          if (state.chartType === "area" || state.chartView === "cumulative") {
            svg.appendChild(sel("path", { class: "oa-areaf", d: d3 + " L" + run[run.length - 1].x.toFixed(1) + "," + (PADT + iH).toFixed(1) + " L" + run[0].x.toFixed(1) + "," + (PADT + iH).toFixed(1) + " Z" }));
          }
          svg.appendChild(sel("path", { class: "oa-line", d: d3 }));
        });
      }

      var tip = el("div", { class: "oa-tip" });
      var line = sel("line", { class: "oa-grid", y1: PADT, y2: PADT + iH, style: "display:none;stroke:#4a4a4a;stroke-dasharray:3 3" });
      svg.appendChild(line);
      svg.addEventListener("mousemove", function (ev) {
        var r = svg.getBoundingClientRect();
        var rx = ((ev.clientX - r.left) / r.width) * W;
        var n = 0;
        for (var i = 1; i < series.length; i++) if (Math.abs(X(i) - rx) < Math.abs(X(n) - rx)) n = i;
        var p = series[n];
        line.setAttribute("x1", X(n)); line.setAttribute("x2", X(n)); line.style.display = "";
        tip.textContent = "";
        var dv = new Date(p.date);
        tip.appendChild(el("div", { class: "d", text: isNaN(dv.getTime()) ? p.date : dv.toLocaleDateString(LOCALE, { year: "numeric", month: "long", day: "numeric" }) }));
        tip.appendChild(el("div", { class: "v", text: p.missing ? "No data for this day" : nfmt(Math.round(p.value)) + " streams" }));
        tip.style.display = "block";
        tip.style.left = Math.min(Math.max((X(n) / W) * r.width + 12, 8), r.width - 190) + "px";
        tip.style.top = "10px";
      });
      svg.addEventListener("mouseleave", function () { line.style.display = "none"; tip.style.display = "none"; });

      var wrap = el("div", { class: "oa-chart-wrap" });
      wrap.appendChild(svg);
      wrap.appendChild(tip);
      return wrap;
    }

    /** Album / artist / playlist views — all of these need the desktop app. */
    function renderRemoteKind(kind, remote) {
      var err = remoteError();
      if (err) { bodyEl.appendChild(emptyBox("Analysis unavailable", errorText(err), function () { state.remote = null; render(); requestRemote(state.token, null); })); return; }
      if (!remote) {
        bodyEl.appendChild(el("div", { class: "oa-skel", style: "height:80px;margin-bottom:12px" }));
        bodyEl.appendChild(el("div", { class: "oa-skel", style: "height:220px" }));
        return;
      }

      if (kind === "album") {
        if (state.tab === "overview" || state.tab === "tracks") {
          bodyEl.appendChild(el("div", { class: "oa-cards" }, [
            card("Tracks", String(remote.totalTracks), remote.releaseType || ""),
            card("Total duration", fmtDuration(remote.totalDurationMs), ""),
            card("Released", dfmt(remote.releaseDate), ""),
            card("UPC", remote.upc, ""),
          ]));
          bodyEl.appendChild(trackTable(remote.tracks || [], remote.artworkUrl, ["#", "Title", "Artists", "ISRC", "Duration"], function (t) {
            return [String(t.trackNumber || ""), t.title, (t.artists || []).join(", "), t.isrc || "—", fmtDuration(t.durationMs) || "—"];
          }));
        }
        if (state.tab === "metadata") {
          bodyEl.appendChild(el("div", { class: "oa-kv" }, [
            kvItem("Album ID", remote.spotifyAlbumId, true), kvItem("UPC", remote.upc, true),
            kvItem("Label", remote.label), kvItem("Release type", remote.releaseType),
            kvItem("Release date", dfmt(remote.releaseDate)), kvItem("Total tracks", String(remote.totalTracks)),
            kvItem("Artists", (remote.artists || []).map(function (a) { return a.name; }).join(", ")),
            kvItem("Copyright", (remote.copyrights || [])[0]),
          ]));
        }
      }

      if (kind === "artist") {
        if (state.tab === "overview") {
          var r = remote.restricted || {};
          bodyEl.appendChild(el("div", { class: "oa-cards" }, [
            card("Followers", remote.followers !== null ? nfmt(remote.followers) : null, r.profileStats ? "not exposed by Spotify" : ""),
            card("Popularity", remote.popularity !== null ? remote.popularity + " / 100" : null, r.profileStats ? "not exposed by Spotify" : ""),
            card("Releases", String((remote.releases || []).length), "albums & singles"),
          ]));
          bodyEl.appendChild(emptyBox(
            "Spotify no longer publishes follower counts, popularity, genres or top tracks to third-party apps.",
            "Open a release to analyze its tracks."
          ));
        }
        if (state.tab === "releases") {
          bodyEl.appendChild(rowTable(remote.releases || [], ["Release", "Type", "Date", "Tracks"], function (x) {
            return [x.title, x.releaseType || "—", dfmt(x.releaseDate) || "—", String(x.totalTracks || "—")];
          }, function (x) { drillTo({ kind: "album", id: x.spotifyAlbumId, hint: { title: x.title, artworkUrl: x.artworkUrl } }); }));
        }
      }

      if (kind === "playlist") {
        if (state.tab === "overview") {
          bodyEl.appendChild(el("div", { class: "oa-cards" }, [
            card("Tracks", String(remote.totalTracks), (remote.tracks || []).length < remote.totalTracks ? "first " + (remote.tracks || []).length + " readable" : "all readable"),
            card("Followers", remote.followers !== null ? nfmt(remote.followers) : null, ""),
            card("Duration", fmtDuration(remote.totalDurationMs), "of loaded tracks"),
            card("Visibility", remote.isPublic === null ? null : remote.isPublic ? "Public" : "Private", ""),
          ]));
          if ((remote.tracks || []).length < remote.totalTracks) {
            bodyEl.appendChild(el("div", { style: "color:#6f6f6f;font-size:11.5px;margin-bottom:12px", text: "Spotify only returns the first page of a playlist to third-party apps, so " + (remote.tracks || []).length + " of " + remote.totalTracks + " tracks are shown." }));
          }
        }
        if (state.tab === "tracks") {
          bodyEl.appendChild(rowTable(remote.tracks || [], ["Track", "Artists", "Released", "Added"], function (x) {
            return [x.title, (x.artists || []).join(", "), dfmt(x.releaseDate) || "—", dfmt(x.addedAt) || "—"];
          }, function (x) { drillTo({ kind: "track", id: x.spotifyTrackId, hint: { title: x.title, artworkUrl: remote.artworkUrl } }); }));
        }
      }
    }

    function trackTable(items, artwork, headers, cells) {
      return rowTable(items, headers, cells, function (t) {
        drillTo({ kind: "track", id: t.spotifyTrackId, hint: { title: t.title, artworkUrl: artwork } });
      });
    }
    function rowTable(items, headers, cells, onRow) {
      var body = items.map(function (item) {
        var tr = el("tr", onRow ? { class: "click", onclick: function () { onRow(item); } } : {});
        cells(item).forEach(function (v, i) {
          tr.appendChild(el("td", {}, [i === 0 || i === 1 ? el("div", { class: "oa-ell", text: String(v) }) : document.createTextNode(String(v))]));
        });
        return tr;
      });
      return el("div", { class: "oa-table-wrap" }, [
        el("table", { class: "oa-table" }, [
          el("thead", {}, [el("tr", {}, headers.map(function (hh) { return el("th", { text: hh }); }))]),
          el("tbody", {}, body.length ? body : [el("tr", {}, [el("td", { colspan: String(headers.length), text: "Nothing to show." })])]),
        ]),
      ]);
    }

    return { open: open, close: close };
  })();

  // ── Right-click menu ──────────────────────────────────────
  var MENU_KINDS = { track: 1, album: 1, artist: 1, playlist: 1 };
  function parseUri(uri) {
    var m = /^spotify:(track|album|artist|playlist):([A-Za-z0-9]{22})$/.exec(String(uri || ""));
    return m ? { kind: m[1], id: m[2] } : null;
  }
  function analyzerLabel() {
    var lang = (Spicetify.Locale?.getLocale?.() || navigator.language || "en").toLowerCase();
    return lang.indexOf("tr") === 0 ? "Ocean Analyzer ile Analiz Et" : "Analyze with Ocean Analyzer";
  }

  // Construct EVERYTHING first, then register: if a constructor throws (the
  // React wrapper can lag the guard on slow starts), nothing is half-added
  // and the retry is clean. One success — never twice.
  var menusRegistered = false;
  function registerMenus() {
    if (menusRegistered) return;
    var analyzerItem, finderItem;
    try {
      analyzerItem = new Spicetify.ContextMenu.Item(
        analyzerLabel(),
        function (uris) { var t = parseUri(uris[0]); if (t) analyzer.open(t); },
        function (uris) { return uris.length === 1 && !!parseUri(uris[0]) && MENU_KINDS[parseUri(uris[0]).kind] === 1; },
        "chart-up"
      );
      // Quick distributor-only panel stays available for tracks.
      finderItem = new Spicetify.ContextMenu.Item(
        "Ocean Distro Finder",
        (uris) => { const id = String(uris[0]).split(":").pop(); showTrack(id); },
        (uris) => uris.length === 1 && String(uris[0]).startsWith("spotify:track:"),
        "search"
      );
    } catch (e) {
      setTimeout(registerMenus, 500);
      return;
    }
    analyzerItem.register();
    finderItem.register();
    menusRegistered = true;
  }
  registerMenus();

  // ── Profile menu: connection status + what to do about it ──
  // The old pairing code lives here no longer — the desktop app connects by
  // itself. People still look in this menu, so it now answers the question
  // they came with: is Spotify linked, and if not, what do I press?
  function connectionReport() {
    var wrap = document.createElement("div");
    var mapped = Object.keys(MAPPING).length;
    wrap.innerHTML = '<div style="font-size:13px;line-height:1.6">' +
      '<p style="margin:0 0 12px"><b style="color:#1db954">Right-click any track, album, artist or playlist</b><br>' +
      '<span style="color:var(--spice-subtext,#b3b3b3)">→ “' + escapeHtml(analyzerLabel()) + '” for the full window, ' +
      'or “Ocean Distro Finder” for the quick distributor panel.</span></p>' +
      '<p style="margin:0 0 6px"><b>Distributor lookups</b>: <span style="color:#1db954">ready</span><br>' +
      '<span style="color:var(--spice-subtext,#b3b3b3)">' + mapped + ' distributors built in' +
      (MAPPING_BUILT_AT ? " on " + MAPPING_BUILT_AT : "") + '. Works offline — no pairing, no setup.</span></p>' +
      '<p style="margin:12px 0 6px"><b>Streaming analytics</b>: <span id="odf-conn-state" style="color:#e0a458">checking…</span><br>' +
      '<span style="color:var(--spice-subtext,#b3b3b3)">Served by the Ocean Distro Finder desktop app. ' +
      'If it says not connected, open that app and choose <b>Spotify → Connect to Spotify</b> once.</span></p>' +
      '</div>';
    Spicetify.PopupModal.display({ title: "Ocean Distro Finder", content: wrap });

    // Probe the bridge the same way the analyzer does, so the answer is real.
    var stateEl = wrap.querySelector("#odf-conn-state");
    analyzerBridge.request("track", "4PTG3Z6ehGkBFwjybzWkR8", { days: 7 }).then(function (res) {
      if (!stateEl) return;
      // A reply of ANY kind proves the desktop app answered. Only silence (the
      // request timing out unserved) means the link is down — an upstream error
      // like a provider rate limit is a data problem, not a connection problem.
      if (res && res.payload) {
        stateEl.textContent = "connected";
        stateEl.style.color = "#1db954";
      } else if (res && res.error && res.error.code === "DESKTOP_APP_OFFLINE") {
        stateEl.textContent = "not connected";
        stateEl.style.color = "#e05555";
      } else {
        stateEl.textContent = "connected · data unavailable";
        stateEl.style.color = "#e0a458";
        var why = document.createElement("span");
        why.style.cssText = "display:block;color:var(--spice-subtext,#b3b3b3);font-size:11.5px;margin-top:2px";
        why.textContent = (res && res.error && res.error.message) ? res.error.message : "The panel service returned no data.";
        stateEl.parentNode.appendChild(why);
      }
    });
  }

  // Same safety net for the profile-menu entry — never let a lagging wrapper
  // kill the extension.
  var profileRegistered = false;
  function registerProfileMenu() {
    if (profileRegistered) return;
    try {
      if (Spicetify.Menu && Spicetify.Menu.Item) {
        new Spicetify.Menu.Item("Ocean Distro Finder", false, connectionReport).register();
      }
      profileRegistered = true;
    } catch (e) {
      setTimeout(registerProfileMenu, 500);
    }
  }
  registerProfileMenu();

  console.log(
    "[ODF] Ocean Distro Finder loaded (v10 — startup-race-safe menus, in-app Ocean Analyzer + connection report, offline mapping: " +
    Object.keys(MAPPING).length + " records" + (MAPPING_BUILT_AT ? ", built " + MAPPING_BUILT_AT : "") + ")"
  );
})();
