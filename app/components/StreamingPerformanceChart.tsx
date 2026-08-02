"use client";

import { useMemo, useRef, useState } from "react";

export type StreamPoint = { date: string; value: number };
export type ChartState = "loading" | "available" | "empty" | "plan_restricted" | "unavailable" | "not_configured";
export type ChartType = "bar" | "line" | "area";
export type ViewMode = "daily" | "cumulative" | "avg7";
export type Granularity = "daily" | "weekly" | "monthly";

/**
 * Metrics are REAL Soundcharts platform series (daily gains of each platform's
 * counter). Nothing here is estimated — a platform without data for the track
 * simply reports an honest empty state.
 */
export type MetricDef = { code: string; label: string; unit: string };
export const METRICS: MetricDef[] = [
  { code: "spotify", label: "Spotify streams", unit: "streams" },
  { code: "youtube", label: "YouTube views", unit: "views" },
  { code: "tiktok", label: "TikTok views", unit: "views" },
  { code: "soundcloud", label: "SoundCloud plays", unit: "plays" },
  { code: "shazam", label: "Shazams", unit: "shazams" },
  { code: "deezer", label: "Deezer fans", unit: "fans" },
];

export const RANGES = [
  { d: 7, l: "7D" }, { d: 28, l: "28D" }, { d: 90, l: "90D" }, { d: 180, l: "6M" }, { d: 365, l: "1Y" },
];

