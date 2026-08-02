"use strict";

function $(id) { return document.getElementById(id); }
function send(msg) { return new Promise((res) => chrome.runtime.sendMessage(msg, res)); }

function setText(el, text) { el.textContent = text == null ? "—" : String(text); }

const DELIVERY_LABEL = {
  idle: "Idle", local_only: "Captured locally (disabled/unpaired)",
  disabled_or_unpaired: "Disabled or not paired", no_pending_lookup: "Captured (no pending lookup)",
  delivered: "Delivered to panel", captured_no_match: "Delivered (no match)",
  panel_unreachable: "Panel unreachable", invalid_connector_key: "Invalid connector key",
  bad_origin: "Invalid panel origin",
};

async function render() {
  const s = await send({ kind: "GET_STATE" });
  if (!s) return;
  $("enabled").checked = !!s.enabled;
  setText($("panelOrigin"), s.panelOrigin);
  setText($("paired"), s.paired ? "Paired" : "Not paired");
  setText($("delivery"), DELIVERY_LABEL[s.deliveryStatus] || s.deliveryStatus || "—");

  if (s.lastCapture) {
    const c = s.lastCapture;
    $("lastCapture").textContent = `${c.trackTitle || "(untitled)"} — ${(c.artists || []).join(", ")}  ·  UUID ${c.licensorUuid}`;
    $("lastCapture").classList.remove("muted");
  }
  if (s.lastResult) {
    $("lastResult").textContent = `${s.lastResult.spotifyTrackId} → ${s.lastResult.matchStatus || "—"}`;
    $("lastResult").classList.remove("muted");
  }

  // Spotify tab status (no tabs permission needed for query of our own host? use tabs.query on the active tab origin).
  try {
    const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/*" });
    setText($("spotifyTab"), tabs && tabs.length ? "Open" : "Not open");
  } catch { setText($("spotifyTab"), "Unknown"); }
}

document.addEventListener("DOMContentLoaded", () => {
  render();
  $("enabled").addEventListener("change", async (e) => {
    await send({ kind: "SET_CONFIG", enabled: e.target.checked });
    render();
  });
  $("openPanel").addEventListener("click", async () => {
    const s = await send({ kind: "GET_STATE" });
    if (s && s.panelOrigin) chrome.tabs.create({ url: s.panelOrigin });
  });
  $("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("disconnect").addEventListener("click", async () => { await send({ kind: "DISCONNECT" }); render(); });
});
