"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StreamingPerformanceChart, StreamPoint, ChartState } from "./releases/StreamingPerformanceChart";
import { StreamSummary } from "./releases/StreamSummary";
import { PlatformComparison } from "./releases/PlatformComparison";
import { CopyButton } from "./ui";
import { runConnectorLookup, ConnectorLookupResult, ConnectorLookupStage } from "../lib/connector";
import {
  Workspace, AlbumRelease, TrackStatus, NA,
  dur, fmtDate, deriveTrackStatus, jget,
} from "../lib/types";

// Per-track analysis state, keyed by the exact Spotify track id. A track's
// result is NEVER reused for another track.
export type TrackResult = { status: TrackStatus; ws?: Workspace; dist?: ConnectorLookupResult; connStage?: ConnectorLookupStage };
export type Session = { release: AlbumRelease; initialTrackId: string; seed: { trackId: string; ws: Workspace } | null };

type PlaylistRow = { name: string | null; type: string | null; countryCode: string | null; subscriberCount: number | null; position: number | null; peakPosition: number | null; entryDate: string | null };
type ChartRow = { name: string | null; countryCode: string | null; position: number | null; oldPosition: number | null; date: string | null };
type RadioRow = { name: string | null; city: string | null; country: string | null; playCount: number | null };
type Analytics = {
  capabilities: Record<string, string>;
  data: {
    identifiers?: { platformName?: string; platformCode?: string; identifier?: string; url?: string }[];
    albums?: { name?: string; upc?: string; releaseDate?: string; type?: string }[];
    playlists?: PlaylistRow[] | null;
    charts?: ChartRow[] | null;
    radio?: RadioRow[] | null;
  };
};
type StreamsData = { state: ChartState; points: StreamPoint[]; prevPoints: StreamPoint[] | null; updatedAt: string | null };

/**
 * Orchestrates a release, laid out like the reference dashboard:
 *   [ left: artwork + tracklist | center: info cards → summary → chart → data | right: URLs + export ]
 * Each track's result is cached by its exact Spotify id, never reused.
 */
