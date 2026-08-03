"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ExternalLink } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { EmptyState } from "../shared/EmptyState";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Skeleton } from "../shared/Skeleton";
import { Button } from "../shared/Button";
import { cn } from "../../lib/cn";
import { StreamingPerformanceChart, StreamPoint, ChartState } from "../releases/StreamingPerformanceChart";
import { StreamSummary } from "../releases/StreamSummary";
import { PlatformComparison } from "../releases/PlatformComparison";
import { AdminOnlyView } from "../shared/AdminOnlyView";
import { useIsAdmin } from "../providers/AdminProvider";
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
  const isAdmin = useIsAdmin();

  useEffect(() => { jget<{ items: HistoryItem[] }>("/api/history?limit=200").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);

  const tracks = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const h of items ?? []) {
      if (!h.soundchartsSongUuid) continue;
      if (!map.has(h.soundchartsSongUuid)) map.set(h.soundchartsSongUuid, h);
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

  if (!isAdmin) return <AdminOnlyView title="Performance" />;

  return (
    <div>
      <PageHead title="Performance" description="Study the real streaming performance of any analyzed track — Soundcharts data only." />
      {!items ? (
        <Skeleton className="h-60 w-full" />
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-5" aria-hidden />}
          title="No analyzable tracks yet"
          description="Analyze a track first — every track with streaming data becomes selectable here."
          action={<Button variant="primary" size="sm" onClick={() => onAnalyze("")}>Go to Dashboard</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div className="rounded-lg border border-border-strong bg-card p-3">
            <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Analyzed tracks</h3>
            <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {tracks.map((t) => (
                <button
                  key={t.soundchartsSongUuid}
                  onClick={() => setSelected(t)}
                  aria-current={t.soundchartsSongUuid === uuid}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                    t.soundchartsSongUuid === uuid ? "bg-accent-dim" : "hover:bg-card-hover"
                  )}
                >
                  <ArtworkThumb src={t.artworkUrl} alt={t.trackTitle ?? "artwork"} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-foreground">{t.trackTitle ?? t.input}</span>
                    <span className="block truncate text-[11px] text-foreground-muted">{(t.artists ?? []).join(", ")}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            {selected && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ArtworkThumb src={selected.artworkUrl} alt={selected.trackTitle ?? "artwork"} size={40} rounded="md" />
                  <div>
                    <div className="text-[15px] font-semibold text-foreground">{selected.trackTitle ?? selected.input}</div>
                    <div className="text-xs text-foreground-muted">{(selected.artists ?? []).join(", ")}{selected.distributor ? ` · ${selected.distributor}` : ""}</div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" icon={<ExternalLink className="size-3.5" aria-hidden />} onClick={() => onAnalyze(selected.spotifyTrackId ?? selected.input)}>
                  Open full workspace
                </Button>
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
    </div>
  );
}
