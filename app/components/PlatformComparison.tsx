"use client";

import { useEffect, useMemo, useState } from "react";
import { StreamPoint } from "./StreamingPerformanceChart";
import { fmtCompact } from "../lib/types";

/**
 * Cross-platform comparison built from REAL Soundcharts audience data only.
 * Each platform is queried independently; platforms without data for this song
 * are listed honestly as "No data" — nothing is fabricated or estimated.
 * Values are daily gains (day-over-day deltas of the platform's total counter),
 * so units differ per platform (streams, views, plays…) and are labeled as such.
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
  const W = 220, H = 44, P = 3;
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.value);
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const span = max - min || 1;
    return points.map((p, i) => {
      const x = P + (i / (points.length - 1)) * (W - 2 * P);
      const y = P + (H - 2 * P) - ((p.value - min) / span) * (H - 2 * P);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [points]);
  if (!path) return <div className="hint" style={{ fontSize: 10.5 }}>single data point</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 44, display: "block" }} aria-hidden>
      <path d={path} fill="none" stroke="var(--chart-secondary)" strokeWidth="1.8" className="chart-line-draw" />
    </svg>
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
    <section className="panel anim-in">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h2 className="panel-title" style={{ margin: 0 }}>Platform Comparison</h2>
          <div className="hint">Daily gains per platform over the last {days} days — real Soundcharts data, platform units differ</div>
        </div>
      </div>

      {available.length === 0 && !loading ? (
        <div className="chart-empty">No cross-platform data is available for this track.</div>
      ) : (
        <div className="platform-compare-grid">
          {available.map((p) => (
            <div key={p.code} className="platform-compare-card anim-in">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{p.name}</span>
                <span style={{ fontWeight: 680, fontSize: 15 }}>{fmtCompact(p.total)}</span>
              </div>
              <div className="hint" style={{ fontSize: 10.5, marginBottom: 6 }}>{p.unit} · {days}d total gain</div>
              <Sparkline points={p.points} />
            </div>
          ))}
          {loading && <div className="platform-compare-card"><div className="skeleton" style={{ height: 70 }} /></div>}
        </div>
      )}

      {missing.length > 0 && !loading && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {missing.map((p) => <span key={p.code} className="badge muted" title="No data for this track on this platform"><span className="dot" />{p.name} · no data</span>)}
        </div>
      )}
    </section>
  );
}
