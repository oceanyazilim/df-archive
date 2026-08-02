"use client";

/**
 * Catalog views (Distributors / Artists / Albums / Tracks), built ONLY from
 * real local data: the canonical UUID mapping and the lookup history. Nothing
 * here is fabricated — these views grow as tracks are analyzed.
 */

import { useEffect, useMemo, useState } from "react";
import { PageHead, EmptyState, ArtworkThumb, StatCard, CopyButton } from "../ui";
import { HistoryItem, jget } from "../../lib/types";

function useHistory(): HistoryItem[] | null {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => { jget<{ items: HistoryItem[] }>("/api/history?limit=200").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);
  return items;
}

// ---------------- Distributors ----------------
type MappingStatus = { validMappings: number; totalRecords: number; duplicateRecords: number; conflicts: number; lastLoadedAt: string | null };

export function DistributorsView({ flash }: { flash: (m: string) => void }) {
  const items = useHistory();
  const [status, setStatus] = useState<MappingStatus | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ results: { uuid: string; distributor: string }[]; truncated: boolean } | null>(null);
  useEffect(() => { jget<MappingStatus>("/api/uuid-mapping/status").then(setStatus).catch(() => {}); }, []);
  const search = () => { if (q.trim()) fetch(`/api/uuid-mapping/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setRes); };

  const observed = useMemo(() => {
    const map = new Map<string, { name: string; analyses: number; tracks: Set<string>; artists: Set<string>; lastSeen: string }>();
    for (const h of items ?? []) {
      if (!h.distributor) continue;
      const e = map.get(h.distributor) ?? { name: h.distributor, analyses: 0, tracks: new Set<string>(), artists: new Set<string>(), lastSeen: h.at };
      e.analyses++;
      if (h.spotifyTrackId ?? h.isrc ?? h.trackTitle) e.tracks.add(h.spotifyTrackId ?? h.isrc ?? h.trackTitle ?? "");
      for (const a of h.artists ?? []) e.artists.add(a);
      if (h.at > e.lastSeen) e.lastSeen = h.at;
      map.set(h.distributor, e);
    }
    return [...map.values()].sort((a, b) => b.analyses - a.analyses);
  }, [items]);

  return (
    <>
      <PageHead title="Distributors" desc="The canonical licensor-UUID mapping plus every distributor observed in your analyses." />
      <div className="cards" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <StatCard label="Mapped distributors" value={status?.validMappings ?? "—"} sub="canonical UUID records" />
        <StatCard label="Observed in analyses" value={items ? observed.length : "—"} sub="from lookup history" />
        <StatCard label="Duplicates" value={status?.duplicateRecords ?? "—"} />
        <StatCard label="Conflicts" value={status?.conflicts ?? "—"} tone={(status?.conflicts ?? 0) > 0 ? "err" : undefined} />
      </div>

      <section className="panel anim-in">
        <h3 className="panel-title">Search the canonical mapping</h3>
        <div className="row"><input type="text" value={q} placeholder="Search UUID or distributor name" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} style={{ flex: 1, maxWidth: 420 }} aria-label="Search mapping" /><button className="btn" onClick={search}>Search</button></div>
        <p className="hint" style={{ marginTop: 8 }}>The full mapping is never loaded into the browser — search returns at most 50 rows.</p>
        {res && (res.results.length === 0 ? <EmptyState title="No matches" /> :
          <div className="table-scroll" style={{ marginTop: 10 }}><table><thead><tr><th>Distributor</th><th>Licensor UUID</th><th></th></tr></thead>
            <tbody>{res.results.map((r) => <tr key={r.uuid}><td className="distributor-value" style={{ fontWeight: 600 }}>{r.distributor}</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{r.uuid}</td><td><CopyButton value={r.uuid} label="UUID" flash={flash} /> <CopyButton value={r.distributor} label="name" flash={flash} /></td></tr>)}</tbody></table></div>)}
      </section>

      <section className="panel anim-in">
        <h3 className="panel-title">Observed in your analyses</h3>
        {!items ? <div className="skeleton" style={{ height: 120 }} /> :
          observed.length === 0 ? <EmptyState title="No distributors observed yet" body="Distributors appear here once analyses resolve them." /> :
          <div className="table-scroll"><table>
            <thead><tr><th>Distributor</th><th>Analyses</th><th>Tracks</th><th>Artists</th><th>Last seen</th></tr></thead>
            <tbody>{observed.map((d) => (
              <tr key={d.name}>
                <td className="distributor-value" style={{ fontWeight: 600 }}>{d.name}</td>
                <td>{d.analyses}</td><td>{d.tracks.size}</td><td>{d.artists.size}</td>
                <td className="hint">{new Date(d.lastSeen).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table></div>}
      </section>
    </>
  );
}

// ---------------- Artists ----------------
export function ArtistsView() {
  const items = useHistory();
  const [q, setQ] = useState("");
  const artists = useMemo(() => {
    const map = new Map<string, { name: string; tracks: Set<string>; analyses: number; distributors: Set<string>; artwork: string | null; lastSeen: string }>();
    for (const h of items ?? []) {
      for (const a of h.artists ?? []) {
        const e = map.get(a) ?? { name: a, tracks: new Set<string>(), analyses: 0, distributors: new Set<string>(), artwork: null, lastSeen: h.at };
        e.analyses++;
        if (h.trackTitle) e.tracks.add(h.trackTitle);
        if (h.distributor) e.distributors.add(h.distributor);
        if (!e.artwork && h.artworkUrl) e.artwork = h.artworkUrl;
        if (h.at > e.lastSeen) e.lastSeen = h.at;
        map.set(a, e);
      }
    }
    return [...map.values()].sort((a, b) => b.analyses - a.analyses);
  }, [items]);

  const filtered = q.trim() ? artists.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())) : artists;

  return (
    <>
      <PageHead title="Artists" desc="Every artist observed in your analyses, with their tracks and resolved distributors." />
      <section className="panel anim-in">
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artists…" aria-label="Search artists" style={{ maxWidth: 300 }} />
        </div>
        {!items ? <div className="skeleton" style={{ height: 160 }} /> :
          filtered.length === 0 ? <EmptyState title={q ? "No matches" : "No artists yet"} body={q ? undefined : "Artists appear here as you analyze tracks."} /> :
          <div className="table-scroll"><table>
            <thead><tr><th></th><th>Artist</th><th>Analyzed tracks</th><th>Analyses</th><th>Distributors</th><th>Last analyzed</th></tr></thead>
            <tbody>{filtered.map((a) => (
              <tr key={a.name}>
                <td style={{ width: 42 }}><ArtworkThumb url={a.artwork} alt={a.name} /></td>
                <td style={{ fontWeight: 600 }}>{a.name}</td>
                <td>{a.tracks.size}</td><td>{a.analyses}</td>
                <td className="distributor-value">{[...a.distributors].join(", ") || "—"}</td>
                <td className="hint">{new Date(a.lastSeen).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table></div>}
      </section>
    </>
  );
}

// ---------------- Albums ----------------
export function AlbumsView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const items = useHistory();
  const albums = useMemo(() => {
    const map = new Map<string, { key: string; title: string; artist: string; artwork: string | null; releaseDate: string | null; albumId: string | null; distributors: Set<string>; tracks: Set<string>; lastSeen: string }>();
    for (const h of items ?? []) {
      if (!h.albumTitle) continue;
      const key = h.spotifyAlbumId ?? `${h.albumTitle}::${(h.artists ?? [])[0] ?? ""}`;
      const e = map.get(key) ?? { key, title: h.albumTitle, artist: (h.artists ?? [])[0] ?? "—", artwork: null, releaseDate: h.releaseDate ?? null, albumId: h.spotifyAlbumId ?? null, distributors: new Set<string>(), tracks: new Set<string>(), lastSeen: h.at };
      if (!e.artwork && h.artworkUrl) e.artwork = h.artworkUrl;
      if (h.distributor) e.distributors.add(h.distributor);
      if (h.trackTitle) e.tracks.add(h.trackTitle);
      if (h.at > e.lastSeen) e.lastSeen = h.at;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }, [items]);

  return (
    <>
      <PageHead title="Albums" desc="Releases observed in your analyses. Open one to load its full tracklist." />
      {!items ? <div className="skeleton" style={{ height: 200 }} /> :
        albums.length === 0 ? <EmptyState title="No albums yet" body="Albums appear here as you analyze tracks. Older history entries (before the catalog upgrade) don't carry album data." /> :
        <div className="album-grid">
          {albums.map((a) => (
            <div key={a.key} className="album-card anim-in" role={a.albumId ? "button" : undefined} tabIndex={a.albumId ? 0 : undefined}
              onClick={() => a.albumId && onAnalyze(`https://open.spotify.com/album/${a.albumId}`)}
              onKeyDown={(e) => { if (a.albumId && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAnalyze(`https://open.spotify.com/album/${a.albumId}`); } }}
              title={a.albumId ? "Open release workspace" : undefined}>
              <ArtworkThumb url={a.artwork} alt={a.title} size={148} radius={10} />
              <div style={{ marginTop: 8, fontWeight: 600, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
              <div className="hint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artist}</div>
              <div className="hint" style={{ fontSize: 10.5, marginTop: 4 }}>
                {a.releaseDate ? new Date(a.releaseDate).getFullYear() : ""}{a.tracks.size ? ` · ${a.tracks.size} analyzed` : ""}
              </div>
              {a.distributors.size > 0 && <div className="distributor-value hint" style={{ fontSize: 10.5, color: "var(--accent)" }}>{[...a.distributors].join(", ")}</div>}
            </div>
          ))}
        </div>}
    </>
  );
}

