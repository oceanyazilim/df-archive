"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { StatCard } from "../shared/StatCard";
import { SkeletonStatCard } from "../shared/Skeleton";
import { Panel } from "../shared/Card";
import { Button } from "../shared/Button";
import { AdminOnlyView } from "../shared/AdminOnlyView";
import { useIsAdmin } from "../providers/AdminProvider";
import { HistoryItem, jget } from "../../lib/types";

/**
 * Export Center — honest, data-backed exports only: lookup history,
 * distributor summary, and mapping statistics.
 */
export function ReportsView() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [stats, setStats] = useState<{ total: number; searchesToday: number; distributorMatches: number; topDistributors: { name: string; count: number }[] } | null>(null);
  const isAdmin = useIsAdmin();
  useEffect(() => {
    jget<{ items: HistoryItem[] }>("/api/history?limit=200").then((d) => setItems(d.items)).catch(() => setItems([]));
    jget<typeof stats>("/api/history?stats=1").then(setStats).catch(() => {});
  }, []);

  const dl = (name: string, content: string, mime: string) => {
    const b = new Blob([content], { type: mime }); const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u);
  };
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  const historyCsv = () => {
    if (!items) return;
    const cols = ["at", "trackTitle", "artists", "isrc", "distributor", "resolutionStatus", "albumTitle", "label", "releaseDate", "spotifyTrackId"];
    const rows = items.map((h) => [h.at, h.trackTitle, (h.artists ?? []).join("; "), h.isrc, h.distributor, h.resolutionStatus, h.albumTitle, h.label, h.releaseDate, h.spotifyTrackId].map(esc).join(","));
    dl(`lookup-history-${new Date().toISOString().slice(0, 10)}.csv`, cols.join(",") + "\n" + rows.join("\n"), "text/csv");
  };
  const historyJson = () => { if (items) dl(`lookup-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(items, null, 2), "application/json"); };
  const distributorCsv = () => {
    if (!items) return;
    const map = new Map<string, { analyses: number; tracks: Set<string>; artists: Set<string> }>();
    for (const h of items) {
      if (!h.distributor) continue;
      const e = map.get(h.distributor) ?? { analyses: 0, tracks: new Set<string>(), artists: new Set<string>() };
      e.analyses++;
      if (h.spotifyTrackId ?? h.trackTitle) e.tracks.add(h.spotifyTrackId ?? h.trackTitle ?? "");
      for (const a of h.artists ?? []) e.artists.add(a);
      map.set(h.distributor, e);
    }
    const rows = [...map.entries()].sort((a, b) => b[1].analyses - a[1].analyses)
      .map(([name, e]) => [name, e.analyses, e.tracks.size, e.artists.size].map(esc).join(","));
    dl(`distributor-summary-${new Date().toISOString().slice(0, 10)}.csv`, "distributor,analyses,tracks,artists\n" + rows.join("\n"), "text/csv");
  };
  const mappingJson = () => jget<Record<string, unknown>>("/api/uuid-mapping/status").then((s) => dl(`uuid-mapping-status-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(s, null, 2), "application/json")).catch(() => {});

  if (!isAdmin) return <AdminOnlyView title="Export Center" />;

  return (
    <div>
      <PageHead title="Export Center" description="Export your real analysis data — nothing estimated, nothing fabricated." />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats === null ? (
          <>
            <SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard label="Total analyses" value={stats.total} />
            <StatCard label="Analyses today" value={stats.searchesToday} />
            <StatCard label="Distributor matches" value={stats.distributorMatches} />
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Lookup History" description="Every analysis with track, artist, ISRC, distributor and status.">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={historyCsv} disabled={!items?.length}>CSV</Button>
            <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={historyJson} disabled={!items?.length}>JSON</Button>
          </div>
        </Panel>
        <Panel title="Distributor Summary" description="Distributors observed in your analyses, with track and artist counts.">
          <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={distributorCsv} disabled={!items?.length}>CSV</Button>
          {stats?.topDistributors && stats.topDistributors.length > 0 && (
            <div className="mt-3 divide-y divide-border-subtle">
              {stats.topDistributors.map((d) => (
                <div key={d.name} className="flex items-center justify-between py-1.5 text-[12.5px]">
                  <span className="text-foreground-secondary">{d.name}</span>
                  <span className="tabular-nums text-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Mapping Statistics" description="Current state of the canonical distributor UUID mapping.">
          <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={mappingJson}>JSON</Button>
        </Panel>
      </div>
    </div>
  );
}
