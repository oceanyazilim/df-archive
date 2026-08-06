"use client";

import { useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, GitCompare, ImageDown } from "lucide-react";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { Skeleton } from "../shared/Skeleton";
import { cn } from "../../lib/cn";
import { chartAxis, chartGrid, tooltipContentStyle } from "../dashboard/chartTheme";

export type StreamPoint = { date: string; value: number };
export type ChartState = "loading" | "available" | "empty" | "plan_restricted" | "unavailable" | "not_configured";
export type ChartType = "bar" | "line" | "area";
export type ViewMode = "daily" | "cumulative" | "avg7";
export type Granularity = "daily" | "weekly" | "monthly";

/** Real Soundcharts platform series — never estimated. */
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
    else {
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

interface Row { date: string; value: number; prevValue: number | null }

interface TooltipItem { payload: Row }
function ChartTooltip({ active, payload, metricUnit }: { active?: boolean; payload?: TooltipItem[]; metricUnit: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const change = row.prevValue && row.prevValue > 0 ? ((row.value - row.prevValue) / row.prevValue) * 100 : null;
  return (
    <div style={tooltipContentStyle} className="px-3 py-2.5">
      <div className="mb-1 text-[11px] text-foreground-secondary">{longDate(row.date)}</div>
      <div className="text-[13px] font-semibold text-foreground">{Math.round(row.value).toLocaleString()} {metricUnit}</div>
      {row.prevValue != null && (
        <div className="mt-1 text-[11px] text-foreground-muted">
          Previous: {Math.round(row.prevValue).toLocaleString()}
          {change != null && <span className={cn("ml-1.5 font-semibold", change >= 0 ? "text-success" : "text-danger")}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}
        </div>
      )}
    </div>
  );
}

function SegButton({ active, onClick, disabled, title, children }: { active: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-35",
        active ? "bg-card-hover text-foreground" : "text-foreground-muted hover:text-foreground-secondary"
      )}
    >
      {children}
    </button>
  );
}
function SegGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="group" aria-label={label} className="flex gap-0.5 rounded-md border border-border-strong bg-card-elevated p-0.5">{children}</div>;
}

/**
 * Streaming performance chart — Recharts-driven (was hand-built SVG).
 * Real Soundcharts data only. Same feature set: bar/line/area, daily/
 * cumulative/7d-avg views, day/week/month granularity, previous-period
 * comparison, CSV/PNG export.
 */
