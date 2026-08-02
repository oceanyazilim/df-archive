"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHead, EmptyState, ArtworkThumb } from "../ui";
import { StreamingPerformanceChart, StreamPoint, ChartState } from "../releases/StreamingPerformanceChart";
import { StreamSummary } from "../releases/StreamSummary";
import { PlatformComparison } from "../releases/PlatformComparison";
import { HistoryItem, jget } from "../../lib/types";

type StreamsData = { state: ChartState; points: StreamPoint[]; prevPoints: StreamPoint[] | null; updatedAt: string | null };

/**
 * Standalone streaming analytics: pick any previously analyzed track (with a
 * Soundcharts UUID) and study its real performance without re-running a lookup.
 */
export function AnalyticsView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [days, setDays] = useState(90);
  const [metric, setMetric] = useState("spotify");
  const [compare, setCompare] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const [streams, setStreams] = useState<StreamsData>({ state: "loading", points: [], prevPoints: null, updatedAt: null });

  useEffect(() => { jget<{ items: HistoryItem[] }>("/api/history?limit=200").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);

  // Distinct analyzable tracks (need a Soundcharts UUID), latest entry per track.
  const tracks = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const h of items ?? []) {
      if (!h.soundchartsSongUuid) continue;
      const key = h.soundchartsSongUuid;
      if (!map.has(key)) map.set(key, h);
    }
    return [...map.values()];
  }, [items]);

  useEffect(() => { if (!selected && tracks.length) setSelected(tracks[0]); }, [tracks, selected]);

  const uuid = selected?.soundchartsSongUuid ?? null;
  useEffect(() => {
    if (!uuid) return;
    const ctl = new AbortController();
    setStreams((s) => ({ ...s, state: "loading" }));
    const span = compare ? Math.min(365, days * 2) : days;
    fetch(`/api/song/${uuid}/streams?days=${span}&platform=${encodeURIComponent(metric)}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d: { state: ChartState; points?: StreamPoint[]; updatedAt?: string | null }) => {
        const pts = Array.isArray(d.points) ? d.points : [];
        if (!compare) { setStreams({ state: d.state, points: pts, prevPoints: null, updatedAt: d.updatedAt ?? null }); return; }
        const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - days);
        const cut = cutoff.toISOString().slice(0, 10);
        setStreams({ state: d.state, points: pts.filter((p) => p.date >= cut), prevPoints: pts.filter((p) => p.date < cut), updatedAt: d.updatedAt ?? null });
      })
      .catch((e) => { if (e?.name !== "AbortError") setStreams({ state: "unavailable", points: [], prevPoints: null, updatedAt: null }); });
    return () => ctl.abort();
  }, [uuid, days, metric, compare, retrySeq]);

  return (
    <>
      <PageHead title="Streaming Analytics" desc="Study the real streaming performance of any analyzed track — Soundcharts data only." />
      {!items ? <div className="skeleton" style={{ height: 240 }} /> :
        tracks.length === 0 ? (
          <EmptyState title="No analyzable tracks yet" body="Analyze a track first — every track with streaming data becomes selectable here."
            action={<button className="btn primary btn-sm" onClick={() => onAnalyze("")}>Go to Track Lookup</button>} />
        ) : (
          <div className="analytics-layout">
            <section className="panel anim-in" style={{ alignSelf: "start" }}>
              <h3 className="panel-title">Analyzed tracks</h3>
              <div className="analytics-tracklist">
                {tracks.map((t) => (
                  <button key={t.soundchartsSongUuid} className={`analytics-track ${t.soundchartsSongUuid === uuid ? "selected" : ""}`}
                    onClick={() => setSelected(t)} aria-current={t.soundchartsSongUuid === uuid}>
                    <ArtworkThumb url={t.artworkUrl} alt={t.trackTitle ?? "artwork"} size={30} />
                    <span style={{ minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block", fontWeight: 550, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.trackTitle ?? t.input}</span>
                      <span className="hint" style={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(t.artists ?? []).join(", ")}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {selected && (
                <div className="row anim-in" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 10 }}>
                    <ArtworkThumb url={selected.artworkUrl} alt={selected.trackTitle ?? "artwork"} size={40} radius={8} />
                    <div>
                      <div style={{ fontWeight: 650, fontSize: 15 }}>{selected.trackTitle ?? selected.input}</div>
                      <div className="hint">{(selected.artists ?? []).join(", ")}{selected.distributor ? ` · ${selected.distributor}` : ""}</div>
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={() => onAnalyze(selected.spotifyTrackId ?? selected.input)}>Open full workspace</button>
                </div>
              )}
              <StreamSummary points={streams.points} prevPoints={streams.prevPoints} state={streams.state} days={days} />
              <StreamingPerformanceChart
                points={streams.points} prevPoints={streams.prevPoints} state={streams.state}
                days={days} onDays={setDays} metric={metric} onMetric={setMetric}
                compare={compare} onCompare={setCompare} updatedAt={streams.updatedAt}
                onRetry={() => setRetrySeq((n) => n + 1)}
                exportLabel={selected?.trackTitle ?? selected?.input ?? "track"}
              />
              {uuid && <PlatformComparison uuid={uuid} days={30} />}
            </div>
          </div>
        )}
    </>
  );
}
