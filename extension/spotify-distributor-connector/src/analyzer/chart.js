/*
 * AnalyzerChart — dependency-free SVG chart for the analyzer modal.
 *
 * Line / area / bar, daily / cumulative views, hover tooltip with the exact
 * date and value. Missing days are NOT drawn as zero: a gap in the source data
 * stays a visual gap, because "no data" and "no streams" are different facts.
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  function fmtCompact(n, locale) {
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Math.round(n).toLocaleString(locale);
  }
  function fmtDate(iso, locale, long) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale, long ? { year: "numeric", month: "long", day: "numeric" } : { month: "short", day: "numeric" });
  }
  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    return node;
  }

  /**
   * points: [{date, value}] — already in display order.
   * opts: { type: 'line'|'area'|'bar', view: 'daily'|'cumulative', unit, locale }
   */
  function render(container, points, opts) {
    opts = opts || {};
    var locale = opts.locale || undefined;
    var unit = opts.unit || "streams";
    var view = opts.view || "daily";
    var type = opts.type || "area";

    container.textContent = "";
    if (!points || !points.length) return;

    var series = points;
    if (view === "cumulative") {
      var acc = 0;
      series = points.map(function (p) { acc += p.value; return { date: p.date, value: acc, missing: p.missing }; });
    }

    var W = 940, H = 300, PADL = 58, PADR = 16, PADT = 14, PADB = 30;
    var iW = W - PADL - PADR, iH = H - PADT - PADB;
    var vals = series.map(function (p) { return p.value; });
    var max = Math.max.apply(null, vals.concat([1]));
    var min = view === "cumulative" ? 0 : Math.min.apply(null, vals.concat([0]));
    var span = (max - min) || 1;

    var x = function (i) { return PADL + (series.length === 1 ? iW / 2 : (i / (series.length - 1)) * iW); };
    var y = function (v) { return PADT + iH - ((v - min) / span) * iH; };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", class: "oa-chart-svg", role: "img" });

    var defs = el("defs");
    var grad = el("linearGradient", { id: "oaFill", x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#1db954", "stop-opacity": "0.35" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#1db954", "stop-opacity": "0.02" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      svg.appendChild(el("line", { class: "oa-grid", x1: PADL, x2: W - PADR, y1: PADT + iH * f, y2: PADT + iH * f }));
      var label = el("text", { class: "oa-axis", x: 8, y: PADT + iH * f + 3.5 });
      label.textContent = fmtCompact(max - (max - min) * f, locale);
      svg.appendChild(label);
    });

    // At most 6 date labels so they can never collide.
    var tickCount = Math.min(6, series.length);
    for (var k = 0; k < tickCount; k++) {
      var idx = tickCount === 1 ? 0 : Math.round((k / (tickCount - 1)) * (series.length - 1));
      var t = el("text", {
        class: "oa-axis", x: x(idx), y: H - 9,
        "text-anchor": k === 0 ? "start" : (k === tickCount - 1 ? "end" : "middle"),
      });
      t.textContent = fmtDate(series[idx].date, locale);
      svg.appendChild(t);
    }

    if (type === "bar" && view !== "cumulative") {
      var barW = Math.max(1.5, (iW / series.length) * 0.62);
      series.forEach(function (p, i) {
        if (p.missing) return; // a gap stays a gap
        svg.appendChild(el("rect", {
          class: "oa-bar", x: x(i) - barW / 2, y: y(p.value), width: barW,
          height: Math.max(0, (PADT + iH) - y(p.value)), rx: Math.min(2, barW / 2),
        }));
      });
    } else {
      // Split into runs of consecutive present points so gaps break the line.
      var runs = [], current = [];
      series.forEach(function (p, i) {
        if (p.missing) { if (current.length) { runs.push(current); current = []; } return; }
        current.push({ x: x(i), y: y(p.value) });
      });
      if (current.length) runs.push(current);

      runs.forEach(function (run) {
        var d = run.map(function (c, i) { return (i ? "L" : "M") + c.x.toFixed(1) + "," + c.y.toFixed(1); }).join(" ");
        if (type === "area" || view === "cumulative") {
          var area = d + " L" + run[run.length - 1].x.toFixed(1) + "," + (PADT + iH).toFixed(1) +
            " L" + run[0].x.toFixed(1) + "," + (PADT + iH).toFixed(1) + " Z";
          svg.appendChild(el("path", { class: "oa-area", d: area }));
        }
        svg.appendChild(el("path", { class: "oa-line", d: d }));
      });
    }

    // Hover crosshair + tooltip.
    var hoverLine = el("line", { class: "oa-hover-line", x1: 0, x2: 0, y1: PADT, y2: PADT + iH, style: "display:none" });
    var hoverDot = el("circle", { class: "oa-hover-dot", r: 3.5, style: "display:none" });
    svg.appendChild(hoverLine);
    svg.appendChild(hoverDot);

    var tip = document.createElement("div");
    tip.className = "oa-tooltip";
    tip.style.display = "none";

    svg.addEventListener("mousemove", function (ev) {
      var rect = svg.getBoundingClientRect();
      var rx = ((ev.clientX - rect.left) / rect.width) * W;
      var nearest = 0;
      for (var i = 1; i < series.length; i++) if (Math.abs(x(i) - rx) < Math.abs(x(nearest) - rx)) nearest = i;
      var p = series[nearest];
      hoverLine.setAttribute("x1", x(nearest));
      hoverLine.setAttribute("x2", x(nearest));
      hoverLine.style.display = "";
      if (p.missing) { hoverDot.style.display = "none"; } else {
        hoverDot.setAttribute("cx", x(nearest));
        hoverDot.setAttribute("cy", y(p.value));
        hoverDot.style.display = "";
      }
      tip.innerHTML = "";
      var dateEl = document.createElement("div");
      dateEl.className = "oa-tooltip-date";
      dateEl.textContent = fmtDate(p.date, locale, true);
      var valEl = document.createElement("div");
      valEl.className = "oa-tooltip-value";
      valEl.textContent = p.missing ? "No data for this day" : Math.round(p.value).toLocaleString(locale) + " " + unit;
      tip.appendChild(dateEl);
      tip.appendChild(valEl);
      tip.style.display = "";
      // Keep the tooltip inside the chart box.
      var relX = (x(nearest) / W) * rect.width;
      tip.style.left = Math.min(Math.max(relX + 12, 8), rect.width - 190) + "px";
      tip.style.top = "12px";
    });
    svg.addEventListener("mouseleave", function () {
      hoverLine.style.display = "none";
      hoverDot.style.display = "none";
      tip.style.display = "none";
    });

    var wrap = document.createElement("div");
    wrap.className = "oa-chart-wrap";
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    container.appendChild(wrap);
  }

  /**
   * Fill date gaps with explicit `missing: true` entries so the chart can show
   * them as gaps rather than zeros.
   */
  function withGaps(points) {
    if (!points || points.length < 2) return points || [];
    var out = [];
    var oneDay = 86400000;
    for (var i = 0; i < points.length; i++) {
      out.push({ date: points[i].date, value: points[i].value });
      var cur = new Date(points[i].date).getTime();
      var next = i + 1 < points.length ? new Date(points[i + 1].date).getTime() : null;
      if (next === null || isNaN(cur) || isNaN(next)) continue;
      var gapDays = Math.round((next - cur) / oneDay);
      if (gapDays > 1 && gapDays < 400) {
        for (var g = 1; g < gapDays; g++) {
          out.push({ date: new Date(cur + g * oneDay).toISOString().slice(0, 10), value: 0, missing: true });
        }
      }
    }
    return out;
  }

  window.OceanAnalyzerChart = { render: render, withGaps: withGaps, fmtCompact: fmtCompact };
})();