const fmt = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(2)}B` :
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` :
  Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`;
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const longDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "track";

/** Sum daily points into ISO-week or month buckets (labels = bucket start). */
function aggregate(points: StreamPoint[], g: Granularity): StreamPoint[] {
  if (g === "daily" || points.length === 0) return points;
  const buckets = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.date);
    if (Number.isNaN(d.getTime())) continue;
    let key: string;
    if (g === "monthly") key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    else { // weekly: bucket by Monday
      const day = (d.getUTCDay() + 6) % 7;
      const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day);
      key = mon.toISOString().slice(0, 10);
    }
    buckets.set(key, (buckets.get(key) ?? 0) + p.value);
  }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

function applyView(points: StreamPoint[], view: ViewMode): StreamPoint[] {
  if (view === "cumulative") { let acc = 0; return points.map((p) => ({ date: p.date, value: (acc += p.value) })); }
  if (view === "avg7") {
    return points.map((p, i) => {
      const from = Math.max(0, i - 6);
      const win = points.slice(from, i + 1);
      return { date: p.date, value: win.reduce((a, q) => a + q.value, 0) / win.length };
    });
  }
  return points;
}

function toCsv(rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

function download(name: string, blob: Blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}

/**
 * Streaming performance — custom SVG chart, no external library.
 * Real Soundcharts data only. Views: daily / cumulative / 7-day average.
 * Types: bar / line / area. Optional previous-period comparison (dashed).
 * Exports the exact plotted series as CSV or PNG.
 */
export function StreamingPerformanceChart({
  points, prevPoints, state, days, onDays, metric, onMetric, compare, onCompare, updatedAt, onRetry, exportLabel,
}: {
  points: StreamPoint[];
  prevPoints: StreamPoint[] | null;      // aligned previous period (index i ↔ i), or null when comparison is off/unavailable
  state: ChartState;
  days: number; onDays: (d: number) => void;
  metric: string; onMetric: (code: string) => void;
  compare: boolean; onCompare: (on: boolean) => void;
  updatedAt: string | null;
  onRetry?: () => void;
  exportLabel: string;                    // e.g. track title — used in export filenames
}) {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [view, setView] = useState<ViewMode>("daily");
  const [gran, setGran] = useState<Granularity>("daily");
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const metricDef = METRICS.find((m) => m.code === metric) ?? METRICS[0];

  // Pipeline: granularity (daily view only) → view transform. Comparison gets
  // the identical transform so the two lines are always like-for-like.
  const effGran: Granularity = view === "daily" ? gran : "daily";
  const series = useMemo(() => applyView(aggregate(points, effGran), view), [points, effGran, view]);
  const prevSeries = useMemo(
    () => (compare && prevPoints && prevPoints.length ? applyView(aggregate(prevPoints, effGran), view) : null),
    [compare, prevPoints, effGran, view]
  );

  const W = 900, H = 340, PADL = 56, PADB = 28, PADT = 14, PADR = 14;
  const geo = useMemo(() => {
    if (!series.length) return null;
    const vals = series.map((p) => p.value).concat(prevSeries ? prevSeries.map((p) => p.value) : []);
    const max = Math.max(...vals, 1);
    const min = view === "cumulative" ? 0 : Math.min(...vals, 0);
    const span = max - min || 1;
    const iW = W - PADL - PADR, iH = H - PADT - PADB;
    const x = (i: number, n: number) => PADL + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);
    const y = (v: number) => PADT + iH - ((v - min) / span) * iH;
    const xy = series.map((p, i) => ({ x: x(i, series.length), y: y(p.value), p }));
    const pxy = prevSeries ? prevSeries.map((p, i) => ({ x: x(i, prevSeries.length), y: y(p.value), p })) : null;
    const path = (cs: { x: number; y: number }[]) => cs.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const line = path(xy);
    const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${(PADT + iH).toFixed(1)} L${xy[0].x.toFixed(1)},${(PADT + iH).toFixed(1)} Z`;
    const barW = Math.max(1.5, (iW / series.length) * 0.62);
    return { xy, pxy, line, prevLine: pxy ? path(pxy) : null, area, max, min, iH, iW, barW, base: PADT + iH };
  }, [series, prevSeries, view]);

  // Auto-thinned x labels — never more than 6, never overlapping.
  const xTicks = useMemo(() => {
    if (!geo) return [];
    const n = series.length;
    const count = Math.min(6, n);
    const out: { x: number; label: string; anchor: "start" | "middle" | "end" }[] = [];
    for (let k = 0; k < count; k++) {
      const i = count === 1 ? 0 : Math.round((k / (count - 1)) * (n - 1));
      out.push({ x: geo.xy[i].x, label: shortDate(series[i].date), anchor: k === 0 ? "start" : k === count - 1 ? "end" : "middle" });
    }
    return out;
  }, [geo, series]);

  const exportBase = () => {
    const from = series[0]?.date ?? "", to = series[series.length - 1]?.date ?? "";
    return `${slug(exportLabel)}_${metricDef.code}-${view}_${from}_${to}`;
  };
  const exportCsv = () => {
    const head = ["date", metricDef.unit, ...(prevSeries ? ["previous_period"] : [])];
    const rows = series.map((p, i) => [p.date, Math.round(p.value), ...(prevSeries ? [prevSeries[i] ? Math.round(prevSeries[i].value) : null] : [])]);
    download(`${exportBase()}.csv`, new Blob([toCsv([head, ...rows])], { type: "text/csv" }));
  };
  const exportPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#0d1117";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => { if (b) download(`${exportBase()}.png`, b); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };

  // Tooltip content for the hovered index — % change only when both real.
  const tip = useMemo(() => {
    if (!hover || !geo) return null;
    const cur = series[hover.i];
    const prev = prevSeries?.[hover.i] ?? null;
    const change = prev && prev.value > 0 ? ((cur.value - prev.value) / prev.value) * 100 : null;
    return { cur, prev, change };
  }, [hover, geo, series, prevSeries]);

  let body: React.ReactNode;
  if (state === "loading") body = <div className="skeleton chart-svg" style={{ height: 340 }} />;
  else if (state === "unavailable")
    body = (
      <div className="chart-empty" style={{ height: 340, display: "grid", placeItems: "center" }}>
        <div>
          <div>Analytics are temporarily unavailable.</div>
          {onRetry && <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onRetry}>Retry</button>}
        </div>
      </div>
    );
  else if (state === "plan_restricted" || state === "not_configured")
    body = <div className="chart-empty" style={{ height: 340, display: "grid", placeItems: "center" }}>Streaming analytics are not available on the current data plan.</div>;
  else if (!geo)
    body = (
      <div className="chart-empty" style={{ height: 340, display: "grid", placeItems: "center" }}>
        <div>
          <div>No analytics data is available for this period.</div>
          <div className="hint" style={{ marginTop: 6 }}>Try a longer date range or another metric.</div>
        </div>
      </div>
    );
  else body = (
    <svg ref={svgRef} className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={metricDef.label}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const rx = ((e.clientX - r.left) / r.width) * W;
        let n = geo.xy[0], ni = 0;
        geo.xy.forEach((c, i) => { if (Math.abs(c.x - rx) < Math.abs(n.x - rx)) { n = c; ni = i; } });
        setHover({ x: n.x, y: n.y, i: ni });
      }}>
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} className="chart-grid" x1={PADL} x2={W - PADR} y1={PADT + geo.iH * f} y2={PADT + geo.iH * f} />)}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} className="chart-axis" x={6} y={PADT + geo.iH * f + 3}>{fmt(geo.max - (geo.max - geo.min) * f)}</text>)}
      {xTicks.map((t, i) => <text key={i} className="chart-axis" x={t.x} y={H - 8} textAnchor={t.anchor}>{t.label}</text>)}

      {/* Previous period — always a quiet dashed line beneath the main series. */}
      {geo.prevLine && <path d={geo.prevLine} fill="none" style={{ stroke: "var(--text-muted)", strokeWidth: 1.6, strokeDasharray: "5 4", opacity: 0.75 }} />}

      {chartType === "bar" && view !== "cumulative" ? (
        <g className="chart-anim-bars">
          {geo.xy.map((c, i) => (
            <rect key={i} className="chart-bar" x={c.x - geo.barW / 2} y={c.y} width={geo.barW}
              height={Math.max(0, geo.base - c.y)} rx={Math.min(2, geo.barW / 2)}
              style={{ fill: hover?.i === i ? "var(--accent)" : "url(#barFill)" }} />
          ))}
        </g>
      ) : (
        <g className="chart-anim">
          {(chartType === "area" || view === "cumulative") && <path className="chart-area" d={geo.area} style={{ fill: "url(#areaFill)", opacity: 1 }} />}
          <path className="chart-line chart-line-draw" d={geo.line} style={{ stroke: "var(--chart-secondary)", strokeWidth: 2.2 }} />
        </g>
      )}

      {hover && tip && <>
        <line className="chart-grid" x1={hover.x} x2={hover.x} y1={PADT} y2={geo.base} style={{ stroke: "var(--accent)", strokeDasharray: "3 3" }} />
        <circle cx={hover.x} cy={hover.y} r={3.5} fill="var(--chart-secondary)" stroke="var(--surface)" strokeWidth={1.5} />
        <g className="anim-pop">
          <rect className="chart-tip" x={Math.min(hover.x + 10, W - 208)} y={PADT + 4} width={192} height={tip.prev ? 66 : 40} rx={8} />
          <text x={Math.min(hover.x + 20, W - 198)} y={PADT + 20} style={{ fill: "var(--text-secondary)", fontSize: 10 }}>{longDate(tip.cur.date)}</text>
          <text x={Math.min(hover.x + 20, W - 198)} y={PADT + 36} style={{ fill: "var(--text-primary)", fontSize: 12.5, fontWeight: 650 }}>
            {Math.round(tip.cur.value).toLocaleString()} {metricDef.unit}
          </text>
          {tip.prev && <>
            <text x={Math.min(hover.x + 20, W - 198)} y={PADT + 50} style={{ fill: "var(--text-muted)", fontSize: 10 }}>
              Previous: {Math.round(tip.prev.value).toLocaleString()}
            </text>
            {tip.change != null && (
              <text x={Math.min(hover.x + 20, W - 198)} y={PADT + 62} style={{ fill: tip.change >= 0 ? "var(--success)" : "var(--danger)", fontSize: 10, fontWeight: 650 }}>
                {tip.change >= 0 ? "+" : ""}{tip.change.toFixed(1)}% vs previous period
              </text>
            )}
          </>}
        </g>
      </>}
    </svg>
  );

  return (
    <section className="panel big-chart anim-in">
      <div className="chart-toolbar">
        <div style={{ minWidth: 0 }}>
          <h2 className="panel-title" style={{ margin: 0 }}>Performance</h2>
          <div className="hint">{metricDef.label} · real Soundcharts data{compare ? " · vs previous period" : ""}</div>
        </div>
        <div className="chart-controls">
          <select className="ctl-select" aria-label="Metric" value={metricDef.code} onChange={(e) => onMetric(e.target.value)}>
            {METRICS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <div className="seg" role="group" aria-label="View">
            <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>Daily</button>
            <button className={view === "cumulative" ? "active" : ""} onClick={() => setView("cumulative")}>Total</button>
            <button className={view === "avg7" ? "active" : ""} onClick={() => setView("avg7")} title="7-day moving average">Avg</button>
          </div>
          <div className="seg" role="group" aria-label="Chart type">
            <button className={chartType === "bar" ? "active" : ""} onClick={() => setChartType("bar")} disabled={view === "cumulative"} title={view === "cumulative" ? "Cumulative view is always a line" : "Bars"}>Bar</button>
            <button className={chartType === "line" ? "active" : ""} onClick={() => setChartType("line")}>Line</button>
            <button className={chartType === "area" ? "active" : ""} onClick={() => setChartType("area")}>Area</button>
          </div>
          <div className="seg" role="group" aria-label="Granularity">
            <button className={effGran === "daily" ? "active" : ""} disabled={view !== "daily"} onClick={() => setGran("daily")}>D</button>
            <button className={effGran === "weekly" ? "active" : ""} disabled={view !== "daily"} onClick={() => setGran("weekly")}>W</button>
            <button className={effGran === "monthly" ? "active" : ""} disabled={view !== "daily"} onClick={() => setGran("monthly")}>M</button>
          </div>
          <div className="seg" role="group" aria-label="Date range">
            {RANGES.map((r) => <button key={r.d} className={days === r.d ? "active" : ""} onClick={() => onDays(r.d)}>{r.l}</button>)}
          </div>
          <button className={`btn btn-sm ${compare ? "primary" : ""}`} onClick={() => onCompare(!compare)} title="Compare with the previous period of the same length">Compare</button>
          <button className="btn btn-sm" onClick={exportCsv} disabled={!geo} title="Export the plotted series as CSV">CSV</button>
          <button className="btn btn-sm" onClick={exportPng} disabled={!geo} title="Export the chart as PNG">PNG</button>
        </div>
      </div>
      {compare && prevPoints !== null && prevPoints.length === 0 && state === "available" && (
        <div className="hint" style={{ marginBottom: 6 }}>No data exists for the previous period — showing the current period only.</div>
      )}
      {body}
      {updatedAt && state === "available" && <div className="hint" style={{ marginTop: 8 }}>Last updated {new Date(updatedAt).toLocaleString()}</div>}
    </section>
  );
}
