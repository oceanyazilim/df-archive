/*
 * OceanAnalyzerContextMenu — adds "Analyze with Ocean Analyzer" to the
 * right-click experience on open.spotify.com.
 *
 * Strategy (in this order):
 *   1. Let Spotify open its own menu, then inject ONE extra row into it, styled
 *    like the native items. Spotify's own entries keep working untouched.
 *   2. If Spotify does not open a menu for that spot (empty areas, artwork,
 *    some grids), show a small standalone menu instead.
 *
 * Injection is idempotent — a marker attribute plus a single short-lived
 * observer per menu means the row can never appear twice, and the observer is
 * always disconnected when the menu closes.
 */
(function () {
  "use strict";

  var MARK = "data-ocean-analyzer-item";
  var LABEL_EN = "Analyze with Ocean Analyzer";
  var LABEL_TR = "Ocean Analyzer ile Analiz Et";
  var pendingTarget = null;
  var menuObserver = null;
  var observerTimer = null;
  var standalone = null;

  function label() {
    var lang = (document.documentElement.getAttribute("lang") || navigator.language || "en").toLowerCase();
    return lang.indexOf("tr") === 0 ? LABEL_TR : LABEL_EN;
  }

  function oceanIcon() {
    var span = document.createElement("span");
    span.textContent = "🌊";
    span.style.cssText = "font-size:14px;line-height:1;flex-shrink:0;width:16px;text-align:center;";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function openAnalyzer(target) {
    hideStandalone();
    closeSpotifyMenu();
    window.OceanAnalyzerModal.open(target);
  }

  function closeSpotifyMenu() {
    // Dismiss Spotify's menu the way the user would, without touching its logic.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  // ---- 1. inject into Spotify's own menu ----
  function findMenu() {
    return document.querySelector('#context-menu [role="menu"], [data-testid="context-menu"] [role="menu"], #context-menu ul[role="menu"], [role="menu"]');
  }

  function injectInto(menu, target) {
    if (!menu || menu.querySelector("[" + MARK + "]")) return false;

    var native = menu.querySelector('li [role="menuitem"], [role="menuitem"]');
    var row = document.createElement("div");
    row.setAttribute(MARK, "1");
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "0");

    // Mirror the native item's own computed look rather than hard-coding
    // Spotify's (hashed, changing) class names.
    var base = "display:flex;align-items:center;gap:12px;cursor:pointer;font-size:14px;";
    if (native) {
      var cs = getComputedStyle(native);
      row.style.cssText = base +
        "padding:" + cs.padding + ";" +
        "color:" + cs.color + ";" +
        "font-family:" + cs.fontFamily + ";" +
        "font-weight:" + cs.fontWeight + ";" +
        "border-radius:" + cs.borderRadius + ";";
    } else {
      row.style.cssText = base + "padding:12px;color:#fff;border-radius:4px;";
    }
    row.appendChild(oceanIcon());
    var text = document.createElement("span");
    text.textContent = label();
    row.appendChild(text);

    row.addEventListener("mouseenter", function () { row.style.backgroundColor = "rgba(255,255,255,0.1)"; });
    row.addEventListener("mouseleave", function () { row.style.backgroundColor = "transparent"; });
    row.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openAnalyzer(target); });
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAnalyzer(target); }
    });

    // Match the list structure so Spotify's own styles apply cleanly.
    var listItem = menu.querySelector("li");
    if (listItem && listItem.parentElement) {
      var li = document.createElement("li");
      li.setAttribute(MARK + "-li", "1");
      li.appendChild(row);
      listItem.parentElement.appendChild(li);
    } else {
      menu.appendChild(row);
    }

    // A separator above our row, when Spotify uses them.
    return true;
  }

  /**
   * Watch briefly for Spotify's menu to appear, inject once, then stop.
   * The observer never lives longer than the menu it is waiting for.
   */
  function watchForMenu(target) {
    stopWatching();
    var attempts = 0;

    var tryInject = function () {
      var menu = findMenu();
      if (menu && injectInto(menu, target)) {
        stopWatching();
        watchForMenuClose(menu);
        return true;
      }
      return false;
    };

    if (tryInject()) return true;

    menuObserver = new MutationObserver(function () {
      if (++attempts > 40) { stopWatching(); return; }
      tryInject();
    });
    // Scoped to child additions on body — not attributes, not deep text.
    menuObserver.observe(document.body, { childList: true, subtree: true });
    observerTimer = setTimeout(stopWatching, 1500);
    return false;
  }

  function stopWatching() {
    if (menuObserver) { menuObserver.disconnect(); menuObserver = null; }
    if (observerTimer) { clearTimeout(observerTimer); observerTimer = null; }
  }

  /** When the menu goes away, drop any state we kept for it. */
  function watchForMenuClose(menu) {
    var closeObserver = new MutationObserver(function () {
      if (!menu.isConnected) { closeObserver.disconnect(); pendingTarget = null; }
    });
    closeObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { closeObserver.disconnect(); }, 30000);
  }

  // ---- 2. standalone fallback menu ----
  function hideStandalone() {
    if (standalone && standalone.isConnected) standalone.remove();
    standalone = null;
  }

  function showStandalone(x, y, target) {
    hideStandalone();
    var menu = document.createElement("div");
    menu.setAttribute(MARK + "-standalone", "1");
    menu.style.cssText = [
      "position:fixed", "z-index:2147482900", "background:#282828", "border:1px solid #3e3e3e",
      "border-radius:4px", "box-shadow:0 16px 24px rgba(0,0,0,.3),0 6px 8px rgba(0,0,0,.2)",
      "padding:4px", "min-width:220px",
      'font-family:"CircularSp","Spotify Circular",Inter,-apple-system,sans-serif',
      "font-size:14px", "color:#fff",
    ].join(";");

    var row = document.createElement("div");
    row.setAttribute("role", "menuitem");
    row.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px;border-radius:2px;cursor:pointer;";
    row.appendChild(oceanIcon());
    var text = document.createElement("span");
    text.textContent = label();
    row.appendChild(text);
    row.addEventListener("mouseenter", function () { row.style.backgroundColor = "rgba(255,255,255,0.1)"; });
    row.addEventListener("mouseleave", function () { row.style.backgroundColor = "transparent"; });
    row.addEventListener("click", function () { openAnalyzer(target); });
    menu.appendChild(row);

    document.documentElement.appendChild(menu);
    // Keep the menu on screen.
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
    standalone = menu;

    var dismiss = function (ev) {
      if (standalone && !standalone.contains(ev.target)) {
        hideStandalone();
        document.removeEventListener("mousedown", dismiss, true);
        document.removeEventListener("scroll", dismiss, true);
      }
    };
    setTimeout(function () {
      document.addEventListener("mousedown", dismiss, true);
      document.addEventListener("scroll", dismiss, true);
    }, 0);
  }

  // ---- entry point ----
  document.addEventListener("contextmenu", function (event) {
    hideStandalone();
    var target = window.OceanAnalyzerTarget.resolveTarget(event);
    // No identifier → offer nothing. A display name is never used as a guess.
    if (!target) { stopWatching(); return; }
    pendingTarget = target;

    var x = event.clientX, y = event.clientY;
    var injected = watchForMenu(target);
    if (!injected) {
      // Give Spotify a moment to open its own menu; if it doesn't, show ours.
      setTimeout(function () {
        if (pendingTarget !== target) return;
        var menu = findMenu();
        if (!menu || !menu.querySelector("[" + MARK + "]")) showStandalone(x, y, target);
      }, 260);
    }
  }, true);

  // Escape closes our standalone menu too.
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideStandalone(); }, true);

  console.log("[Ocean Analyzer] context menu ready");
})();
