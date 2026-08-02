"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead, EmptyState, ArtworkThumb } from "../ui";
import { HistoryItem, jget } from "../../lib/types";

/** Lookup history — real analyses only. Artwork appears for entries analyzed after the catalog upgrade. */
export function HistoryView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(() => jget<{ items: HistoryItem[] }>("/api/history").then((d) => setItems(d.items)).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);

  const filtered = (items ?? []).filter((h) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (h.trackTitle ?? "").toLowerCase().includes(s) || (h.artists ?? []).join(" ").toLowerCase().includes(s) || (h.distributor ?? "").toLowerCase().includes(s) || (h.isrc ?? "").toLowerCase().includes(s);
  });

  return (
    <>
      <PageHead title="Lookup History" desc="Previously analyzed tracks. No credentials or private responses are stored."
        actions={<button className="btn btn-sm danger" onClick={() => fetch("/api/history", { method: "DELETE" }).then(load)}>Clear history</button>} />
      <section className="panel anim-in">
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search track, artist, distributor, ISRC…" aria-label="Search history" style={{ maxWidth: 340 }} />
        </div>
        {!items ? <div className="skeleton" style={{ height: 200 }} /> :
          filtered.length === 0 ? <EmptyState title={q ? "No matches" : "No lookups yet"} body={q ? "Try a different search." : "Analyze a track from the search bar above — every analysis lands here."} /> :
          <div className="table-scroll"><table>
            <thead><tr><th></th><th>Track</th><th>Artist</th><th>ISRC</th><th>Distributor</th><th>Status</th><th>Analyzed</th><th></th></tr></thead>
            <tbody>{filtered.map((h, i) => (
              <tr key={h.id ?? i}>
                <td style={{ width: 42 }}><ArtworkThumb url={h.artworkUrl} alt={h.trackTitle ?? "artwork"} /></td>
                <td style={{ fontWeight: 550 }}>{h.trackTitle ?? h.input.slice(0, 24)}</td>
                <td>{(h.artists ?? []).join(", ") || "—"}</td>
                <td className="mono">{h.isrc ?? "—"}</td>
                <td className="distributor-value">{h.distributor ?? "—"}</td>
                <td><span className={`badge ${h.resolutionStatus === "verified" ? "ok" : "muted"}`} style={{ fontSize: 10 }}><span className="dot" />{h.resolutionStatus}</span></td>
                <td className="hint">{new Date(h.at).toLocaleString()}</td>
                <td><button className="btn btn-sm" onClick={() => onAnalyze(h.spotifyTrackId ?? h.input)}>Re-analyze</button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </section>
    </>
  );
}
