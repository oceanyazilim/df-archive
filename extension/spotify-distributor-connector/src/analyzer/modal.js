/*
 * OceanAnalyzerModal — the analysis window rendered over Spotify.
 *
 * Everything lives inside a shadow root, so Spotify's stylesheet cannot reach
 * in and this CSS cannot leak out. Exactly ONE modal instance ever exists;
 * opening a new target re-renders it in place rather than stacking windows.
 *
 * Only real data is displayed. Any section whose upstream data is missing says
 * so; nothing is estimated unless it is explicitly labelled "Estimated".
 */
(function () {
  "use strict";

  var LOCALE = navigator.language || undefined;
  var instance = null;

  var TAB_SETS = {
    track: ["overview", "streams", "playlists", "markets", "metadata", "links"],
    album: ["overview", "tracks", "metadata"],
    artist: ["overview", "releases", "tracks"],
    playlist: ["overview", "tracks", "artists"],
  };
  var TAB_LABELS = {
    overview: "Overview", streams: "Streams", playlists: "Playlists", audience: "Audience",
    markets: "Markets", metadata: "Metadata", links: "Links", tracks: "Tracks",
    releases: "Releases", artists: "Artists",
  };
  var KIND_SUBTITLE = { track: "Track Analytics", album: "Album Analytics", artist: "Artist Analytics", playlist: "Playlist Analytics" };

  // ---------- small helpers ----------
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function num(n) { return typeof n === "number" && isFinite(n) ? n.toLocaleString(LOCALE) : null; }
  function compact(n) { return window.OceanAnalyzerChart.fmtCompact(n, LOCALE); }
  function durationOf(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return null;
    var total = Math.round(ms / 1000);
    var h_ = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return (h_ ? h_ + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
  }
  function dateOf(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(LOCALE, { year: "numeric", month: "short", day: "numeric" });
  }
  function ago(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " minute" + (s < 120 ? "" : "s") + " ago";
    if (s < 86400) return Math.floor(s / 3600) + " hour" + (s < 7200 ? "" : "s") + " ago";
    return Math.floor(s / 86400) + " day" + (s < 172800 ? "" : "s") + " ago";
  }
  function sum(points) { return (points || []).reduce(function (a, p) { return a + p.value; }, 0); }

  function card(label, value, sub, opts) {
    opts = opts || {};
    var labelNode = h("div", { class: "oa-card-label" }, [
      h("span", { text: label }),
      opts.estimated ? h("span", { class: "oa-est", text: "Est" }) : null,
    ]);
    var valueNode = h("div", { class: "oa-card-value" + (value === null ? " oa-muted" : ""), text: value === null ? "Unavailable" : value });
    if (opts.tone === "up") valueNode.classList.add("oa-up");
    if (opts.tone === "down") valueNode.classList.add("oa-down");
    return h("div", { class: "oa-card", title: opts.title || "" }, [
      labelNode, valueNode, sub ? h("div", { class: "oa-card-sub", text: sub }) : null,
    ]);
  }

  function kv(key, value, mono, onCopy) {
    var hasValue = value !== null && value !== undefined && value !== "";
    return h("div", { class: "oa-kv-item" }, [
      h("div", { class: "oa-kv-k" }, [
        h("span", { text: key }),
        hasValue && onCopy ? h("button", { class: "oa-copy", text: "Copy", onclick: function (e) { onCopy(String(value), e.currentTarget); } }) : null,
      ]),
      h("div", { class: "oa-kv-v" + (mono ? " oa-mono" : ""), text: hasValue ? String(value) : "—" }),
    ]);
  }

  function emptyState(message, hint, onRetry) {
    return h("div", { class: "oa-empty" }, [
      h("div", { text: message }),
      hint ? h("div", { class: "oa-empty-hint", text: hint }) : null,
      onRetry ? h("button", { class: "oa-retry", text: "Retry", onclick: onRetry }) : null,
    ]);
  }

  function skeleton(height, width) {
    return h("div", { class: "oa-skel", style: "height:" + height + "px" + (width ? ";width:" + width : "") });
  }

  // ---------- the modal ----------
  function OceanAnalyzerModal() {
    var self = this;
    this.host = document.createElement("div");
    this.host.id = "ocean-analyzer-root";
    this.shadow = this.host.attachShadow({ mode: "open" });

    var style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = chrome.runtime.getURL("src/analyzer/modal.css");
    this.shadow.appendChild(style);

    this.overlay = h("div", { class: "oa-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Ocean Analyzer" });
    this.overlay.addEventListener("mousedown", function (e) { if (e.target === self.overlay) self.close(); });
    this.shadow.appendChild(this.overlay);

    this.onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); self.close(); } };

    this.state = { target: null, data: null, error: null, tab: "overview", days: 30, chartType: "area", chartView: "daily", stack: [] };
  }

  OceanAnalyzerModal.prototype.open = function (target) {
    if (!this.host.isConnected) {
      document.documentElement.appendChild(this.host);
      document.addEventListener("keydown", this.onKey, true);
      this.prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    this.state.stack = [];
    this.load(target);
  };

  OceanAnalyzerModal.prototype.close = function () {
    if (this.abort) { try { this.abort(); } catch (e) { /* already done */ } this.abort = null; }
    document.removeEventListener("keydown", this.onKey, true);
    if (this.host.isConnected) this.host.remove();
    document.body.style.overflow = this.prevOverflow || "";
  };

  /** Load a target; a new load supersedes any in-flight one. */
  OceanAnalyzerModal.prototype.load = function (target) {
    var self = this;
    this.state.target = target;
    this.state.data = null;
    this.state.error = null;
    this.state.tab = "overview";
    this.render();

    var token = (this.loadToken = (this.loadToken || 0) + 1);
    this.abort = window.OceanAnalyzerBridge.fetchTarget(target, this.state.days, function (err, result) {
      if (token !== self.loadToken) return; // superseded
      if (err) { self.state.error = err; self.state.data = null; }
      else { self.state.data = result; self.state.error = null; }
      self.render();
    });
  };

  /** Drill into a track from an album/playlist without closing the modal. */
  OceanAnalyzerModal.prototype.drillTo = function (target) {
    if (this.state.target) this.state.stack.push(this.state.target);
    var stack = this.state.stack;
    this.load(target);
    this.state.stack = stack;
  };

  OceanAnalyzerModal.prototype.back = function () {
    var prev = this.state.stack.pop();
    if (!prev) return;
    var stack = this.state.stack;
    this.load(prev);
    this.state.stack = stack;
  };

  OceanAnalyzerModal.prototype.copy = function (value, btn) {
    navigator.clipboard.writeText(value).then(function () {
      var old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = old; }, 1200);
    }).catch(function () { /* clipboard denied — silent */ });
  };

  OceanAnalyzerModal.prototype.render = function () {
    var self = this;
    var s = this.state;
    var target = s.target || {};
    var data = s.data && s.data.data;
    var kind = (data && data.kind) || target.kind || "track";

    this.overlay.textContent = "";

    var modal = h("div", { class: "oa-modal" });

    // ----- header -----
    var titleBlock = h("div", {}, [
      h("h2", { class: "oa-title", text: "Ocean Analyzer" }),
      h("div", { class: "oa-subtitle" }, s.stack.length
        ? [h("button", { class: "oa-crumb", text: "← Back", onclick: function () { self.back(); } }), document.createTextNode(" · " + (KIND_SUBTITLE[kind] || "Analytics"))]
        : [document.createTextNode(KIND_SUBTITLE[kind] || "Analytics")]),
    ]);
    modal.appendChild(h("div", { class: "oa-head" }, [
      titleBlock,
      h("button", { class: "oa-close", text: "✕", title: "Close (Esc)", "aria-label": "Close", onclick: function () { self.close(); } }),
    ]));

    // ----- identity -----
    modal.appendChild(this.renderIdentity(kind, data, target));

    // ----- tabs -----
    var tabs = TAB_SETS[kind] || TAB_SETS.track;
    if (s.tab && tabs.indexOf(s.tab) === -1) s.tab = tabs[0];
    var tabBar = h("div", { class: "oa-tabs", role: "tablist" });
    tabs.forEach(function (id) {
      tabBar.appendChild(h("button", {
        class: "oa-tab" + (s.tab === id ? " active" : ""), role: "tab", text: TAB_LABELS[id] || id,
        onclick: function () { s.tab = id; self.render(); },
      }));
    });
    modal.appendChild(tabBar);

    // ----- body -----
    var body = h("div", { class: "oa-body" });
    if (s.error && !data) {
      body.appendChild(emptyState(
        "Detailed metadata could not be loaded.",
        s.error.message || "The analyzer service did not respond.",
        function () { self.load(s.target); }
      ));
    } else if (!data) {
      body.appendChild(this.renderSkeleton());
    } else {
      this.renderTab(body, kind, data);
    }
    modal.appendChild(body);

    // ----- footer -----
    var sourceText = data
      ? "Source: " + (kind === "track" && data.streams && data.streams.state === "available" ? "Spotify + Soundcharts" : "Spotify")
      : "Source: —";
    var updated = s.data && s.data.fetchedAt ? " · Last updated " + ago(s.data.fetchedAt) : "";
    modal.appendChild(h("div", { class: "oa-foot" }, [
      h("div", { class: "oa-source", text: sourceText + updated }),
      h("div", { class: "oa-foot-actions" }, [
        h("button", {
          class: "oa-btn primary", text: "Open Full Dashboard",
          onclick: function () { window.OceanAnalyzerBridge.openDashboard(s.target); },
        }),
      ]),
    ]));

    this.overlay.appendChild(modal);
  };

  OceanAnalyzerModal.prototype.renderSkeleton = function () {
    return h("div", {}, [
      skeleton(92), h("div", { style: "height:12px" }),
      h("div", { class: "oa-cards" }, [skeleton(72), skeleton(72), skeleton(72), skeleton(72)]),
      skeleton(300),
    ]);
  };

  OceanAnalyzerModal.prototype.renderIdentity = function (kind, data, target) {
    var artwork = (data && (data.artworkUrl || data.imageUrl)) || (target.hint && target.hint.artworkUrl) || null;
    var name = (data && (data.title || data.name)) || (target.hint && target.hint.title) || "Loading…";
    var sub = "", facts = [];

    if (data && kind === "track") {
      sub = (data.artists || []).map(function (a) { return a.name; }).join(", ");
      if (data.albumTitle) sub += (sub ? " · " : "") + data.albumTitle;
      if (data.durationMs) facts.push(["Duration", durationOf(data.durationMs)]);
      if (data.releaseDate) facts.push(["Released", dateOf(data.releaseDate)]);
      if (data.explicit !== null) facts.push(["Explicit", data.explicit ? "Yes" : "No"]);
      if (data.popularity !== null) facts.push(["Popularity", data.popularity + "/100"]);
      facts.push(["Distributor", data.distributor.status === "verified" ? data.distributor.name : "Unknown distributor"]);
    } else if (data && kind === "album") {
      sub = (data.artists || []).map(function (a) { return a.name; }).join(", ");
      facts.push(["Tracks", String(data.totalTracks)]);
      if (data.totalDurationMs) facts.push(["Duration", durationOf(data.totalDurationMs)]);
      if (data.releaseDate) facts.push(["Released", dateOf(data.releaseDate)]);
      if (data.label) facts.push(["Label", data.label]);
    } else if (data && kind === "artist") {
      sub = (data.genres || []).slice(0, 3).join(", ");
      if (data.followers !== null) facts.push(["Followers", num(data.followers)]);
      if (data.popularity !== null) facts.push(["Popularity", data.popularity + "/100"]);
      facts.push(["Releases", String((data.releases || []).length)]);
    } else if (data && kind === "playlist") {
      sub = data.owner ? "by " + data.owner : "";
      facts.push(["Tracks", String(data.totalTracks)]);
      if (data.followers !== null) facts.push(["Followers", num(data.followers)]);
      if (data.totalDurationMs) facts.push(["Duration", durationOf(data.totalDurationMs)]);
      if (data.isPublic !== null) facts.push(["Visibility", data.isPublic ? "Public" : "Private"]);
    }

    var factNodes = facts.filter(function (f) { return f[1]; }).map(function (f) {
      return h("span", {}, [document.createTextNode(f[0] + ": "), h("b", { text: f[1] })]);
    });

    return h("div", { class: "oa-identity" }, [
      artwork ? h("img", { class: "oa-art", src: artwork, alt: "", loading: "lazy" }) : h("div", { class: "oa-art-fallback", text: "♪" }),
      h("div", { class: "oa-id-main" }, [
        h("p", { class: "oa-id-name", text: name }),
        h("p", { class: "oa-id-sub", text: sub || (data ? "" : "Loading metadata…") }),
        factNodes.length ? h("div", { class: "oa-id-facts" }, factNodes) : null,
      ]),
    ]);
  };

  OceanAnalyzerModal.prototype.renderTab = function (body, kind, data) {
    if (kind === "track") return this.renderTrackTab(body, data);
    if (kind === "album") return this.renderAlbumTab(body, data);
    if (kind === "artist") return this.renderArtistTab(body, data);
    if (kind === "playlist") return this.renderPlaylistTab(body, data);
  };

  // ---------- track ----------
  OceanAnalyzerModal.prototype.renderTrackTab = function (body, data) {
    var self = this, s = this.state, tab = s.tab;
    var streams = data.streams || { state: "empty", points: [] };
    var pts = streams.points || [];
    var available = streams.state === "available" && pts.length > 0;

    if (tab === "overview" || tab === "streams") {
      // Hero: only ever shows a real total.
      if (available) {
        var total = sum(pts);
        var avg = total / pts.length;
        body.appendChild(h("div", { class: "oa-hero" }, [
          h("div", { class: "oa-hero-label", text: "Total Spotify streams · last " + pts.length + " days" }),
          h("div", { class: "oa-hero-value", text: num(Math.round(total)) }),
          h("div", { class: "oa-hero-sub", text: "Daily average: " + num(Math.round(avg)) + " streams" }),
        ]));
      } else {
        body.appendChild(h("div", { class: "oa-hero oa-hero-empty" }, [
          h("div", { class: "oa-hero-label", text: "Spotify streams" }),
          h("div", { class: "oa-hero-value", text: "Stream data unavailable" }),
          h("div", { class: "oa-hero-sub", text: streamsReason(streams.state) }),
        ]));
      }

      body.appendChild(this.renderTrackCards(data, pts, available, tab));
      body.appendChild(this.renderChart(data, pts, available, streams.state));
    }

    if (tab === "streams" && available) {
      body.appendChild(h("h4", { class: "oa-section-title", text: "Distribution" }));
      var sorted = pts.map(function (p) { return p.value; }).sort(function (a, b) { return a - b; });
      var median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      var peak = pts.reduce(function (m, p) { return p.value > m.value ? p : m; }, pts[0]);
      var low = pts.reduce(function (m, p) { return p.value < m.value ? p : m; }, pts[0]);
      body.appendChild(h("div", { class: "oa-cards" }, [
        card("Peak day", num(Math.round(peak.value)), dateOf(peak.date)),
        card("Lowest day", num(Math.round(low.value)), dateOf(low.date)),
        card("Median", num(Math.round(median)), "per day"),
        card("Days covered", String(pts.length), "with data"),
      ]));
    }

    if (tab === "playlists") {
      body.appendChild(emptyState(
        "Playlist placements are not part of this response.",
        "Open the full dashboard for playlist, chart and radio data on this track."
      ));
    }

    if (tab === "markets") {
      body.appendChild(h("div", { class: "oa-cards" }, [
        card("Available markets", data.availableMarkets !== null ? num(data.availableMarkets) : null, data.availableMarkets !== null ? "countries where the track is playable" : "no longer exposed by Spotify"),
      ]));
      body.appendChild(emptyState(
        "Per-country stream data is not available on the current plan.",
        "Market-level analytics require a Soundcharts plan that includes them."
      ));
    }

    if (tab === "metadata") {
      var d = data.distributor;
      body.appendChild(h("div", { class: "oa-kv" }, [
        kv("Spotify track ID", data.spotifyTrackId, true, copyFn(self)),
        kv("Album ID", data.albumId, true, copyFn(self)),
        kv("Artist IDs", (data.artists || []).map(function (a) { return a.id; }).filter(Boolean).join(", ") || null, true, copyFn(self)),
        kv("ISRC", data.isrc, true, copyFn(self)),
        kv("UPC", data.upc, true, copyFn(self)),
        kv("Label", data.label, false, copyFn(self)),
        kv("Distributor", d.status === "verified" ? d.name : "Unknown distributor", false, d.status === "verified" ? copyFn(self) : null),
        kv("Licensor UUID", d.licensorUuid, true, copyFn(self)),
        kv("Release date", dateOf(data.releaseDate), false, null),
        kv("Duration", durationOf(data.durationMs), false, null),
        kv("Explicit", data.explicit === null ? null : data.explicit ? "Yes" : "No", false, null),
        kv("Track number", data.trackNumber ? data.trackNumber + (data.discNumber ? " (disc " + data.discNumber + ")" : "") : null, false, null),
        kv("Available markets", data.availableMarkets !== null ? String(data.availableMarkets) : null, false, null),
        kv("Copyright", (data.copyrights || [])[0] || null, false, copyFn(self)),
        kv("Phonographic copyright", (data.copyrights || [])[1] || null, false, copyFn(self)),
      ]));
    }

    if (tab === "links") {
      var links = data.links || [];
      if (!links.length) body.appendChild(emptyState("No external links are available for this track."));
      else {
        body.appendChild(h("div", { class: "oa-links" }, links.map(function (l) {
          return h("a", { class: "oa-link", href: l.url, target: "_blank", rel: "noopener noreferrer" }, [
            h("span", { class: "oa-link-ico", text: l.name.slice(0, 1).toUpperCase() }),
            h("span", { class: "oa-ellipsis", text: l.name }),
            h("span", { class: "oa-link-ext", text: "↗" }),
          ]);
        })));
      }
    }
  };

  function streamsReason(state) {
    if (state === "not_configured") return "Streaming analytics are not configured.";
    if (state === "plan_restricted") return "Streaming analytics are not included in the current plan.";
    if (state === "unavailable") return "The analytics service did not respond.";
    return "No stream data was found for this track.";
  }
  function copyFn(modal) { return function (value, btn) { modal.copy(value, btn); }; }

  OceanAnalyzerModal.prototype.renderTrackCards = function (data, pts, available, tab) {
    var cards = [];
    if (available) {
      var total = sum(pts);
      var last7 = pts.slice(-7), prev7 = pts.slice(-14, -7);
      var last7Sum = sum(last7), prev7Sum = sum(prev7);
      var growth = prev7Sum > 0 ? ((last7Sum - prev7Sum) / prev7Sum) * 100 : null;
      var peak = pts.reduce(function (m, p) { return p.value > m.value ? p : m; }, pts[0]);
      cards.push(card("Last 7 days", num(Math.round(last7Sum)), last7.length + " days"));
      if (pts.length >= 28) cards.push(card("Last 28 days", num(Math.round(sum(pts.slice(-28)))), "28 days"));
      cards.push(card("Daily average", num(Math.round(total / pts.length)), "across " + pts.length + " days"));
      cards.push(card("Peak daily", num(Math.round(peak.value)), dateOf(peak.date)));
      cards.push(card(
        "Growth · 7d",
        growth === null ? null : (growth >= 0 ? "+" : "") + growth.toFixed(1) + "%",
        growth === null ? "needs 14 days of data" : "vs previous 7 days",
        { tone: growth === null ? null : growth >= 0 ? "up" : "down" }
      ));
    }
    cards.push(card("Spotify popularity", data.popularity !== null ? data.popularity + " / 100" : null, data.popularity !== null ? "Spotify's own index" : "no longer exposed by Spotify"));
    if (tab === "overview") {
      var d = data.distributor;
      cards.push(card(
        "Distributor",
        d.status === "verified" ? d.name : "Unknown",
        d.status === "verified" ? "exact UUID match" : distributorReason(d.status),
        { title: "Resolved only by exact licensor-UUID match against the canonical mapping." }
      ));
    }
    return h("div", { class: "oa-cards" }, cards);
  };

  function distributorReason(status) {
    if (status === "uuid_not_mapped") return "licensor UUID not in mapping";
    if (status === "conflict") return "conflicting mapping";
    if (status === "invalid_uuid") return "invalid licensor UUID";
    return "licensor UUID not captured";
  }

  OceanAnalyzerModal.prototype.renderChart = function (data, pts, available, state) {
    var self = this, s = this.state;
    var panel = h("div", { class: "oa-chart-panel" });

    var ranges = [[7, "7D"], [28, "28D"], [30, "30D"], [90, "90D"], [180, "6M"], [365, "1Y"]];
    var rangeSeg = h("div", { class: "oa-seg" }, ranges.map(function (r) {
      return h("button", {
        class: s.days === r[0] ? "active" : "", text: r[1],
        onclick: function () { s.days = r[0]; self.load(s.target); },
      });
    }));
    var viewSeg = h("div", { class: "oa-seg" }, [["daily", "Daily"], ["cumulative", "Cumulative"]].map(function (v) {
      return h("button", {
        class: s.chartView === v[0] ? "active" : "", text: v[1],
        onclick: function () { s.chartView = v[0]; self.render(); },
      });
    }));
    var typeSeg = h("div", { class: "oa-seg" }, [["line", "Line"], ["area", "Area"], ["bar", "Bar"]].map(function (t) {
      return h("button", {
        class: s.chartType === t[0] ? "active" : "", text: t[1], disabled: t[0] === "bar" && s.chartView === "cumulative" ? "" : null,
        onclick: function () { s.chartType = t[0]; self.render(); },
      });
    }));

    panel.appendChild(h("div", { class: "oa-chart-head" }, [
      h("div", {}, [
        h("h4", { class: "oa-chart-title", text: "Spotify stream trend" }),
        h("p", { class: "oa-chart-desc", text: available ? "Daily streams over the selected period — real Soundcharts data" : "No data for the selected period" }),
      ]),
      h("div", { class: "oa-controls" }, [viewSeg, typeSeg, rangeSeg]),
    ]));

    if (available) {
      var host = h("div", {});
      panel.appendChild(host);
      window.OceanAnalyzerChart.render(host, window.OceanAnalyzerChart.withGaps(pts), {
        type: s.chartType, view: s.chartView, unit: "streams", locale: LOCALE,
      });
    } else {
      panel.appendChild(emptyState(
        state === "empty" ? "No analytics data is available for this period." : streamsReason(state),
        state === "empty" ? "Try a longer date range." : null,
        function () { self.load(s.target); }
      ));
    }
    return panel;
  };

  // ---------- album ----------
  OceanAnalyzerModal.prototype.renderAlbumTab = function (body, data) {
    var self = this;
    if (this.state.tab === "overview" || this.state.tab === "tracks") {
      body.appendChild(h("div", { class: "oa-cards" }, [
        card("Tracks", String(data.totalTracks), data.releaseType || ""),
        card("Total duration", durationOf(data.totalDurationMs), ""),
        card("Released", dateOf(data.releaseDate), ""),
        card("Album popularity", data.popularity !== null ? data.popularity + " / 100" : null, "Spotify's own index"),
      ]));
      body.appendChild(h("h4", { class: "oa-section-title", text: "Tracks — click any row to analyze it" }));
      var rows = (data.tracks || []).map(function (t) {
        return h("tr", {
          class: "oa-clickable", title: "Analyze " + t.title,
          onclick: function () { self.drillTo({ kind: "track", id: t.spotifyTrackId, hint: { title: t.title, artworkUrl: data.artworkUrl } }); },
        }, [
          h("td", { text: String(t.trackNumber || "") }),
          h("td", {}, [h("div", { class: "oa-ellipsis", text: t.title })]),
          h("td", {}, [h("div", { class: "oa-ellipsis", text: (t.artists || []).join(", ") })]),
          h("td", { class: "oa-mono", text: t.isrc || "—" }),
          h("td", { text: durationOf(t.durationMs) || "—" }),
          h("td", { text: t.explicit ? "Yes" : "No" }),
        ]);
      });
      body.appendChild(h("div", { class: "oa-table-wrap" }, [
        h("table", { class: "oa-table" }, [
          h("thead", {}, [h("tr", {}, ["#", "Title", "Artists", "ISRC", "Duration", "Explicit"].map(function (c) { return h("th", { text: c }); }))]),
          h("tbody", {}, rows.length ? rows : [h("tr", {}, [h("td", { colspan: "6", text: "No tracks were returned for this album." })])]),
        ]),
      ]));
    }

    if (this.state.tab === "metadata") {
      body.appendChild(h("div", { class: "oa-kv" }, [
        kv("Album ID", data.spotifyAlbumId, true, copyFn(self)),
        kv("UPC", data.upc, true, copyFn(self)),
        kv("Label", data.label, false, copyFn(self)),
        kv("Release type", data.releaseType, false, null),
        kv("Release date", dateOf(data.releaseDate), false, null),
        kv("Total tracks", String(data.totalTracks), false, null),
        kv("Artists", (data.artists || []).map(function (a) { return a.name; }).join(", ") || null, false, copyFn(self)),
        kv("Copyright", (data.copyrights || [])[0] || null, false, copyFn(self)),
        kv("Phonographic copyright", (data.copyrights || [])[1] || null, false, copyFn(self)),
      ]));
      body.appendChild(h("div", { class: "oa-empty-hint", style: "margin-top:12px", text: "Per-track distributors are resolved individually — open a track to see its licensor UUID and distributor." }));
    }
  };

  // ---------- artist ----------
  OceanAnalyzerModal.prototype.renderArtistTab = function (body, data) {
    var self = this, tab = this.state.tab;
    var restricted = data.restricted || {};
    if (tab === "overview") {
      body.appendChild(h("div", { class: "oa-cards" }, [
        card("Followers", data.followers !== null ? num(data.followers) : null, restricted.profileStats ? "not exposed by Spotify" : "Spotify followers"),
        card("Popularity", data.popularity !== null ? data.popularity + " / 100" : null, restricted.profileStats ? "not exposed by Spotify" : "Spotify's own index"),
        card("Releases", String((data.releases || []).length), "albums & singles"),
        card("Top tracks", restricted.topTracks ? null : String((data.topTracks || []).length), restricted.topTracks ? "restricted by Spotify" : "in your market"),
      ]));
      if ((data.genres || []).length) {
        body.appendChild(h("h4", { class: "oa-section-title", text: "Genres" }));
        body.appendChild(h("div", { class: "oa-id-facts" }, data.genres.map(function (g) { return h("span", { class: "oa-badge muted", text: g }); })));
      }
      body.appendChild(h("div", { style: "height:14px" }));
      body.appendChild(emptyState(
        "Spotify no longer publishes follower counts, popularity, genres or top tracks to third-party apps.",
        "Releases are still available — open one to analyze its tracks."
      ));
    }
    if (tab === "releases") {
      var rows = (data.releases || []).map(function (r) {
        return h("tr", {
          class: "oa-clickable", title: "Analyze " + r.title,
          onclick: function () { self.drillTo({ kind: "album", id: r.spotifyAlbumId, hint: { title: r.title, artworkUrl: r.artworkUrl } }); },
        }, [
          h("td", {}, [h("div", { class: "oa-ellipsis", text: r.title })]),
          h("td", { text: r.releaseType || "—" }),
          h("td", { text: dateOf(r.releaseDate) || "—" }),
          h("td", { text: String(r.totalTracks || "—") }),
        ]);
      });
      body.appendChild(h("div", { class: "oa-table-wrap" }, [
        h("table", { class: "oa-table" }, [
          h("thead", {}, [h("tr", {}, ["Release", "Type", "Date", "Tracks"].map(function (c) { return h("th", { text: c }); }))]),
          h("tbody", {}, rows.length ? rows : [h("tr", {}, [h("td", { colspan: "4", text: "No releases were returned." })])]),
        ]),
      ]));
    }
    if (tab === "tracks") {
      if (restricted.topTracks) {
        body.appendChild(emptyState(
          "Spotify no longer exposes an artist's top tracks to third-party apps.",
          "Open a release from the Releases tab to analyze its tracks."
        ));
        return;
      }
      var trows = (data.topTracks || []).map(function (t) {
        return h("tr", {
          class: "oa-clickable", title: "Analyze " + t.title,
          onclick: function () { self.drillTo({ kind: "track", id: t.spotifyTrackId, hint: { title: t.title, artworkUrl: t.artworkUrl } }); },
        }, [
          h("td", {}, [h("div", { class: "oa-ellipsis", text: t.title })]),
          h("td", {}, [h("div", { class: "oa-ellipsis", text: t.albumTitle || "—" })]),
          h("td", { text: t.popularity !== null ? String(t.popularity) : "—" }),
          h("td", { text: durationOf(t.durationMs) || "—" }),
        ]);
      });
      body.appendChild(h("div", { class: "oa-table-wrap" }, [
        h("table", { class: "oa-table" }, [
          h("thead", {}, [h("tr", {}, ["Top track", "Album", "Popularity", "Duration"].map(function (c) { return h("th", { text: c }); }))]),
          h("tbody", {}, trows.length ? trows : [h("tr", {}, [h("td", { colspan: "4", text: "No top tracks were returned." })])]),
        ]),
      ]));
    }
  };

  // ---------- playlist ----------
  OceanAnalyzerModal.prototype.renderPlaylistTab = function (body, data) {
    var self = this, tab = this.state.tab;
    if (tab === "overview") {
      body.appendChild(h("div", { class: "oa-cards" }, [
        card("Tracks", String(data.totalTracks), data.tracks.length < data.totalTracks ? "first " + data.tracks.length + " readable" : "all readable"),
        card("Followers", data.followers !== null ? num(data.followers) : null, "playlist followers"),
        card("Duration", durationOf(data.totalDurationMs), "of loaded tracks"),
        card("Visibility", data.isPublic === null ? null : data.isPublic ? "Public" : "Private", ""),
      ]));
      if (data.tracks.length < data.totalTracks) {
        body.appendChild(h("div", { class: "oa-empty-hint", style: "margin:-6px 0 12px", text:
          "Spotify only returns the first page of a playlist to third-party apps, so " + data.tracks.length + " of " + data.totalTracks + " tracks are shown." }));
      }
      if (data.description) {
        body.appendChild(h("h4", { class: "oa-section-title", text: "Description" }));
        body.appendChild(h("div", { class: "oa-card" }, [h("div", { text: data.description.replace(/<[^>]*>/g, "") })]));
      }
    }
    if (tab === "tracks") {
      var rows = (data.tracks || []).map(function (t) {
        return h("tr", {
          class: "oa-clickable", title: "Analyze " + t.title,
          onclick: function () { self.drillTo({ kind: "track", id: t.spotifyTrackId, hint: { title: t.title, artworkUrl: data.artworkUrl } }); },
        }, [
          h("td", {}, [h("div", { class: "oa-ellipsis", text: t.title })]),
          h("td", {}, [h("div", { class: "oa-ellipsis", text: (t.artists || []).join(", ") })]),
          h("td", { text: dateOf(t.releaseDate) || "—" }),
          h("td", { text: t.popularity !== null ? String(t.popularity) : "—" }),
          h("td", { text: dateOf(t.addedAt) || "—" }),
        ]);
      });
      body.appendChild(h("div", { class: "oa-table-wrap" }, [
        h("table", { class: "oa-table" }, [
          h("thead", {}, [h("tr", {}, ["Track", "Artists", "Released", "Popularity", "Added"].map(function (c) { return h("th", { text: c }); }))]),
          h("tbody", {}, rows.length ? rows : [h("tr", {}, [h("td", { colspan: "5", text: "No playable tracks were returned." })])]),
        ]),
      ]));
    }
    if (tab === "artists") {
      var arows = (data.topArtists || []).map(function (a) {
        return h("tr", {}, [h("td", {}, [h("div", { class: "oa-ellipsis", text: a.name })]), h("td", { text: String(a.count) })]);
      });
      body.appendChild(h("div", { class: "oa-table-wrap" }, [
        h("table", { class: "oa-table" }, [
          h("thead", {}, [h("tr", {}, ["Artist", "Tracks in playlist"].map(function (c) { return h("th", { text: c }); }))]),
          h("tbody", {}, arows.length ? arows : [h("tr", {}, [h("td", { colspan: "2", text: "No artists were counted." })])]),
        ]),
      ]));
    }
  };

  // Single shared instance — a second open() never stacks another window.
  function open(target) {
    if (!instance) instance = new OceanAnalyzerModal();
    instance.open(target);
  }
  function close() { if (instance) instance.close(); }

  window.OceanAnalyzerModal = { open: open, close: close };
})();