// ---------------- Tracks ----------------
export function TracksView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const items = useHistory();
  const [q, setQ] = useState("");
  const tracks = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const h of items ?? []) {
      const key = h.spotifyTrackId ?? h.isrc ?? `${h.trackTitle}::${(h.artists ?? []).join(",")}`;
      if (!key || key.startsWith("null")) continue;
      if (!map.has(key)) map.set(key, h); // history is newest-first — keep the latest
    }
    return [...map.values()];
  }, [items]);

  const filtered = q.trim()
    ? tracks.filter((t) => (t.trackTitle ?? "").toLowerCase().includes(q.trim().toLowerCase()) || (t.artists ?? []).join(" ").toLowerCase().includes(q.trim().toLowerCase()) || (t.isrc ?? "").toLowerCase().includes(q.trim().toLowerCase()))
    : tracks;

  return (
    <>
      <PageHead title="Tracks" desc="Every distinct track you've analyzed — latest result per track." />
      <section className="panel anim-in">
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, artist, ISRC…" aria-label="Search tracks" style={{ maxWidth: 320 }} />
        </div>
        {!items ? <div className="skeleton" style={{ height: 160 }} /> :
          filtered.length === 0 ? <EmptyState title={q ? "No matches" : "No tracks yet"} body={q ? undefined : "Analyzed tracks appear here."} /> :
          <div className="table-scroll"><table>
            <thead><tr><th></th><th>Track</th><th>Artist</th><th>ISRC</th><th>Distributor</th><th>Released</th><th>Analyzed</th><th></th></tr></thead>
            <tbody>{filtered.map((t, i) => (
              <tr key={t.id ?? i}>
                <td style={{ width: 42 }}><ArtworkThumb url={t.artworkUrl} alt={t.trackTitle ?? "artwork"} /></td>
                <td style={{ fontWeight: 550 }}>{t.trackTitle ?? t.input.slice(0, 24)}</td>
                <td>{(t.artists ?? []).join(", ") || "—"}</td>
                <td className="mono">{t.isrc ?? "—"}</td>
                <td className="distributor-value">{t.distributor ?? "—"}</td>
                <td className="hint">{t.releaseDate ?? "—"}</td>
                <td className="hint">{new Date(t.at).toLocaleDateString()}</td>
                <td><button className="btn btn-sm" onClick={() => onAnalyze(t.spotifyTrackId ?? t.input)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </section>
    </>
  );
}
