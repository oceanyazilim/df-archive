"use client";

import { useMemo } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { StreamPoint, ChartState } from "./StreamingPerformanceChart";
import { fmtCompact } from "../../lib/types";
import { StatCard } from "../shared/StatCard";
import { SkeletonStatCard } from "../shared/Skeleton";
import { cn } from "../../lib/cn";

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
    let growth: number | null = null;
    if (points.length >= 10) {
      const last7 = points.slice(-7), prev7 = points.slice(-14, -7);
      const a = last7.reduce((x, p) => x + p.value, 0) / last7.length;
      const b = prev7.length ? prev7.reduce((x, p) => x + p.value, 0) / prev7.length : 0;
      if (b > 0) growth = ((a - b) / b) * 100;
    }
    const prevTotal = prevPoints?.length ? prevPoints.reduce((a, p) => a + p.value, 0) : null;
    const periodChange = prevTotal && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    return { total, avg, peak, growth, periodChange };
  }, [points, prevPoints]);

  if (state === "loading") {
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <SkeletonStatCard key={i} />)}</div>;
  }
  if (!s) return null;

  const peakDate = new Date(s.peak.date);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label={`Total · ${days}d`}
        value={fmtCompact(s.total)}
        sub={
          <span className="inline-flex items-center gap-1">
            {Math.round(s.total).toLocaleString()}
            {s.periodChange != null && (
              <span className={cn("inline-flex items-center gap-0.5 font-semibold", s.periodChange >= 0 ? "text-success" : "text-danger")}>
                {s.periodChange >= 0 ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
                {Math.abs(s.periodChange).toFixed(1)}%
              </span>
            )}
          </span>
        }
      />
      <StatCard label="Avg Daily Streams" value={fmtCompact(s.avg)} sub={`across ${points.length} days`} />
      <StatCard
        label="Growth · 7d vs prior"
        value={s.growth == null ? "—" : `${s.growth >= 0 ? "+" : ""}${s.growth.toFixed(1)}%`}
        tone={s.growth == null ? "default" : s.growth >= 0 ? "success" : "danger"}
        sub={s.growth == null ? "needs 14+ days of data" : "week-over-week"}
      />
      <StatCard
        label="Peak Day"
        value={fmtCompact(s.peak.value)}
        sub={Number.isNaN(peakDate.getTime()) ? s.peak.date : peakDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      />
    </div>
  );
}
