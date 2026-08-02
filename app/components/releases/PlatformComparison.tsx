"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { StreamPoint } from "./StreamingPerformanceChart";
import { fmtCompact } from "../../lib/types";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { StatusBadge } from "../shared/StatusBadge";
import { Skeleton } from "../shared/Skeleton";
import { BarChart3 } from "lucide-react";

/**
 * Cross-platform comparison built from REAL Soundcharts audience data only.
 * Each platform is queried independently; platforms without data for this song
 * are listed honestly as "No data" — nothing is fabricated or estimated.
 */
const PLATFORMS: { code: string; name: string; unit: string }[] = [
  { code: "spotify", name: "Spotify", unit: "streams/day" },
  { code: "youtube", name: "YouTube", unit: "views/day" },
  { code: "tiktok", name: "TikTok", unit: "views/day" },
  { code: "soundcloud", name: "SoundCloud", unit: "plays/day" },
  { code: "shazam", name: "Shazam", unit: "shazams/day" },
  { code: "deezer", name: "Deezer", unit: "fans/day" },
];

type PlatData = { code: string; name: string; unit: string; state: "loading" | "available" | "none"; points: StreamPoint[]; total: number };

function Sparkline({ points }: { points: StreamPoint[] }) {
  if (points.length < 2) return <p className="text-[10.5px] text-foreground-muted">single data point</p>;
  return (
    <div className="h-11 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
          <Line type="monotone" dataKey="value" stroke="#39BDF8" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlatformComparison({ uuid, days = 30 }: { uuid: string; days?: number }) {
  const [data, setData] = useState<PlatData[]>(() => PLATFORMS.map((p) => ({ ...p, state: "loading", points: [], total: 0 })));

  useEffect(() => {
    let alive = true;
    setData(PLATFORMS.map((p) => ({ ...p, state: "loading", points: [], total: 0 })));
    PLATFORMS.forEach((p) => {
      fetch(`/api/song/${uuid}/streams?days=${days}&platform=${encodeURIComponent(p.code)}`)
        .then((r) => r.json())
        .then((d: { state: string; points?: StreamPoint[] }) => {
          if (!alive) return;
          const pts = Array.isArray(d.points) ? d.points : [];
          setData((prev) => prev.map((x) => x.code === p.code
            ? { ...x, state: d.state === "available" && pts.length ? "available" : "none", points: pts, total: pts.reduce((a, q) => a + q.value, 0) }
            : x));
        })
        .catch(() => { if (alive) setData((prev) => prev.map((x) => x.code === p.code ? { ...x, state: "none" } : x)); });
    });
    return () => { alive = false; };
  }, [uuid, days]);

  const available = data.filter((d) => d.state === "available").sort((a, b) => b.total - a.total);
  const loading = data.some((d) => d.state === "loading");
  const missing = data.filter((d) => d.state === "none");

  return (
    <Panel title="Platform Comparison" description={`Daily gains per platform over the last ${days} days — real Soundcharts data, platform units differ`}>
      {available.length === 0 && !loading ? (
        <EmptyState icon={<BarChart3 className="size-5" aria-hidden />} title="No cross-platform data available for this track." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {available.map((p) => (
            <div key={p.code} className="rounded-md border border-border-subtle bg-card-elevated p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] font-semibold text-foreground">{p.name}</span>
                <span className="text-[15px] font-bold text-foreground">{fmtCompact(p.total)}</span>
              </div>
              <p className="mb-1.5 text-[10.5px] text-foreground-muted">{p.unit} · {days}d total gain</p>
              <Sparkline points={p.points} />
            </div>
          ))}
          {loading && <Skeleton className="h-[70px] w-full" />}
        </div>
      )}

      {missing.length > 0 && !loading && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {missing.map((p) => (
            <StatusBadge key={p.code} tone="neutral" className="cursor-default" title={`No data for this track on ${p.name}`}>
              {p.name} · no data
            </StatusBadge>
          ))}
        </div>
      )}
    </Panel>
  );
}