export function ReleaseWorkspace({ session, flash, onOpenSettings }: { session: Session; flash: (m: string) => void; onOpenSettings: () => void }) {
  const { release, initialTrackId, seed } = session;
  const [activeId, setActiveId] = useState(initialTrackId);
  const [results, setResults] = useState<Record<string, TrackResult>>(() =>
    seed && seed.ws ? { [seed.trackId]: { status: deriveTrackStatus(seed.ws), ws: seed.ws } } : {});
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const reqSeq = useRef<Record<string, number>>({});
  const connectorBusy = useRef<Set<string>>(new Set());

  const runConnectorFor = useCallback((id: string) => {
    if (!id || connectorBusy.current.has(id)) return;
    connectorBusy.current.add(id);
    const patch = (p: Partial<TrackResult>) => setResults((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...p } } : prev));
    runConnectorLookup(id, (stage) => patch({ connStage: stage }))
      .then((dist) => patch({ dist }))
      .catch(() => patch({ dist: { stage: "failed", distributor: null, licensorUuid: null, status: "unresolved", isrc: null } }))
      .finally(() => { connectorBusy.current.delete(id); });
  }, []);

  const analyzeTrack = useCallback((id: string, force = false) => {
    if (!id) return;
    const cur = resultsRef.current[id];
    if (!force && cur && (cur.status === "loading" || cur.status === "ready" || cur.status === "partial")) return;
    const seq = (reqSeq.current[id] ?? 0) + 1;
    reqSeq.current[id] = seq;
    if (force) connectorBusy.current.delete(id);
    setResults((prev) => ({ ...prev, [id]: { status: "loading" } }));
    fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: id }) })
      .then((r) => r.json())
      .then((data: Record<string, unknown>) => {
        if (reqSeq.current[id] !== seq) return;
        if (data.error || data.kind !== "track") { setResults((prev) => ({ ...prev, [id]: { status: "failed" } })); return; }
        const ws = data as unknown as Workspace;
        setResults((prev) => ({ ...prev, [id]: { status: deriveTrackStatus(ws), ws } }));
        if (ws.distributor?.status !== "verified") runConnectorFor(id);
      })
      .catch(() => { if (reqSeq.current[id] === seq) setResults((prev) => ({ ...prev, [id]: { status: "failed" } })); });
  }, [runConnectorFor]);

  useEffect(() => { analyzeTrack(activeId); }, [activeId, analyzeTrack]);

  // Seeded workspace skips analyzeTrack's fetch — start its connector here.
  useEffect(() => {
    if (seed?.ws && seed.ws.distributor?.status !== "verified") runConnectorFor(seed.trackId);
  }, [seed, runConnectorFor]);

  useEffect(() => {
    if (!release.spotifyAlbumId) return;
    const url = `${window.location.pathname}?album=${release.spotifyAlbumId}&track=${activeId}`;
    window.history.replaceState(null, "", url);
  }, [release.spotifyAlbumId, activeId]);

  const active = results[activeId];

  return (
    <div className="ws-layout">
      <ReleaseSidebar release={release} activeId={activeId} results={results} onSelect={setActiveId} activeWs={active?.ws} />
      <div className="ws-main" style={{ minWidth: 0 }}>
        {active?.ws
          ? <SelectedTrackWorkspace key={activeId} ws={active.ws} status={active.status} dist={active.dist} connStage={active.connStage} flash={flash} release={release} onOpenSettings={onOpenSettings}
              onRetryDistributor={() => { setResults((prev) => (prev[activeId] ? { ...prev, [activeId]: { ...prev[activeId], dist: undefined, connStage: undefined } } : prev)); connectorBusy.current.delete(activeId); runConnectorFor(activeId); }} />
          : <SelectedTrackPlaceholder failed={(active?.status ?? "loading") === "failed"} onRetry={() => analyzeTrack(activeId, true)} />}
      </div>
    </div>
  );
}

// ================= Left column: release panel =================

const DOT: Record<TrackStatus, string> = { not_loaded: "var(--text-muted)", loading: "var(--accent)", ready: "var(--success)", partial: "var(--warning)", failed: "var(--danger)" };
const DOT_TITLE: Record<TrackStatus, string> = { not_loaded: "Not analyzed", loading: "Analyzing…", ready: "Ready", partial: "Partial data", failed: "Failed" };