export function StreamingPerformanceChart({
  points, prevPoints, state, days, onDays, metric, onMetric, compare, onCompare, updatedAt, onRetry, exportLabel,
}: {
  points: StreamPoint[];
  prevPoints: StreamPoint[] | null;
  state: ChartState;
  days: number; onDays: (d: number) => void;
  metric: string; onMetric: (code: string) => void;
  compare: boolean; onCompare: (on: boolean) => void;
  updatedAt: string | null;
  onRetry?: () => void;
  exportLabel: string;
}) {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [view, setView] = useState<ViewMode>("daily");
  const [gran, setGran] = useState<Granularity>("daily");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const metricDef = METRICS.find((m) => m.code === metric) ?? METRICS[0];

  const effGran: Granularity = view === "daily" ? gran : "daily";
  const series = useMemo(() => applyView(aggregate(points, effGran), view), [points, effGran, view]);
  const prevSeries = useMemo(
    () => (compare && prevPoints && prevPoints.length ? applyView(aggregate(prevPoints, effGran), view) : null),
    [compare, prevPoints, effGran, view]
  );

  const rows: Row[] = useMemo(
    () => series.map((p, i) => ({ date: p.date, value: p.value, prevValue: prevSeries?.[i]?.value ?? null })),
    [series, prevSeries]
  );

  const xTicks = useMemo(() => {
    const n = rows.length;
    if (n === 0) return [];
    const count = Math.min(6, n);
    const out: string[] = [];
    for (let k = 0; k < count; k++) out.push(rows[count === 1 ? 0 : Math.round((k / (count - 1)) * (n - 1))].date);
    return out;
  }, [rows]);

  const exportBase = () => {
    const from = series[0]?.date ?? "", to = series[series.length - 1]?.date ?? "";
    return `${slug(exportLabel)}_${metricDef.code}-${view}_${from}_${to}`;
  };
  const exportCsv = () => {
    const head = ["date", metricDef.unit, ...(prevSeries ? ["previous_period"] : [])];
    const csvRows = series.map((p, i) => [p.date, Math.round(p.value), ...(prevSeries ? [prevSeries[i] ? Math.round(prevSeries[i].value) : null] : [])]);
    download(`${exportBase()}.csv`, new Blob([toCsv([head, ...csvRows])], { type: "text/csv" }));
  };
  const exportPng = () => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const { width, height } = svg.getBoundingClientRect();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#11161D";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => { if (b) download(`${exportBase()}.png`, b); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };

  let body: React.ReactNode;
  if (state === "loading") {
    body = <Skeleton className="h-[340px] w-full" />;
  } else if (state === "unavailable") {
    body = <ErrorState title="Analytics temporarily unavailable" message="Streaming data could not be loaded right now." onRetry={onRetry} className="h-[340px] justify-center" />;
  } else if (state === "plan_restricted" || state === "not_configured") {
    body = <EmptyState title="Streaming analytics are not available on the current data plan." className="h-[340px] justify-center" />;
  } else if (!rows.length) {
    body = <EmptyState title="No analytics data is available for this period." description="Try a longer date range or another metric." className="h-[340px] justify-center" />;
  } else {
    const showBars = chartType === "bar" && view !== "cumulative";
    const showArea = chartType === "area" || view === "cumulative";
    body = (
      <div ref={containerRef} className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={chartGrid.stroke} vertical={false} />
            <XAxis dataKey="date" ticks={xTicks} tickFormatter={shortDate} {...chartAxis} />
            <YAxis tickFormatter={fmt} {...chartAxis} />
            <Tooltip content={<ChartTooltip metricUnit={metricDef.unit} />} cursor={{ stroke: "#9CF04A", strokeDasharray: "3 3" }} />
            {prevSeries && <Line dataKey="prevValue" name="Previous period" stroke="#626C7A" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />}
            {showBars ? (
              <Bar dataKey="value" name={metricDef.label} fill="#4C8F1C" radius={[3, 3, 0, 0]} maxBarSize={26} />
            ) : showArea ? (
              <Area dataKey="value" name={metricDef.label} stroke="#9CF04A" strokeWidth={2.2} fill="#9CF04A" fillOpacity={0.18} type="monotone" />
            ) : (
              <Line dataKey="value" name={metricDef.label} stroke="#9CF04A" strokeWidth={2.2} dot={false} type="monotone" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Panel
      title="Performance"
      description={`${metricDef.label} · real Soundcharts data${compare ? " · vs previous period" : ""}`}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <select
            aria-label="Metric"
            value={metricDef.code}
            onChange={(e) => onMetric(e.target.value)}
            className="h-7 rounded-md border border-border-strong bg-card-elevated px-2 text-[11.5px] text-foreground"
          >
            {METRICS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <SegGroup label="View">
            <SegButton active={view === "daily"} onClick={() => setView("daily")}>Daily</SegButton>
            <SegButton active={view === "cumulative"} onClick={() => setView("cumulative")}>Total</SegButton>
            <SegButton active={view === "avg7"} onClick={() => setView("avg7")} title="7-day moving average">Avg</SegButton>
          </SegGroup>
          <SegGroup label="Chart type">
            <SegButton active={chartType === "bar"} onClick={() => setChartType("bar")} disabled={view === "cumulative"} title={view === "cumulative" ? "Cumulative view is always a line" : "Bars"}>Bar</SegButton>
            <SegButton active={chartType === "line"} onClick={() => setChartType("line")}>Line</SegButton>
            <SegButton active={chartType === "area"} onClick={() => setChartType("area")}>Area</SegButton>
          </SegGroup>
          <SegGroup label="Granularity">
            <SegButton active={effGran === "daily"} disabled={view !== "daily"} onClick={() => setGran("daily")}>D</SegButton>
            <SegButton active={effGran === "weekly"} disabled={view !== "daily"} onClick={() => setGran("weekly")}>W</SegButton>
            <SegButton active={effGran === "monthly"} disabled={view !== "daily"} onClick={() => setGran("monthly")}>M</SegButton>
          </SegGroup>
          <SegGroup label="Date range">
            {RANGES.map((r) => <SegButton key={r.d} active={days === r.d} onClick={() => onDays(r.d)}>{r.l}</SegButton>)}
          </SegGroup>
          <button
            onClick={() => onCompare(!compare)}
            title="Compare with the previous period of the same length"
            className={cn("flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11.5px] font-medium", compare ? "border-accent/40 bg-accent-dim text-accent" : "border-border-strong bg-card-elevated text-foreground-secondary")}
          >
            <GitCompare className="size-3" aria-hidden /> Compare
          </button>
          <button onClick={exportCsv} disabled={!rows.length} title="Export the plotted series as CSV" className="flex h-7 items-center gap-1 rounded-md border border-border-strong bg-card-elevated px-2.5 text-[11.5px] font-medium text-foreground-secondary disabled:opacity-40">
            <Download className="size-3" aria-hidden /> CSV
          </button>
          <button onClick={exportPng} disabled={!rows.length} title="Export the chart as PNG" className="flex h-7 items-center gap-1 rounded-md border border-border-strong bg-card-elevated px-2.5 text-[11.5px] font-medium text-foreground-secondary disabled:opacity-40">
            <ImageDown className="size-3" aria-hidden /> PNG
          </button>
        </div>
      }
    >
      {compare && prevPoints !== null && prevPoints.length === 0 && state === "available" && (
        <p className="mb-2 text-[11.5px] text-foreground-muted">No data exists for the previous period — showing the current period only.</p>
      )}
      {body}
      {updatedAt && state === "available" && <p className="mt-2 text-[11px] text-foreground-muted">Last updated {new Date(updatedAt).toLocaleString()}</p>}
    </Panel>
  );
}
