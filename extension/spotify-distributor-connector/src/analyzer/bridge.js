/*
 * analyzerMessageBridge — the ONLY path from the injected Spotify UI to the
 * extension service worker.
 *
 * Runs in the ISOLATED world, so the page cannot call it directly. Every
 * outbound message is built here from validated primitives (kind + 22-char id),
 * never forwarded verbatim from the page, and every inbound reply is shape-
 * checked before the modal sees it. No token, key or internal value is ever
 * written into the page.
 */
(function () {
  "use strict";

  var KINDS = { track: 1, album: 1, artist: 1, playlist: 1 };
  var ID_RE = /^[A-Za-z0-9]{22}$/;
  var MSG = {
    FETCH: "OCEAN_ANALYZER_FETCH",
    RESULT: "OCEAN_ANALYZER_RESULT",
    ERROR: "OCEAN_ANALYZER_ERROR",
    DASHBOARD: "OCEAN_ANALYZER_OPEN_DASHBOARD",
  };

  // Short-lived result cache. Metadata is stable; analytics move slowly enough
  // that a minute of reuse is safe and stops repeat opens hammering the API.
  var TTL_MS = 60 * 1000;
  var cache = new Map();
  var inFlight = new Map();

  function cacheKey(target, days) { return target.kind + ":" + target.id + ":" + days; }

  function validTarget(target) {
    return !!(target && KINDS[target.kind] === 1 && ID_RE.test(String(target.id || "")));
  }

  /** Shape-check a service-worker reply before it can reach the UI. */
  function validResult(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (!payload.data || typeof payload.data !== "object") return null;
    if (KINDS[payload.kind] !== 1) return null;
    return payload;
  }

  /**
   * Fetch one target. `done(err, result)` fires exactly once.
   * Returns an abort function; aborting only detaches this caller — an
   * in-flight request is shared, so a re-open reuses it instead of duplicating.
   */
  function fetchTarget(target, days, done) {
    if (!validTarget(target)) {
      done({ code: "INVALID_TARGET", message: "This item could not be identified." });
      return function () {};
    }
    var key = cacheKey(target, days);
    var cached = cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) {
      // Async so callers always observe consistent ordering.
      var t = setTimeout(function () { done(null, cached.value); }, 0);
      return function () { clearTimeout(t); };
    }

    var detached = false;
    var pending = inFlight.get(key);
    if (!pending) {
      pending = { waiters: [] };
      pending.promise = new Promise(function (resolve) {
        chrome.runtime.sendMessage(
          { kind: MSG.FETCH, target: { kind: target.kind, id: target.id }, days: days },
          function (reply) {
            if (chrome.runtime.lastError) {
              resolve({ err: { code: "EXTENSION_UNAVAILABLE", message: "The extension background service is not reachable." } });
              return;
            }
            if (!reply || reply.kind === MSG.ERROR) {
              resolve({ err: (reply && reply.error) || { code: "ANALYZER_FAILED", message: "The analyzer service did not respond." } });
              return;
            }
            var ok = validResult(reply.payload);
            resolve(ok ? { value: ok } : { err: { code: "BAD_RESPONSE", message: "The analyzer returned an unexpected response." } });
          }
        );
      }).then(function (out) {
        inFlight.delete(key);
        if (out.value) cache.set(key, { at: Date.now(), value: out.value });
        return out;
      });
      inFlight.set(key, pending);
    }

    pending.promise.then(function (out) {
      if (detached) return;
      if (out.err) done(out.err);
      else done(null, out.value);
    });

    return function () { detached = true; };
  }

  function openDashboard(target) {
    if (!validTarget(target)) return;
    chrome.runtime.sendMessage({ kind: MSG.DASHBOARD, target: { kind: target.kind, id: target.id } }, function () {
      void chrome.runtime.lastError; // the worker may be restarting; nothing to do
    });
  }

  function clearCache() { cache.clear(); }

  window.OceanAnalyzerBridge = { fetchTarget: fetchTarget, openDashboard: openDashboard, clearCache: clearCache };
})();
