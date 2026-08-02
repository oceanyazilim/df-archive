"use strict";

function $(id) { return document.getElementById(id); }
function send(msg) { return new Promise((res) => chrome.runtime.sendMessage(msg, res)); }
function msg(el, text, ok) { el.textContent = text; el.className = "msg " + (ok ? "ok" : "err"); }

async function render() {
  const s = await send({ kind: "GET_STATE" });
  if (!s) return;
  $("panelOrigin").value = s.panelOrigin || "";
  $("autoCapture").checked = !!s.autoCapture;
  $("paired").textContent = s.paired ? "Paired" : "Not paired";
}

document.addEventListener("DOMContentLoaded", () => {
  render();

  $("saveOrigin").addEventListener("click", async () => {
    const r = await send({ kind: "SET_CONFIG", panelOrigin: $("panelOrigin").value.trim() });
    if (r && r.ok) msg($("originMsg"), "Saved.", true);
    else msg($("originMsg"), "Invalid origin. Use http://127.0.0.1:PORT, http://localhost:PORT, or https://host.", false);
    render();
  });

  $("pair").addEventListener("click", async () => {
    const r = await send({ kind: "PAIR", panelOrigin: $("panelOrigin").value.trim(), code: $("code").value.trim() });
    if (r && r.ok) { msg($("pairMsg"), "Paired successfully.", true); $("code").value = ""; }
    else msg($("pairMsg"), "Pairing failed: " + (r && r.error ? r.error : "unknown"), false);
    render();
  });

  $("disconnect").addEventListener("click", async () => { await send({ kind: "DISCONNECT" }); msg($("pairMsg"), "Disconnected.", true); render(); });
  $("autoCapture").addEventListener("change", async (e) => { await send({ kind: "SET_CONFIG", autoCapture: e.target.checked }); });
});
