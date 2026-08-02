"use client";

import { useEffect, useState } from "react";
import { PageHead, StatCard } from "../ui";
import { HistoryItem, jget } from "../../lib/types";

/**
 * Reports & export center — honest, data-backed exports only:
 * lookup history, distributor summary, and mapping statistics.
 */
export function ReportsView() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [stats, setStats] = useState<{ total: number; searchesToday: number; distributorMatches: number; topDistributors: { name: string; count: number }[] } | null>(null);
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

  return (
    <>
      <PageHead title="Reports" desc="Export your real analysis data — nothing estimated, nothing fabricated." />
      <div className="cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <StatCard label="Total analyses" value={stats?.total ?? "—"} />
        <StatCard label="Analyses today" value={stats?.searchesToday ?? "—"} />
        <StatCard label="Distributor matches" value={stats?.distributorMatches ?? "—"} />
      </div>
      <div className="info-3">
        <section className="panel anim-in">
          <h3 className="panel-title">Lookup History</h3>
          <p className="hint">Every analysis with track, artist, ISRC, distributor and status.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={historyCsv} disabled={!items?.length}>Download CSV</button>
            <button className="btn btn-sm" onClick={historyJson} disabled={!items?.length}>Download JSON</button>
          </div>
        </section>
        <section className="panel anim-in">
          <h3 className="panel-title">Distributor Summary</h3>
          <p className="hint">Distributors observed in your analyses, with track and artist counts.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={distributorCsv} disabled={!items?.length}>Download CSV</button>
          </div>
          {stats?.topDistributors?.length ? (
            <div style={{ marginTop: 10 }}>
              {stats.topDistributors.map((d) => <div key={d.name} className="kv"><span className="k distributor-value">{d.name}</span><span className="v">{d.count}</span></div>)}
            </div>
          ) : null}
        </section>
        <section className="panel anim-in">
          <h3 className="panel-title">Mapping Statistics</h3>
          <p className="hint">Current state of the canonical distributor UUID mapping.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => jget<Record<string, unknown>>("/api/uuid-mapping/status").then((s) => dl(`uuid-mapping-status-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(s, null, 2), "application/json")).catch(() => {})}>Download JSON</button>
          </div>
        </section>
      </div>
    </>
  );
}
