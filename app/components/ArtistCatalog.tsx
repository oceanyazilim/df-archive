"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "./ui";
import { runConnectorLookup } from "../lib/connector";
import { dur, fmtDate, NA } from "../lib/types";

export type CatalogTrack = {
  key: string;
  spotifyTrackId: string | null;
  soundchartsSongUuid: string | null;
  title: string;
  artists: string[];
  albumTitle: string | null;
  spotifyAlbumId: string | null;
  albumType: string | null;
  releaseDate: string | null;
  durationMs: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  explicit: boolean | null;
  isrc: string | null;
  upc: string | null;
  onProfile: boolean;
  source: "spotify" | "soundcharts";
};

export type ArtistCatalogData = {
  spotifyArtistId: string;
  name: string | null;
  imageUrl: string | null;
  spotifyUrl: string;
  soundchartsArtistUuid: string | null;
  tracks: CatalogTrack[];
  counts: { total: number; onProfile: number; offProfile: number; albums: number; withIsrc: number };
  coverage: {
    spotifyAlbums: number; spotifyAlbumsTruncated: boolean;
    soundchartsTotal: number | null; soundchartsLoaded: number; soundchartsTruncated: boolean;
    soundchartsAvailable: boolean; note: string | null;
  };
};

/** Per-track resolution state, filled progressively from the Spotify connector. */
type Resolved = { status: "idle" | "running" | "done" | "failed"; distributor: string | null; licensorUuid: string | null; isrc: string | null; state?: string };

type Filter = "all" | "profile" | "removed" | "unresolved";
type SortKey = "release" | "title" | "album" | "distributor";

const PARALLEL = 3;          // concurrent connector lookups
const PAGE = 100;            // rows rendered per page

