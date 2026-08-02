/*
 * spotifyTargetResolver — work out WHICH Spotify entity was right-clicked.
 *
 * Resolution is identifier-driven, never text-driven: a display name in the DOM
 * is never used to guess a track. Only real Spotify identifiers count — a
 * `spotify:` URI, an /track|album|artist|playlist/{id} href, or a testid that
 * carries one. If no identifier is found, the menu item is simply not offered.
 *
 * Selectors are deliberately layered (URI → href → data-testid → row context)
 * because Spotify's class names are hashed and change without notice.
 */
(function () {
  "use strict";

  var ID = "[A-Za-z0-9]{22}";
  var URI_RE = new RegExp("^spotify:(track|album|artist|playlist):(" + ID + ")$");
  var PATH_RE = new RegExp("/(track|album|artist|playlist)/(" + ID + ")(?:[/?#]|$)");

  function fromUri(value) {
    var m = URI_RE.exec(String(value || "").trim());
    return m ? { kind: m[1], id: m[2] } : null;
  }

  function fromHref(value) {
    if (!value) return null;
    var path;
    try {
      // Relative hrefs ("/track/xyz") resolve against the current page.
      path = new URL(String(value), "https://open.spotify.com").pathname;
    } catch (e) { return null; }
    var m = PATH_RE.exec(path);
    return m ? { kind: m[1], id: m[2] } : null;
  }

  /** Any attribute on this element that carries a usable identifier. */
  function fromElement(el) {
    if (!el || el.nodeType !== 1) return null;

    var attrs = ["data-uri", "data-context-uri", "data-test-uri", "data-testid"];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute && el.getAttribute(attrs[i]);
      if (!v) continue;
      var byUri = fromUri(v);
      if (byUri) return byUri;
      // Some testids embed the uri, e.g. "tracklist-row-spotify:track:xyz".
      var embedded = URI_RE.exec(v) || new RegExp("spotify:(track|album|artist|playlist):(" + ID + ")").exec(v);
      if (embedded) return { kind: embedded[1], id: embedded[2] };
    }

    if (el.tagName === "A") {
      var byHref = fromHref(el.getAttribute("href"));
      if (byHref) return byHref;
    }
    return null;
  }

  /**
   * Resolve the entity for a right-click event.
   * Order: the exact element → its ancestors → identifying links inside the
   * closest row/card → the page URL as a last resort.
   */
  function resolveTarget(event) {
    var start = event && (event.target || event.srcElement);
    if (!start || start.nodeType !== 1) start = document.activeElement;

    // 1. The element itself and every ancestor (covers rows, cards, art, links).
    var node = start;
    var depth = 0;
    while (node && node.nodeType === 1 && depth++ < 25) {
      var hit = fromElement(node);
      if (hit) return withContext(hit, node, "element");
      node = node.parentElement;
    }

    // 2. Identifying links inside the closest row / grid cell / card.
    var container = start.closest
      ? start.closest('[data-testid="tracklist-row"], [role="row"], [role="gridcell"], [data-testid*="card"], li, article')
      : null;
    if (container) {
      var links = container.querySelectorAll('a[href], [data-uri], [data-context-uri]');
      var best = null;
      for (var i = 0; i < links.length; i++) {
        var cand = fromElement(links[i]) || fromHref(links[i].getAttribute && links[i].getAttribute("href"));
        if (!cand) continue;
        // A track link wins over the album/artist links that share the row.
        if (cand.kind === "track") { best = cand; break; }
        if (!best) best = cand;
      }
      if (best) return withContext(best, container, "row");
    }

    // 3. The page itself (right-clicking empty space on a track/album page).
    var byPage = fromHref(window.location.pathname);
    if (byPage) return withContext(byPage, document.body, "page");
    return null;
  }

  /**
   * Attach a display hint (title/artwork) so the modal can render something
   * immediately while the real metadata loads. These are hints ONLY — the
   * analysis itself always uses the resolved id.
   */
  function withContext(hit, node, via) {
    var title = null, artwork = null;
    try {
      var link = node.querySelector
        ? node.querySelector('a[href*="/' + hit.kind + '/' + hit.id + '"]')
        : null;
      if (link) title = (link.textContent || "").trim() || link.getAttribute("aria-label");
      if (!title && node.getAttribute) title = node.getAttribute("aria-label");
      var img = node.querySelector ? node.querySelector("img[src]") : null;
      if (img) artwork = img.getAttribute("src");
    } catch (e) { /* hints are optional */ }
    return {
      kind: hit.kind,
      id: hit.id,
      via: via,
      hint: {
        title: title ? String(title).slice(0, 200) : null,
        artworkUrl: artwork && /^https:\/\//.test(artwork) ? artwork : null,
      },
    };
  }

  window.OceanAnalyzerTarget = { resolveTarget: resolveTarget, fromUri: fromUri, fromHref: fromHref };
})();
