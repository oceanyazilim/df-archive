/*
 * ISOLATED-world content bridge. Receives the sanitized payload from the
 * MAIN-world observer via window.postMessage, strictly validates it (source,
 * origin, message type, allow-listed keys, formats, sizes), and forwards ONLY
 * the clean object to the extension service worker. It never grants the page
 * any extension privilege and never forwards arbitrary page messages.
 */
(function () {
  "use strict";

  var EVENT_TYPE = "OCEAN_SPOTIFY_METADATA_CAPTURED_V1";
  var ALLOWED = ["source", "capturedAt", "spotifyTrackId", "spotifyUri", "trackGid",
    "trackTitle", "artists", "albumTitle", "albumLabel", "isrc", "durationMs", "licensorUuid"];
  var HEX32 = /^[a-f0-9]{32}$/;
  var BASE62 = /^[A-Za-z0-9]{22}$/;
  var MAX_STR = 512, MAX_ARTISTS = 32, MAX_BYTES = 8192;

  function validate(p) {
    if (!p || typeof p !== "object") return null;
    var keys = Object.keys(p);
    for (var i = 0; i < keys.length; i++) if (ALLOWED.indexOf(keys[i]) === -1) return null;
    if (!BASE62.test(String(p.spotifyTrackId || ""))) return null;
    if (!HEX32.test(String(p.licensorUuid || "").toLowerCase())) return null;
    if (p.trackGid != null && !HEX32.test(String(p.trackGid).toLowerCase())) return null;
    if (p.artists != null && (!Array.isArray(p.artists) || p.artists.length > MAX_ARTISTS)) return null;
    var strFields = ["trackTitle", "albumTitle", "albumLabel", "isrc", "capturedAt", "spotifyUri", "source"];
    for (var j = 0; j < strFields.length; j++) {
      var v = p[strFields[j]];
      if (v != null && (typeof v !== "string" || v.length > MAX_STR)) return null;
    }
    if (p.artists) for (var k = 0; k < p.artists.length; k++) {
      if (typeof p.artists[k] !== "string" || p.artists[k].length > MAX_STR) return null;
    }
    // Rebuild a clean object (drop anything not explicitly copied).
    var clean = {
      source: "spotify-web-player",
      capturedAt: typeof p.capturedAt === "string" ? p.capturedAt.slice(0, MAX_STR) : "",
      spotifyTrackId: String(p.spotifyTrackId),
      spotifyUri: "spotify:track:" + String(p.spotifyTrackId),
      trackGid: p.trackGid ? String(p.trackGid).toLowerCase() : null,
      trackTitle: typeof p.trackTitle === "string" ? p.trackTitle.slice(0, MAX_STR) : "",
      artists: Array.isArray(p.artists) ? p.artists.slice(0, MAX_ARTISTS).map(function (a) { return String(a).slice(0, MAX_STR); }) : [],
      albumTitle: typeof p.albumTitle === "string" ? p.albumTitle.slice(0, MAX_STR) : null,
      albumLabel: typeof p.albumLabel === "string" ? p.albumLabel.slice(0, MAX_STR) : null,
      isrc: typeof p.isrc === "string" ? p.isrc.slice(0, 32) : null,
      durationMs: (typeof p.durationMs === "number" && isFinite(p.durationMs)) ? p.durationMs : null,
      licensorUuid: String(p.licensorUuid).toLowerCase()
    };
    try { if (JSON.stringify(clean).length > MAX_BYTES) return null; } catch (e) { return null; }
    return clean;
  }

  window.addEventListener("message", function (event) {
    // Only accept messages this window posted to itself, from the Spotify origin.
    if (event.source !== window) return;
    if (event.origin !== "https://open.spotify.com") return;
    var data = event.data;
    if (!data || data.__conn !== true || data.type !== EVENT_TYPE) return;

    var clean = validate(data.payload);
    if (!clean) return;

    try {
      chrome.runtime.sendMessage({ kind: "SPOTIFY_METADATA", payload: clean }, function () {
        // Swallow "receiving end does not exist" during SW restarts.
        void chrome.runtime.lastError;
      });
    } catch (e) { /* extension context invalidated; ignore */ }
  }, false);
})();
