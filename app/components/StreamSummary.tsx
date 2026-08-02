"use client";

import { useMemo } from "react";
import { StreamPoint, ChartState } from "./StreamingPerformanceChart";
import { fmtCompact } from "../lib/types";

/**
 * Summary metrics computed from the REAL daily stream points of the selected
 * window: total, average/day, growth (last 7d vs previous 7d), peak day.
 * Renders nothing fabricated — hidden entirely when no data is available.
 */
export function StreamSummary({ points, prevPoints, state, days }: { points: StreamPoint[]; prevPoints?: StreamPoint[] | null; state: ChartState; days: number }) {
  const s = useMemo(() => {
    if (!points.length) return null;
    const total = points.reduce((a, p) => a + p.value, 0);
    const avg = total / points.length;
    let peak = points[0];
    for (const p of points) if (p.value > peak.value) peak = p;
    // Growth: mean of last 7 days vs the 7 days before that (needs >= 10 pts).
    let growth: number | null = null;
    if (points.length >= 10) {
      const last7 = points.slice(-7), prev7 = points.slice(-14, -7);
      const a = last7.reduce((x, p) => x + p.value, 0) / last7.length;
      const b = prev7.length ? prev7.reduce((x, p) => x + p.value, 0) / prev7.length : 0;
      if (b > 0) growth = ((a - b) / b) * 100;
    }
    // Period-over-period change — only when real previous-period data exists.
    const prevTotal = prevPoints?.length ? prevPoints.reduce((a, p) => a + p.value, 0) : null;
    const periodChange = prevTotal && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    return { total, avg, peak, growth, periodChange };
  }, [points, prevPoints]);

  if (state === "loading") {
    return <div className="metric-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="metric"><div className="skeleton" style={{ height: 12, width: "55%" }} /><div className="skeleton" style={{ height: 28, marginTop: 8 }} /></div>)}</div>;
  }
  if (!s) return null;

  const peakDate = new Date(s.peak.date);
  return (
    <div className="metric-grid anim-in">
      <div className="metric">
        <div className="m-label">Total · {days}d</div>
        <div className="m-value">{fmtCompact(s.total)}</div>
        <div className="m-sub">
          {Math.round(s.total).toLocaleString()}
          {s.periodChange != null && (
            <span style={{ marginLeft: 6, fontWeight: 650, color: s.periodChange >= 0 ? "var(--success)" : "var(--danger)" }}>
              {s.periodChange >= 0 ? "▲" : "▼"} {Math.abs(s.periodChange).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      <div className="metric">
        <div className="m-label">Avg Daily Streams</div>
        <div className="m-value">{fmtCompact(s.avg)}</div>
        <div className="m-sub">across {points.length} days</div>
      </div>
      <div className="metric">
        <div className="m-label">Growth · 7d vs prior</div>
        <div className="m-value" style={{ color: s.growth == null ? undefined : s.growth >= 0 ? "var(--success)" : "var(--danger)" }}>
          {s.growth == null ? "—" : `${s.growth >= 0 ? "+" : ""}${s.growth.toFixed(1)}%`}
        </div>
        <div className="m-sub">{s.growth == null ? "needs 14+ days of data" : "week-over-week"}</div>
      </div>
      <div className="metric">
        <div className="m-label">Peak Day</div>
        <div className="m-value">{fmtCompact(s.peak.value)}</div>
        <div className="m-sub">{Number.isNaN(peakDate.getTime()) ? s.peak.date : peakDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
      </div>
    </div>
  );
}