export function ArtistCatalogWorkspace({ data, flash, onAnalyze, onOpenSettings }: {
  data: ArtistCatalogData;
  flash: (m: string) => void;
  onAnalyze: (input: string) => void;
  onOpenSettings: () => void;
}) {
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [running, setRunning] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("release");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);
  const cancelRef = useRef(false);
  const resolvedRef = useRef<Record<string, Resolved>>({});
  resolvedRef.current = resolved;

  // Rows the connector can actually resolve: it needs a Spotify track id.
  const resolvable = useMemo(() => data.tracks.filter((t) => !!t.spotifyTrackId), [data.tracks]);
  const doneCount = useMemo(() => Object.values(resolved).filter((r) => r.status === "done" || r.status === "failed").length, [resolved]);

  useEffect(() => () => { cancelRef.current = true; }, []);

  /**
   * Resolve a batch of tracks through the user's own Spotify client.
   * Each lookup yields the licensor UUID (→ distributor) and the ISRC, which
   * the public API no longer exposes for album tracks.
   */
  const resolveAll = useCallback(async (only?: CatalogTrack[]) => {
    const queue = (only ?? resolvable).filter((t) => t.spotifyTrackId && !resolvedRef.current[t.key]);
    if (!queue.length) { flash("Nothing left to resolve"); return; }
    cancelRef.current = false;
    setRunning(true);

    let index = 0;
    // Each worker owns one row at a time. A failure marks that row and moves
    // on, so a single bad track can never stall a several-hundred-row run.
    const worker = async () => {
      while (!cancelRef.current) {
        const current = queue[index++];
        if (!current) return;
        const id = current.spotifyTrackId!;
        setResolved((p) => ({ ...p, [current.key]: { status: "running", distributor: null, licensorUuid: null, isrc: current.isrc } }));
        let next: Resolved;
        try {
          const r = await runConnectorLookup(id);
          const terminal = r.stage === "matched" || r.stage === "unresolved" || r.stage === "conflict";
          next = {
            status: terminal ? "done" : "failed",
            distributor: r.distributor,
            licensorUuid: r.licensorUuid,
            isrc: r.isrc ?? current.isrc,
            state: r.stage,
          };
        } catch {
          next = { status: "failed", distributor: null, licensorUuid: null, isrc: current.isrc, state: "failed" };
        }
        setResolved((p) => ({ ...p, [current.key]: next }));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, () => worker().catch(() => {})));
    setRunning(false);
  }, [resolvable, flash]);

  const stop = () => { cancelRef.current = true; setRunning(false); };

  // ---- filtering / sorting ----
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.tracks.filter((t) => {
      if (filter === "profile" && !t.onProfile) return false;
      if (filter === "removed" && t.onProfile) return false;
      if (filter === "unresolved" && resolved[t.key]?.status === "done") return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.albumTitle ?? "").toLowerCase().includes(q) ||
        (t.isrc ?? "").toLowerCase().includes(q) ||
        (resolved[t.key]?.distributor ?? "").toLowerCase().includes(q) ||
        t.artists.join(" ").toLowerCase().includes(q)
      );
    });
    const dir = asc ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sort === "title") return dir * a.title.localeCompare(b.title);
      if (sort === "album") return dir * (a.albumTitle ?? "").localeCompare(b.albumTitle ?? "");
      if (sort === "distributor") return dir * (resolved[a.key]?.distributor ?? "").localeCompare(resolved[b.key]?.distributor ?? "");
      const da = a.releaseDate ?? "", db = b.releaseDate ?? "";
      return dir * (da === db ? 0 : da < db ? -1 : 1);
    });
    return list;
  }, [data.tracks, query, filter, sort, asc, resolved]);

  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => { setPage(0); }, [query, filter, sort, asc]);

  const exportCsv = () => {
    const head = ["title", "artists", "album", "albumType", "releaseDate", "durationMs", "isrc", "upc", "spotifyTrackId", "soundchartsSongUuid", "onProfile", "distributor", "licensorUuid", "source"];
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(",")];
    for (const t of rows) {
      const r = resolved[t.key];
      lines.push([
        t.title, t.artists.join("; "), t.albumTitle, t.albumType, t.releaseDate, t.durationMs,
        r?.isrc ?? t.isrc, t.upc, t.spotifyTrackId, t.soundchartsSongUuid,
        t.onProfile ? "yes" : "no", r?.distributor ?? "", r?.licensorUuid ?? "", t.source,
      ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `artist-${(data.name ?? data.spotifyArtistId).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-catalog.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(`Exported ${rows.length} rows`);
  };

  const cov = data.coverage;
  const partial = cov.spotifyAlbumsTruncated || cov.soundchartsTruncated || !!cov.note;

  return (
    <div className="ws-stack">
      {/* header */}
      <section className="panel anim-in" style={{ margin: 0 }}>
        <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {data.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={data.imageUrl} alt="" style={{ width: 68, height: 68, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 68, height: 68, borderRadius: "50%", background: "var(--surface-raised)", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>♪</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{data.name ?? data.spotifyArtistId}</div>
            <div className="hint" style={{ fontSize: 12 }}>
              {data.counts.total} tracks · {data.counts.albums} releases on profile
              {data.counts.offProfile > 0 ? ` · ${data.counts.offProfile} no longer on profile` : ""}
            </div>
          </div>
          <a className="btn btn-sm" href={data.spotifyUrl} target="_blank" rel="noopener noreferrer">Open artist ↗</a>
        </div>
      </section>

      {/* summary cards */}
      <div className="metric-grid">
        <div className="metric"><div className="m-label">Total tracks</div><div className="m-value">{data.counts.total}</div><div className="m-sub">across both sources</div></div>
        <div className="metric"><div className="m-label">On profile</div><div className="m-value">{data.counts.onProfile}</div><div className="m-sub">currently listed on Spotify</div></div>
        <div className="metric"><div className="m-label">Removed from profile</div><div className="m-value" style={{ color: data.counts.offProfile ? "var(--warning)" : undefined }}>{data.counts.offProfile}</div><div className="m-sub">still part of the distribution</div></div>
        <div className="metric"><div className="m-label">Distributors resolved</div><div className="m-value">{doneCount} / {resolvable.length}</div><div className="m-sub">{running ? "resolving…" : "via your Spotify client"}</div></div>
      </div>

      {partial && (
        <div className="panel anim-in" style={{ margin: 0, borderColor: "color-mix(in srgb, var(--warning) 30%, var(--border))" }}>
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <span className="badge warn" style={{ flexShrink: 0 }}><span className="dot" />Partial catalogue</span>
            <div className="hint" style={{ fontSize: 12 }}>
              {cov.note ? cov.note + " " : ""}
              {cov.spotifyAlbumsTruncated ? `Loaded the ${cov.spotifyAlbums} most recent releases from Spotify. ` : ""}
              {cov.soundchartsTruncated && cov.soundchartsTotal !== null
                ? `Loaded ${cov.soundchartsLoaded} of ${cov.soundchartsTotal} historical entries.`
                : ""}
            </div>
          </div>
        </div>
      )}

      {/* controls */}
      <section className="panel anim-in" style={{ margin: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, album, ISRC or distributor"
            style={{ flex: "1 1 260px", minWidth: 0 }} aria-label="Search catalogue" />
          <div className="seg" role="group" aria-label="Filter">
            {([["all", "All"], ["profile", "On profile"], ["removed", "Removed"], ["unresolved", "Unresolved"]] as [Filter, string][]).map(([f, l]) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{l}</button>
            ))}
          </div>
          {running
            ? <button className="btn btn-sm" onClick={stop}>Stop</button>
            : <button className="btn primary btn-sm" onClick={() => resolveAll()} disabled={!resolvable.length}>Resolve distributors</button>}
          <button className="btn btn-sm" onClick={exportCsv}>Export CSV</button>
        </div>
        {running && (
          <div style={{ marginTop: 10 }}>
            <div className="progress"><div className="bar" style={{ width: `${Math.round((doneCount / Math.max(1, resolvable.length)) * 100)}%` }} /></div>
            <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
              Resolving through your Spotify client — {doneCount} of {resolvable.length}. You can keep using the panel.
            </div>
          </div>
        )}
        <div className="hint" style={{ fontSize: 11, marginTop: 8 }}>
          Distributor and ISRC come from your own Spotify client, one track at a time — the public API exposes neither for catalogue rows.
          {data.counts.total - resolvable.length > 0
            ? ` ${data.counts.total - resolvable.length} removed entries have no Spotify id, so their distributor cannot be resolved — open one to see everything the analytics catalogue still holds.`
            : ""}
        </div>
      </section>

      {/* table */}
      <section className="panel anim-in" style={{ margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>Catalogue · {rows.length} shown</h3>
          {pageCount > 1 && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span className="hint" style={{ fontSize: 11 }}>Page {page + 1} / {pageCount}</span>
              <button className="btn btn-sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <Th label="Release" k="release" sort={sort} asc={asc} onSort={(k) => { setAsc(sort === k ? !asc : false); setSort(k); }} />
                <Th label="Title" k="title" sort={sort} asc={asc} onSort={(k) => { setAsc(sort === k ? !asc : true); setSort(k); }} />
                <Th label="Album" k="album" sort={sort} asc={asc} onSort={(k) => { setAsc(sort === k ? !asc : true); setSort(k); }} />
                <th>ISRC</th>
                <th>UPC</th>
                <Th label="Distributor" k="distributor" sort={sort} asc={asc} onSort={(k) => { setAsc(sort === k ? !asc : true); setSort(k); }} />
                <th>Status</th>
                <th>Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => {
                const r = resolved[t.key];
                const isrc = r?.isrc ?? t.isrc;
                return (
                  <tr key={t.key}>
                    <td className="hint" style={{ whiteSpace: "nowrap" }}>{fmtDate(t.releaseDate)}</td>
                    <td style={{ fontWeight: 550, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>
                      {t.title}
                      {t.explicit ? <span className="e-tag" title="Explicit">E</span> : null}
                    </td>
                    <td className="hint" style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.albumTitle ?? ""}>{t.albumTitle ?? "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{isrc ?? "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{t.upc ?? "—"}</td>
                    <td>
                      {r?.status === "running" ? <span className="row" style={{ gap: 6 }}><span className="spin" aria-hidden />Resolving…</span>
                        : r?.distributor ? <span className="distributor-value" style={{ fontWeight: 600 }}>{r.distributor}</span>
                        : r?.status === "done" ? <span className="hint">Unknown distributor</span>
                        : r?.status === "failed" ? <span className="hint">Not resolved</span>
                        : <span className="hint">—</span>}
                    </td>
                    <td>
                      {t.onProfile
                        ? <span className="badge ok"><span className="dot" />On profile</span>
                        : <span className="badge warn" title="Known to the analytics catalogue but not listed on the artist's current Spotify profile"><span className="dot" />Removed</span>}
                    </td>
                    <td className="hint">{dur(t.durationMs) ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {(t.spotifyTrackId || t.soundchartsSongUuid) && (
                        <button
                          className="btn btn-sm" style={{ padding: "2px 8px", fontSize: 10.5 }}
                          title={t.spotifyTrackId ? "Open the full track workspace" : "Open from the analytics catalogue — this track is no longer on the Spotify profile"}
                          onClick={() => onAnalyze(t.spotifyTrackId ?? t.soundchartsSongUuid!)}
                        >Open</button>
                      )}
                      {isrc && <CopyButton value={isrc} label="ISRC" flash={flash} small />}
                      {r?.licensorUuid && <CopyButton value={r.licensorUuid} label="UUID" flash={flash} small />}
                    </td>
                  </tr>
                );
              })}
              {!pageRows.length && <tr><td colSpan={9}><div className="empty">No tracks match this filter.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th({ label, k, sort, asc, onSort }: { label: string; k: SortKey; sort: SortKey; asc: boolean; onSort: (k: SortKey) => void }) {
  return (
    <th>
      <button
        onClick={() => onSort(k)}
        style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, display: "inline-flex", gap: 4, alignItems: "center" }}
        aria-label={`Sort by ${label}`}
      >
        {label}{sort === k ? <span aria-hidden>{asc ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}