/** Artwork + release facts + the tracklist, as one tall dark card. */
function ReleaseSidebar({ release, activeId, results, onSelect, activeWs }: {
  release: AlbumRelease; activeId: string; results: Record<string, TrackResult>; onSelect: (id: string) => void; activeWs?: Workspace;
}) {
  const art = activeWs?.metadata.artworkUrl ?? release.artworkUrl;
  const multiDisc = release.discCount > 1;
  return (
    <section className="panel ws-card anim-in ws-release" style={{ margin: 0 }}>
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="release-art" src={art} alt={release.title} loading="lazy" />
      ) : <div className="release-art-fallback">♪</div>}
      <div style={{ margin: "10px 0 0", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, overflowWrap: "anywhere" }}>{release.title}</div>
        <div className="hint" style={{ fontSize: 11.5, marginTop: 2 }}>{release.artists.join(", ") || NA}</div>
        <div className="hint" style={{ fontSize: 10.5, marginTop: 4 }}>
          {release.releaseType ? release.releaseType[0].toUpperCase() + release.releaseType.slice(1) : "Release"} · {release.totalTracks || release.tracks.length} track{(release.totalTracks || release.tracks.length) > 1 ? "s" : ""}
        </div>
      </div>
      {release.tracks.length > 1 && <>
        <div className="ws-divider" />
        <div className="tracklist-flat tracklist-scroll">
          {release.tracks.map((t, i) => {
            const prevDisc = i > 0 ? release.tracks[i - 1].discNumber : t.discNumber;
            const showDisc = multiDisc && (i === 0 || t.discNumber !== prevDisc);
            const res = results[t.spotifyTrackId];
            const st = res?.status ?? "not_loaded";
            const pop = res?.ws?.metadata.popularity;
            const selected = t.spotifyTrackId === activeId;
            return (
              <div key={t.spotifyTrackId}>
                {showDisc && <div className="hint" style={{ fontSize: 10, margin: "8px 0 3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Disc {t.discNumber}</div>}
                <div className={`trow ${selected ? "selected" : ""}`} title={DOT_TITLE[st]} role="button" tabIndex={0}
                  aria-current={selected} aria-label={`Analyze ${t.title}`}
                  onClick={() => onSelect(t.spotifyTrackId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.spotifyTrackId); } }}>
                  <span className="tno">{t.trackNumber || i + 1}</span>
                  <span className="t-dot" style={{ background: DOT[st] }} aria-hidden />
                  <span className="t-main">
                    <span className="ttl">{t.title}</span>
                    <span className="tsub">{t.artists.join(", ") || NA}</span>
                  </span>
                  <span className="hint" style={{ fontSize: 10 }} title={pop != null ? "Spotify popularity" : undefined}>{pop != null ? pop : ""}</span>
                  <span className="tdur">{dur(t.durationMs) ?? "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </>}
    </section>
  );
}

// ================= Center + right =================

function SelectedTrackWorkspace({ ws, status, dist, connStage, flash, release, onRetryDistributor, onOpenSettings }: { ws: Workspace; status: TrackStatus; dist?: ConnectorLookupResult; connStage?: ConnectorLookupStage; flash: (m: string) => void; release: AlbumRelease; onRetryDistributor?: () => void; onOpenSettings?: () => void }) {
  // Apply the Spotify-connector's captured licensor UUID onto THIS track only.
  const effWs: Workspace = (() => {
    if (!dist || !dist.licensorUuid) return ws;
    const status2 = dist.status === "verified" ? "verified" : dist.status === "conflict" ? "conflict" : "uuid_not_mapped";
    return { ...ws, distributor: { name: dist.distributor, uuid: dist.licensorUuid, status: status2 }, identity: { ...ws.identity, licensorUuid: dist.licensorUuid } };
  })();
  const uuid = ws.identity.soundchartsSongUuid;
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState(90);
  const [metric, setMetric] = useState("spotify");
  const [compare, setCompare] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const [streams, setStreams] = useState<StreamsData>({ state: "loading", points: [], prevPoints: null, updatedAt: null });

  useEffect(() => { if (uuid) jget<Analytics>(`/api/song/${uuid}/analytics`).then(setAnalytics).catch(() => setAnalytics(null)); }, [uuid]);

  // One request per (uuid, metric, range, compare); comparison doubles the
  // window (API caps at 365d) and the halves are split by real dates —
  // never synthesized. Aborts superseded requests.
  useEffect(() => {
    if (!uuid) { setStreams({ state: "empty", points: [], prevPoints: null, updatedAt: null }); return; }
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
    <div className="ws-stack">
      {status === "partial" && <div className="row" style={{ justifyContent: "flex-end" }}><span className="badge warn"><span className="dot" />Partial data</span></div>}

      <div className="ws-center-wrap">
        <div className="ws-center" style={{ minWidth: 0 }}>
          {/* Three info cards */}
          <div className="ws-cards3">
            <OverviewCard ws={effWs} release={release} flash={flash} />
            <ReleaseMetadataCard ws={effWs} release={release} flash={flash} connStage={connStage} onRetry={onRetryDistributor} onSetup={onOpenSettings} />
            <PerformanceDetailsCard ws={effWs} release={release} flash={flash} />
          </div>

          <StreamSummary points={streams.points} prevPoints={streams.prevPoints} state={streams.state} days={days} />
          <StreamingPerformanceChart
            points={streams.points} prevPoints={streams.prevPoints} state={streams.state}
            days={days} onDays={setDays} metric={metric} onMetric={setMetric}
            compare={compare} onCompare={setCompare} updatedAt={streams.updatedAt}
            onRetry={() => setRetrySeq((n) => n + 1)}
            exportLabel={ws.metadata.trackTitle ?? ws.identity.spotifyTrackId ?? "track"}
          />

          <DataSections ws={effWs} analytics={analytics} uuid={uuid} />
        </div>

        <div className="ws-rail">
          <OtherUrlsCard ws={effWs} analytics={analytics} />
          <ExportActions ws={effWs} flash={flash} release={release} />
        </div>
      </div>
    </div>
  );
}

function SelectedTrackPlaceholder({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (failed) {
    return (
      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Analysis failed</div>
        <div className="hint" style={{ fontSize: 12 }}>This track could not be analyzed. Other tracks in the release are unaffected.</div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="ws-stack">
      <div className="ws-cards3">{[0, 1, 2].map((i) => <div key={i} className="panel" style={{ margin: 0 }}><div className="skeleton" style={{ height: 120 }} /></div>)}</div>
      <div className="metric-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="metric"><div className="skeleton" style={{ height: 12, width: "55%" }} /><div className="skeleton" style={{ height: 28, marginTop: 8 }} /></div>)}</div>
      <div className="skeleton" style={{ height: 300 }} />
    </div>
  );
}

// ---- The three info cards ----

/** Track name · artists · number · primary actions. */
function OverviewCard({ ws, release, flash }: { ws: Workspace; release: AlbumRelease; flash: (m: string) => void }) {
  const trackNumber = release.tracks.find((t) => t.spotifyTrackId === ws.identity.spotifyTrackId)?.trackNumber ?? null;
  const art = ws.metadata.artworkUrl;
  const artName = `${(ws.metadata.artists[0] ?? "track")} - ${ws.metadata.trackTitle ?? ws.identity.spotifyTrackId ?? "artwork"}`;
  const downloadArt = () => {
    if (!art) return;
    const a = document.createElement("a");
    a.href = `/api/artwork?url=${encodeURIComponent(art)}&name=${encodeURIComponent(artName)}`;
    a.download = "";
    a.click();
    flash("Artwork download started");
  };
  return (
    <section className="panel ws-card anim-in" style={{ margin: 0 }}>
      <h3 className="panel-title">Track Overview</h3>
      <div style={{ fontSize: 14, fontWeight: 650, overflowWrap: "anywhere" }}>
        {ws.metadata.trackTitle ?? NA}{ws.metadata.explicit ? <span className="e-tag" title="Explicit">E</span> : null}
      </div>
      <div className="hint" style={{ fontSize: 11.5, margin: "2px 0 10px" }}>
        {ws.metadata.artists.join(", ") || NA}{trackNumber ? ` · Track ${trackNumber}` : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {ws.spotifyUrl
          ? <a className="btn primary btn-sm" style={{ textAlign: "center" }} href={ws.spotifyUrl} target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a>
          : <button className="btn primary btn-sm" disabled>Open in Spotify</button>}
        <button className="btn btn-sm" onClick={downloadArt} disabled={!art}>Download artwork</button>
        <button className="btn btn-sm" disabled title="Track audio is not available through official APIs">Download track · unavailable</button>
      </div>
    </section>
  );
}

// Terminal connector failure stages.
const FAIL_STAGES: ConnectorLookupStage[] = ["login_required", "timed_out", "no_connector", "failed"];
const ACTIVE_STAGES: ConnectorLookupStage[] = ["starting", "opening_spotify", "waiting_for_metadata"];
function failText(stage: ConnectorLookupStage): { label: string; cls: string; action: "retry" | "setup" } {
  switch (stage) {
    case "no_connector": return { label: "Connector unavailable", cls: "muted", action: "setup" };
    case "login_required": return { label: "Login required", cls: "warn", action: "retry" };
    case "timed_out": return { label: "Timed out", cls: "warn", action: "retry" };
    default: return { label: "Lookup failed", cls: "err", action: "retry" };
  }
}

/** UPC · ISRC · Distributor · Label · Original release date. */
function ReleaseMetadataCard({ ws, release, flash, connStage, onRetry, onSetup }: { ws: Workspace; release: AlbumRelease; flash: (m: string) => void; connStage?: ConnectorLookupStage; onRetry?: () => void; onSetup?: () => void }) {
  const d = ws.distributor;
  const confirmed = d.status === "verified";
  const captured = d.status === "uuid_not_mapped" || d.status === "conflict";
  const failStage = connStage && FAIL_STAGES.includes(connStage) ? connStage : undefined;
  const active = !confirmed && !captured && (!connStage || ACTIVE_STAGES.includes(connStage)) && !failStage;

  return (
    <section className="panel ws-card anim-in" style={{ margin: 0 }}>
      <h3 className="panel-title">Release Metadata</h3>
      <div className="ident-row"><div className="i-label">UPC{ws.identity.upc && <CopyButton value={ws.identity.upc} label="UPC" flash={flash} small />}</div><div className="i-value">{ws.identity.upc ?? NA}</div></div>
      <div className="ident-row"><div className="i-label">ISRC{ws.identity.isrc && <CopyButton value={ws.identity.isrc} label="ISRC" flash={flash} small />}</div><div className="i-value">{ws.identity.isrc ?? NA}</div></div>
      <div className="ident-row">
        <div className="i-label">Distributor{confirmed && d.name && <CopyButton value={d.name} label="distributor" flash={flash} small />}</div>
        {confirmed ? (
          <div className="distributor-value" style={{ fontSize: 13, fontWeight: 650, marginTop: 3 }}>{d.name} <span className="badge ok" style={{ fontSize: 9.5, padding: "1px 6px", marginLeft: 4 }}><span className="dot" />Verified</span></div>
        ) : active ? (
          <div className="i-value" style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "inherit" }}><span className="spin" aria-hidden />Resolving…</div>
        ) : captured ? (
          <div className="i-value" style={{ fontFamily: "inherit" }} title="The licensor UUID was captured but is not in the canonical mapping — the UUID itself is never shown as a distributor name.">
            Unknown distributor <span className={`badge ${d.status === "conflict" ? "err" : "warn"}`} style={{ fontSize: 9.5, padding: "1px 6px", marginLeft: 4 }}><span className="dot" />{d.status === "conflict" ? "Conflict" : "UUID not mapped"}</span>
          </div>
        ) : (
          <div className="i-value" style={{ fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            Unknown distributor
            {failStage && <span className={`badge ${failText(failStage).cls}`} style={{ fontSize: 9.5, padding: "1px 6px" }}><span className="dot" />{failText(failStage).label}</span>}
            {failStage && failText(failStage).action === "retry" && onRetry && <button className="btn btn-sm" style={{ padding: "2px 8px", fontSize: 10.5 }} onClick={onRetry}>Retry</button>}
            {failStage && failText(failStage).action === "setup" && onSetup && <button className="btn btn-sm" style={{ padding: "2px 8px", fontSize: 10.5 }} onClick={onSetup}>Set up</button>}
          </div>
        )}
      </div>
      <div className="ident-row"><div className="i-label">Label{ws.metadata.label && <CopyButton value={ws.metadata.label} label="label" flash={flash} small />}</div><div className="i-value" style={{ fontFamily: "inherit" }}>{ws.metadata.label ?? NA}</div></div>
      <div className="ident-row"><div className="i-label">Original release date</div><div className="i-value" style={{ fontFamily: "inherit" }}>{fmtDate(release.releaseDate ?? ws.metadata.releaseDate)}</div></div>
    </section>
  );
}

/** Release date · duration · explicit · popularity · IDs · licensor UUID. */
function PerformanceDetailsCard({ ws, release, flash }: { ws: Workspace; release: AlbumRelease; flash: (m: string) => void }) {
  const m = ws.metadata;
  const licensor = ws.distributor.uuid ?? ws.identity.licensorUuid;
  return (
    <section className="panel ws-card anim-in" style={{ margin: 0 }}>
      <h3 className="panel-title">Performance Details</h3>
      <div className="kv"><span className="k">Release date</span><span className="v">{fmtDate(m.releaseDate)}</span></div>
      <div className="kv"><span className="k">Duration</span><span className="v">{dur(m.durationMs) ?? NA}</span></div>
      <div className="kv"><span className="k">Explicit</span><span className="v">{m.explicit === null ? NA : m.explicit ? "Yes" : "No"}</span></div>
      <div className="kv"><span className="k">Popularity</span><span className="v">{m.popularity == null ? NA : `${m.popularity} / 100`}</span></div>
      <div className="ident-row">
        <div className="i-label">Licensor UUID{licensor && <CopyButton value={licensor} label="Licensor UUID" flash={flash} small />}</div>
        <div className="i-value">{licensor ?? NA}</div>
      </div>
      <div className="ident-row">
        <div className="i-label">Spotify Track ID{ws.identity.spotifyTrackId && <CopyButton value={ws.identity.spotifyTrackId} label="track id" flash={flash} small />}</div>
        <div className="i-value">{ws.identity.spotifyTrackId ?? NA}</div>
      </div>
      <div className="ident-row" style={{ borderBottom: "none" }}>
        <div className="i-label">Album ID{release.spotifyAlbumId && <CopyButton value={release.spotifyAlbumId} label="album id" flash={flash} small />}</div>
        <div className="i-value">{release.spotifyAlbumId ?? NA}</div>
      </div>
    </section>
  );
}

// ---- Right rail ----

/** Every active store link for this track, stacked — deduplicated per platform. */
function OtherUrlsCard({ ws, analytics }: { ws: Workspace; analytics: Analytics | null }) {
  const rows: { key: string; name: string; url: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, url: string | null, keyRaw?: string) => {
    // Dedup by platform code AND by display name — upstream identifier lists
    // can repeat a platform under two codes (e.g. Deezer twice).
    const key = (keyRaw ?? name).toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || !url || seen.has(key) || seen.has(nameKey)) return;
    try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") return; } catch { return; }
    seen.add(key); seen.add(nameKey);
    rows.push({ key, name, url });
  };
  if (ws.spotifyUrl) push("Spotify", ws.spotifyUrl, "spotify");
  for (const id of analytics?.data.identifiers ?? []) push(id.platformName ?? id.platformCode ?? "Platform", id.url ?? null, id.platformCode ?? id.platformName);
  return (
    <section className="panel ws-card anim-in" style={{ margin: 0 }}>
      <h3 className="panel-title">Other URLs</h3>
      {analytics === null && rows.length === 0 ? <div className="skeleton" style={{ height: 80 }} /> :
        rows.length === 0 ? <div className="hint">No store links available.</div> :
        <div className="url-list">
          {rows.map((r) => (
            <a key={r.key} className="url-row" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${r.name}`}>
              <span className="platform-ico" style={{ width: 20, height: 20, fontSize: 10 }}>{r.name.slice(0, 1)}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              <span aria-hidden style={{ color: "var(--text-muted)", fontSize: 10 }}>↗</span>
            </a>
          ))}
        </div>}
    </section>
  );
}

function distConfirmed(ws: Workspace) { const d = ws.distributor; return !!(d.uuid && d.name && d.status === "verified"); }

function ExportActions({ ws, flash, release }: { ws: Workspace; flash: (m: string) => void; release?: AlbumRelease }) {
  const safe = { input: ws.input, identity: ws.identity, metadata: ws.metadata, distributor: { name: ws.distributor.name, uuid: ws.distributor.uuid, status: ws.distributor.status } };
  const dl = (name: string, content: string, mime: string) => { const b = new Blob([content], { type: mime }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const csv = () => {
    const row: Record<string, unknown> = { trackTitle: ws.metadata.trackTitle, artists: ws.metadata.artists.join("; "), album: ws.metadata.albumTitle, isrc: ws.identity.isrc, spotifyTrackId: ws.identity.spotifyTrackId, soundchartsUuid: ws.identity.soundchartsSongUuid, distributor: ws.distributor.name, distributorStatus: ws.distributor.status };
    const k = Object.keys(row); const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    dl(`track-${ws.identity.spotifyTrackId ?? "result"}.csv`, k.join(",") + "\n" + k.map((x) => esc(row[x])).join(","), "text/csv");
  };
  const summary = () => { const s = `${ws.metadata.trackTitle ?? "Track"} — ${ws.metadata.artists.join(", ")}\nISRC: ${ws.identity.isrc ?? NA}\nDistributor: ${distConfirmed(ws) ? ws.distributor.name : "Unresolved"}`; navigator.clipboard.writeText(s).then(() => flash("Copied summary")).catch(() => {}); };
  const albumJson = () => {
    if (!release || !release.spotifyAlbumId) return;
    const out = { spotifyAlbumId: release.spotifyAlbumId, title: release.title, artists: release.artists, releaseType: release.releaseType, releaseDate: release.releaseDate, upc: release.upc, label: release.label, totalTracks: release.totalTracks, discCount: release.discCount, tracks: release.tracks.map((t) => ({ spotifyTrackId: t.spotifyTrackId, title: t.title, artists: t.artists, discNumber: t.discNumber, trackNumber: t.trackNumber, durationMs: t.durationMs, explicit: t.explicit })) };
    dl(`album-${release.spotifyAlbumId}.json`, JSON.stringify(out, null, 2), "application/json");
  };
  return (
    <section className="panel ws-card anim-in" style={{ margin: 0 }}>
      <h3 className="panel-title">Export</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="card-label" style={{ margin: "0 0 2px", fontSize: 10 }}>Selected track</div>
        <button className="btn btn-sm" onClick={() => dl(`track-${ws.identity.spotifyTrackId ?? "result"}.json`, JSON.stringify(safe, null, 2), "application/json")}>Export metadata JSON</button>
        <button className="btn btn-sm" onClick={csv}>Export metadata CSV</button>
        <button className="btn btn-sm" onClick={summary}>Copy summary</button>
        {release && release.spotifyAlbumId && release.tracks.length > 1 && <>
          <div className="card-label" style={{ margin: "6px 0 2px", fontSize: 10 }}>Release</div>
          <button className="btn btn-sm" onClick={albumJson}>Export release JSON</button>
        </>}
      </div>
    </section>
  );
}

// ---- Data sections (real data when the plan provides it) ----

function DataSections({ ws, analytics, uuid }: { ws: Workspace; analytics: Analytics | null; uuid: string | null }) {
  const [tab, setTab] = useState("playlists");
  const playlists = analytics?.data.playlists ?? null;
  const charts = analytics?.data.charts ?? null;
  const radio = analytics?.data.radio ?? null;
  const cap = analytics?.capabilities ?? {};
  const count = (arr: unknown[] | null | undefined) => (Array.isArray(arr) ? arr.length : 0);

  const tabs = [
    { id: "playlists", label: `Playlists${count(playlists) ? ` · ${count(playlists)}` : ""}` },
    { id: "charts", label: `Charts${count(charts) ? ` · ${count(charts)}` : ""}` },
    { id: "radio", label: `Radio${count(radio) ? ` · ${count(radio)}` : ""}` },
    { id: "platforms", label: "Platforms" },
    { id: "metadata", label: "Metadata" },
  ];

  const emptyText = (key: string, noun: string) =>
    cap[key] === "plan_restricted" ? `${noun} data is not included in the current API plan.` :
    analytics === null ? "" : `No current ${noun.toLowerCase()} placements for this track.`;

  return (
    <section className="panel anim-in" style={{ margin: 0 }}>
      <div className="tabs">{tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>

      {analytics === null && tab !== "platforms" && tab !== "metadata" ? <div className="skeleton" style={{ height: 120 }} /> : null}

      {tab === "playlists" && analytics !== null && (
        !playlists?.length ? <div className="empty">{emptyText("playlists", "Playlist")}</div> :
        <div className="table-scroll"><table>
          <thead><tr><th>Playlist</th><th>Type</th><th>Country</th><th>Position</th><th>Peak</th><th>Followers</th><th>Added</th></tr></thead>
          <tbody>{playlists.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 550 }}>{p.name ?? "—"}</td>
              <td className="hint">{p.type ?? "—"}</td>
              <td className="hint">{p.countryCode ?? "—"}</td>
              <td>{p.position ?? "—"}</td>
              <td>{p.peakPosition ?? "—"}</td>
              <td>{p.subscriberCount ? p.subscriberCount.toLocaleString() : "—"}</td>
              <td className="hint">{p.entryDate ? new Date(p.entryDate).toLocaleDateString() : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === "charts" && analytics !== null && (
        !charts?.length ? <div className="empty">{emptyText("charts", "Chart")}</div> :
        <div className="table-scroll"><table>
          <thead><tr><th>Chart</th><th>Country</th><th>Position</th><th>Previous</th><th>Date</th></tr></thead>
          <tbody>{charts.map((c, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 550 }}>{c.name ?? "—"}</td>
              <td className="hint">{c.countryCode ?? "—"}</td>
              <td>{c.position ?? "—"}</td>
              <td className="hint">{c.oldPosition ?? "—"}</td>
              <td className="hint">{c.date ? new Date(c.date).toLocaleDateString() : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === "radio" && analytics !== null && (
        !radio?.length ? <div className="empty">{emptyText("radio", "Radio airplay")}</div> :
        <div className="table-scroll"><table>
          <thead><tr><th>Station</th><th>City</th><th>Country</th><th>Plays</th></tr></thead>
          <tbody>{radio.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 550 }}>{r.name ?? "—"}</td>
              <td className="hint">{r.city ?? "—"}</td>
              <td className="hint">{r.country ?? "—"}</td>
              <td>{r.playCount ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {tab === "platforms" && (uuid ? <PlatformComparison uuid={uuid} days={30} /> : <div className="empty">Platform data requires streaming analytics for this track.</div>)}

      {tab === "metadata" && (
        <div className="detail-grid">
          <D k="Track title" v={ws.metadata.trackTitle} /><D k="Artists" v={ws.metadata.artists.join(", ") || null} />
          <D k="Album" v={ws.metadata.albumTitle} /><D k="Label" v={ws.metadata.label} />
          <D k="ISRC" v={ws.identity.isrc} mono /><D k="UPC" v={ws.identity.upc} mono />
          <D k="Spotify Track ID" v={ws.identity.spotifyTrackId} mono /><D k="Soundcharts UUID" v={ws.identity.soundchartsSongUuid} mono />
          <D k="Release date" v={ws.metadata.releaseDate} /><D k="Duration" v={dur(ws.metadata.durationMs)} />
          <D k="Explicit" v={ws.metadata.explicit === null ? null : ws.metadata.explicit ? "Yes" : "No"} /><D k="Genres" v={ws.metadata.genres.join(", ") || null} />
        </div>
      )}
    </section>
  );
}
function D({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return <div className="detail-item"><div className="k">{k}</div><div className={`v ${mono ? "mono" : ""}`} style={{ overflowWrap: "anywhere" }}>{v ?? <span className="hint">{NA}</span>}</div></div>;
}
