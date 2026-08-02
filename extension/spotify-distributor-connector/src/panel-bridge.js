/*
 * Panel-origin content bridge (ISOLATED world, runs only on the configured panel
 * origin). It announces that the extension is installed and shares the extension
 * id so the panel can send the one-click START message via externally_connectable.
 * It also relays a safe state query. It never exposes the connector key.
 */
(function () {
  "use strict";
  var HELLO = "OCEAN_CONNECTOR_HELLO_V1";
  var QUERY = "OCEAN_CONNECTOR_QUERY_V1";
  var STATE = "OCEAN_CONNECTOR_STATE_V1";
  var PAIR = "OCEAN_CONNECTOR_PAIR_V1";
  var PAIR_RESULT = "OCEAN_CONNECTOR_PAIR_RESULT_V1";

  function announce() {
    try {
      window.postMessage({ type: HELLO, extensionId: chrome.runtime.id }, window.location.origin);
    } catch (e) { /* ignore */ }
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    if (!ev.data) return;

    if (ev.data.type === QUERY) {
      try {
        chrome.runtime.sendMessage({ kind: "GET_STATE" }, function (state) {
          void chrome.runtime.lastError;
          window.postMessage({
            type: STATE, extensionId: chrome.runtime.id, installed: true,
            paired: !!(state && state.paired), enabled: !!(state && state.enabled),
          }, window.location.origin);
        });
      } catch (e) { /* extension context invalidated */ }
      return;
    }

    // One-click pairing: the panel generated a code and passes it here. We
    // forward it to the service worker (which calls the panel's pair endpoint).
    // Runs only on the trusted panel origin (manifest match), so no arbitrary
    // site can trigger this.
    if (ev.data.type === PAIR) {
      var code = ev.data.code;
      var origin = ev.data.panelOrigin || window.location.origin;
      if (typeof code !== "string" || !/^[A-Za-z0-9]{4,16}$/.test(code)) {
        window.postMessage({ type: PAIR_RESULT, ok: false, error: "bad_code" }, window.location.origin);
        return;
      }
      try {
        chrome.runtime.sendMessage({ kind: "PAIR", panelOrigin: origin, code: code }, function (res) {
          void chrome.runtime.lastError;
          window.postMessage({ type: PAIR_RESULT, ok: !!(res && res.ok), error: res && res.error }, window.location.origin);
        });
      } catch (e) {
        window.postMessage({ type: PAIR_RESULT, ok: false, error: "context_invalid" }, window.location.origin);
      }
      return;
    }
  });

  announce();
  document.addEventListener("DOMContentLoaded", announce);
})();
