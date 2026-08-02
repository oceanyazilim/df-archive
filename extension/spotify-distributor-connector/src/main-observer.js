/*
 * MAIN-world observer. Runs at document_start on https://open.spotify.com/* .
 *
 * It observes ONLY the extended-track-metadata endpoint response
 *   https://spclient.wg.spotify.com/metadata/4/track/{32-hex}
 * that the user's own logged-in Spotify Web Player already fetches, extracts a
 * small sanitized object, and hands it to the isolated content script via a
 * fixed-type window.postMessage.
 *
 * It NEVER reads/copies/sends: authorization headers, tokens, cookies, request
 * bodies, content_authorization_attributes, original_audio.uuid, cover images,
 * or the full response. It never blocks, delays, retries, or mutates Spotify's
 * request or response.
 */
(function () {
  "use strict";

  // Idempotent: never wrap fetch/XHR twice.
  if (window.__SPOTIFY_DISTRIBUTOR_CONNECTOR_INSTALLED__) return;
  window.__SPOTIFY_DISTRIBUTOR_CONNECTOR_INSTALLED__ = true;

  var EVENT_TYPE = "OCEAN_SPOTIFY_METADATA_CAPTURED_V1";
  var HEX32 = /^[a-f0-9]{32}$/;
  var BASE62 = /^[A-Za-z0-9]{22}$/;

  function parseMetadataRequestUrl(value) {
    try {
      var url = new URL(value, window.location.href);
      if (url.protocol !== "https:") return null;
      if (url.hostname !== "spclient.wg.spotify.com") return null;
      var m = url.pathname.match(/^\/metadata\/4\/track\/([a-f0-9]{32})$/);
      if (!m) return null;
      return { trackGid: m[1].toLowerCase() };
    } catch (e) {
      return null;
    }
  }

  function normUuid(raw) {
    if (raw === null || raw === undefined) return null;
    var v = String(raw).trim().toLowerCase().replace(/-/g, "");
    return HEX32.test(v) ? v : null;
  }
  function str(v) { return (typeof v === "string" && v.trim().length > 0) ? v.trim() : null; }
  function trackIdFromUri(uri) {
    var m = String(uri || "").match(/^spotify:track:([A-Za-z0-9]{22})$/);
    return m ? m[1] : null;
  }

  // Pure parser mirroring the backend. Licensor UUID ONLY from licensor.uuid,
  // then album.licensor.uuid — never original_audio.uuid or any other field.
  function parseExtendedMetadata(r) {
    if (!r || typeof r !== "object") return null;
    var canonical = str(r.canonical_uri);
    if (!canonical || canonical.indexOf("spotify:track:") !== 0) return null;
    var trackId = trackIdFromUri(canonical);
    if (!trackId) return null;

    var album = (r.album && typeof r.album === "object") ? r.album : {};
    var uuid = normUuid(r.licensor && r.licensor.uuid) || normUuid(album.licensor && album.licensor.uuid);
    if (!uuid) return null;

    var artists = Array.isArray(r.artist)
      ? r.artist.map(function (a) { return a && typeof a === "object" ? str(a.name) : null; })
          .filter(function (n) { return !!n; }).slice(0, 32)
      : [];

    var isrc = null;
    if (Array.isArray(r.external_id)) {
      for (var i = 0; i < r.external_id.length; i++) {
        var e = r.external_id[i];
        if (e && typeof e === "object" && e.type === "isrc" && str(e.id)) { isrc = String(e.id).trim(); break; }
      }
    }
    var gid = str(r.gid);
    var trackGid = (gid && HEX32.test(gid.toLowerCase())) ? gid.toLowerCase() : null;

    return {
      source: "spotify-web-player",
      capturedAt: new Date().toISOString(),
      spotifyTrackId: trackId,
      spotifyUri: "spotify:track:" + trackId,
      trackGid: trackGid,
      trackTitle: str(r.name) || "",
      artists: artists,
      albumTitle: str(album.name),
      albumLabel: str(album.label),
      isrc: isrc,
      durationMs: (typeof r.duration === "number" && isFinite(r.duration)) ? r.duration : null,
      licensorUuid: uuid
    };
  }

  function emit(body, requestGid) {
    var parsed;
    try { parsed = parseExtendedMetadata(body); } catch (e) { return; }
    if (!parsed) return;
    // Verify the request GID equals the response gid.
    if (!parsed.trackGid || parsed.trackGid !== requestGid) return;
    if (!BASE62.test(parsed.spotifyTrackId) || !HEX32.test(parsed.licensorUuid)) return;
    try {
      window.postMessage({ __conn: true, type: EVENT_TYPE, payload: parsed }, window.location.origin);
    } catch (e) { /* ignore */ }
  }

  // ---- protobuf fallback ----------------------------------------------
  // The metadata endpoint answers protobuf (vnd.spotify/metadata-track) in
  // current clients, so a JSON parse throws. Decode just enough of the wire
  // format to read the two fields we need: field 21 = licensor{1: uuid},
  // album 3.25 = licensor{1: uuid}. Nothing else is read from the bytes.
  function readVarint(b, i) {
    var r = 0, shift = 0, pos = i;
    while (pos < b.length) {
      var byte = b[pos++];
      r += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return [r, pos];
  }
  function decodePb(b) {
    var out = {}, i = 0;
    while (i < b.length) {
      var start = i, kv = readVarint(b, i), key = kv[0];
      i = kv[1];
      var field = key >>> 3, wire = key & 7, value = null;
      if (wire === 0) { var v = readVarint(b, i); value = v[0]; i = v[1]; }
      else if (wire === 2) {
        var l = readVarint(b, i); i = l[1];
        if (i + l[0] > b.length) break;
        value = b.subarray(i, i + l[0]);
        i += l[0];
      } else if (wire === 5) { i += 4; }
      else if (wire === 1) { i += 8; }
      else break;
      (out[field] = out[field] || []).push(value);
      if (i <= start) break;
    }
    return out;
  }
  function hex16(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 16) return null;
    var s = "";
    for (var i = 0; i < 16; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }
  function utf8(bytes) { return bytes instanceof Uint8Array ? new TextDecoder().decode(bytes) : null; }
  function subMsg(msg, field) {
    var v = msg && msg[field] && msg[field][0];
    return v instanceof Uint8Array ? decodePb(v) : null;
  }

  /** Build the same sanitized payload from protobuf bytes, or null. */
  function parseProtobuf(bytes, requestGid) {
    var track = decodePb(bytes);
    var gidBytes = track[1] && track[1][0];
    var gid = hex16(gidBytes);
    if (!gid || gid !== requestGid) return null;

    // Licensor: track-level (21) then album-level (3.25). Never field 24.
    var licensor = subMsg(track, 21);
    var uuid = licensor ? hex16(licensor[1] && licensor[1][0]) : null;
    if (!uuid) {
      var albumLicensor = subMsg(subMsg(track, 3) || {}, 25);
      uuid = albumLicensor ? hex16(albumLicensor[1] && albumLicensor[1][0]) : null;
    }
    if (!uuid || !HEX32.test(uuid)) return null;

    var album = subMsg(track, 3);
    var artists = [];
    (track[4] || []).forEach(function (raw) {
      var a = raw instanceof Uint8Array ? decodePb(raw) : null;
      var name = a && utf8(a[2] && a[2][0]);
      if (name) artists.push(name);
    });
    var isrc = null;
    (track[10] || []).forEach(function (raw) {
      if (isrc || !(raw instanceof Uint8Array)) return;
      var e = decodePb(raw);
      var type = utf8(e[1] && e[1][0]);
      var id = utf8(e[2] && e[2][0]);
      if (type && id && type.toLowerCase() === "isrc") isrc = id;
    });

    return {
      source: "spotify-web-player",
      capturedAt: new Date().toISOString(),
      spotifyTrackId: null, // filled by the caller from the request mapping
      spotifyUri: null,
      trackGid: gid,
      trackTitle: utf8(track[2] && track[2][0]) || "",
      artists: artists.slice(0, 32),
      albumTitle: album ? utf8(album[2] && album[2][0]) : null,
      albumLabel: null, // the protobuf response carries no label field
      isrc: isrc,
      durationMs: typeof (track[7] && track[7][0]) === "number" ? track[7][0] : null,
      licensorUuid: uuid,
    };
  }

  // GID → base62 track id, so a protobuf capture can be attributed to a track.
  var B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function gidToBase62(gid) {
    if (!HEX32.test(gid)) return null;
    var n = BigInt("0x" + gid), out = "";
    for (var i = 0; i < 22; i++) { out = B62[Number(n % 62n)] + out; n = n / 62n; }
    return n === 0n ? out : null;
  }

  function emitBinary(buffer, requestGid) {
    var parsed;
    try { parsed = parseProtobuf(new Uint8Array(buffer), requestGid); } catch (e) { return; }
    if (!parsed) return;
    var trackId = gidToBase62(requestGid);
    if (!trackId || !BASE62.test(trackId)) return;
    parsed.spotifyTrackId = trackId;
    parsed.spotifyUri = "spotify:track:" + trackId;
    try {
      window.postMessage({ __conn: true, type: EVENT_TYPE, payload: parsed }, window.location.origin);
    } catch (e) { /* ignore */ }
  }

  /** Read a cloned response as JSON, falling back to protobuf. */
  function consume(resp, requestGid) {
    var clone;
    try { clone = resp.clone(); } catch (e) { return; }
    var ct = "";
    try { ct = (clone.headers.get("content-type") || "").toLowerCase(); } catch (e) { /* opaque */ }
    if (ct.indexOf("json") !== -1) {
      clone.json().then(function (body) { emit(body, requestGid); }).catch(function () {});
      return;
    }
    clone.arrayBuffer().then(function (buf) { emitBinary(buf, requestGid); }).catch(function () {});
  }

  // ---- fetch wrapper (original preserved, returned unchanged) ----
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      var promise = origFetch.apply(this, arguments);
      try {
        var url = (typeof input === "string") ? input : (input && input.url);
        var gid = url ? parseMetadataRequestUrl(url) : null;
        if (gid) {
          promise.then(function (resp) {
            try { if (resp && resp.ok) consume(resp, gid.trackGid); } catch (e) { /* ignore */ }
          }).catch(function () {});
        }
      } catch (e) { /* never affect the original request */ }
      return promise; // unchanged, unblocked
    };
  }

  // ---- XMLHttpRequest wrapper (adds a load listener; never replaces handlers) ----
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__connUrl = url; } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        var gid = this.__connUrl ? parseMetadataRequestUrl(this.__connUrl) : null;
        if (gid) {
          var self = this;
          this.addEventListener("load", function () {
            try {
              if (self.readyState === 4 && self.status >= 200 && self.status < 300) {
                var body = JSON.parse(self.responseText);
                emit(body, gid.trackGid);
              }
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }
})();
