"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppSidebar } from "./components/layout/AppSidebar";
import { TopNavigation } from "./components/layout/TopNavigation";
import { MobileNavigation } from "./components/layout/MobileNavigation";
import { PageContainer } from "./components/layout/PageContainer";
import { TooltipProvider } from "./components/shared/Tooltip";
import { Skeleton } from "./components/shared/Skeleton";
import { ErrorState } from "./components/shared/ErrorState";
import { SpotifyUrlInput } from "./components/analyzer/SpotifyUrlInput";
import { AnalysisProgress } from "./components/analyzer/AnalysisProgress";
import { CatalogDashboard } from "./components/dashboard/CatalogDashboard";
import { OceanAnalyzerPage } from "./components/analyzer-details/OceanAnalyzerPage";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { BackgroundFX } from "./components/BackgroundFX";
import { ReleaseWorkspace, Session } from "./components/LookupWorkspace";
import { ArtistCatalogWorkspace, ArtistCatalogData } from "./components/ArtistCatalog";
import { HistoryView } from "./components/views/HistoryView";
import { DistributorsView, ArtistsView, AlbumsView, TracksView } from "./components/views/catalog";
import { AnalyticsView } from "./components/views/AnalyticsView";
import { ReportsView } from "./components/views/ReportsView";
import { UuidDirectoryView, SystemStatusView, SettingsView } from "./components/views/system";
import { EmptyState } from "./components/ui";
import {
  View, Health, Workspace, AlbumRelease, jget, overallStatus,
  ALBUM_ID_RE, synthReleaseFromWorkspace,
} from "./lib/types";

const RELEASE_STEPS = ["Validating Spotify URL", "Reading release metadata", "Matching licensor UUID", "Identifying distributor", "Loading streaming analytics", "Preparing workspace"];
const ARTIST_STEPS = ["Validating Spotify URL", "Fetching artist profile", "Loading release catalog", "Matching licensor UUIDs", "Preparing analytics"];
export default function Page() {
  const [view, setView] = useState<View>("lookup");
  const [collapsed, setCollapsedState] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [lastHealthAt, setLastHealthAt] = useState<number | null>(null);

  // Sidebar collapse state persists across sessions (read after mount to avoid SSR mismatch).
  useEffect(() => {
    try { if (window.localStorage.getItem("ocean:sidebar-collapsed") === "1") setCollapsedState(true); } catch { /* ignore */ }
  }, []);
  const setCollapsed = useCallback((updater: boolean | ((c: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const next = typeof updater === "function" ? (updater as (c: boolean) => boolean)(prev) : updater;
      try { window.localStorage.setItem("ocean:sidebar-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [artist, setArtist] = useState<{ loading: boolean; data: ArtistCatalogData | null; error: string | null; fetchedAt: string | null; artistId: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [stageList, setStageList] = useState<string[]>(RELEASE_STEPS);
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 1500); }, []);
  // `analyze` is defined below; the URL-restore effect needs it without
  // re-running whenever its identity changes.
  const analyzeRef = useRef<((input: string) => void) | null>(null);

  useEffect(() => {
    const f = () => jget<Health>("/api/health").then((h) => { setHealth(h); setLastHealthAt(Date.now()); }).catch(() => {});
    f();
    const t = setInterval(f, 10000);
    return () => clearInterval(t);
  }, []);

  // Restore a session from the URL on first load. Two forms are accepted:
  //   ?album={id}&track={id}  — an exact album workspace (internal links)
  //   ?input={spotify url}    — a fresh analysis (the in-Spotify analyzer's
  //                             "Open Full Dashboard" button)
  // Only public Spotify ids appear in the URL — never private licensor/Soundcharts UUIDs.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const album = p.get("album");
    const track = p.get("track");
    const input = p.get("input");
    if (!album && input && /^https:\/\/open\.spotify\.com\/(track|album)\/[A-Za-z0-9]{22}/.test(input)) {
      analyzeRef.current?.(input);
      return;
    }
    if (!album || !ALBUM_ID_RE.test(album)) return;
    jget<{ kind?: string; release?: AlbumRelease; error?: unknown }>(`/api/album/${album}`)
      .then((d) => {
        if (d.kind !== "album" || !d.release || !d.release.tracks.length) return;
        const initial = track && d.release.tracks.some((t) => t.spotifyTrackId === track) ? track : d.release.tracks[0].spotifyTrackId;
        setSession({ release: d.release, initialTrackId: initial, seed: null });
        setView("lookup");
      })
      .catch(() => {});
  }, []);

  /** Global analyzer — one entry point for track/album URL, ISRC, or UUID. */
  const analyze = useCallback(async (input: string) => {
    setView("lookup");
    if (!input.trim()) return;
    const steps = parseMusicLookupInput(input.trim()).type === "spotify_artist" ? ARTIST_STEPS : RELEASE_STEPS;
    setStageList(steps);
    setRunning(true); setError(null); setStep(0);
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 420);
    try {
      const r = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }) });
      const data = (await r.json()) as Record<string, unknown>;
      if (data.error) { setError((data.error as { message: string }).message); return; }

      // Artist link → the full catalogue view (a separate, heavier load).
      if (data.kind === "artist") {
        const artistId = String(data.spotifyArtistId ?? "");
        setSession(null);
        setArtist({ loading: true, data: null, error: null, fetchedAt: null, artistId });
        try {
          const cat = await jget<{ catalog?: ArtistCatalogData; fetchedAt?: string; error?: { message: string } }>(`/api/artist/${artistId}/catalog`);
          if (!cat.catalog) throw new Error(cat.error?.message ?? "Artist catalogue could not be built.");
          setArtist({ loading: false, data: cat.catalog, error: null, fetchedAt: cat.fetchedAt ?? null, artistId });
        } catch (e) {
          setArtist({ loading: false, data: null, error: (e as Error).message, fetchedAt: null, artistId });
        }
        return;
      }

      if (data.kind === "album") {
        const release = data.release as AlbumRelease;
        if (!release.tracks.length) { setError("This release has no tracks."); return; }
        setArtist(null);
        setSession({ release, initialTrackId: release.tracks[0].spotifyTrackId, seed: null });
        return;
      }

      setArtist(null);
      const ws = data as unknown as Workspace;
      if (ws.errors?.length && !ws.identity.soundchartsSongUuid && !ws.metadata.trackTitle) { setError(ws.errors[0].message); return; }
      const trackId = ws.identity.spotifyTrackId ?? ws.input.normalized;
      const albumId = ws.identity.spotifyAlbumId;
      const seed = { trackId, ws };
      if (albumId && ALBUM_ID_RE.test(albumId)) {
        try {
          const alb = await jget<{ kind?: string; release?: AlbumRelease }>(`/api/album/${albumId}`);
          if (alb.kind === "album" && alb.release && alb.release.tracks.length) {
            const initial = alb.release.tracks.some((t) => t.spotifyTrackId === trackId) ? trackId : alb.release.tracks[0].spotifyTrackId;
            setSession({ release: alb.release, initialTrackId: initial, seed });
            return;
          }
        } catch { /* fall through to a synthetic single-track release */ }
      }
      setSession({ release: synthReleaseFromWorkspace(ws), initialTrackId: trackId, seed });
    } catch (e) { setError((e as Error).message); }
    finally { clearInterval(ticker); setRunning(false); setStep(steps.length); }
  }, []);

  analyzeRef.current = analyze;

  const go = useCallback((v: View) => { setView(v); setDrawer(false); }, []);

  return (
    <TooltipProvider>
      <div className="relative min-h-screen bg-background">
        <BackgroundFX />
        <MobileNavigation open={drawer} onClose={() => setDrawer(false)} />
        <AppSidebar
          view={view}
          onNavigate={go}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          drawerOpen={drawer}
          health={health}
          lastHealthAt={lastHealthAt}
        />

        <div className={`relative flex min-h-screen flex-col ml-0 transition-[margin] duration-base ease-out ${collapsed ? "lg:ml-[72px]" : "lg:ml-[264px]"}`}>
          <TopNavigation
            view={view}
            onToggleSidebar={() => (window.innerWidth < 1024 ? setDrawer(true) : setCollapsed((c) => !c))}
            onAnalyze={analyze}
            running={running}
            health={health}
            onNavigate={go}
          />
          <PageContainer key={view}>
            {health?.spotifyCooldown?.active && <SpotifyCooldownBanner ms={health.spotifyCooldown.remainingMs} />}
            <div className="view-anim">
              {view === "lookup" && (
                <LookupView
                  session={session} artist={artist} running={running} step={step} stageList={stageList} error={error}
                  flash={flash} onAnalyze={analyze}
                  onOpenSettings={() => go("settings")} onOpenReports={() => go("reports")} onOpenHistory={() => go("history")}
                  health={health}
                />
              )}
              {view === "history" && <HistoryView onAnalyze={analyze} />}
              {view === "uuid" && <UuidDirectoryView flash={flash} />}
              {view === "distributors" && <DistributorsView flash={flash} />}
              {view === "artists" && <ArtistsView />}
              {view === "albums" && <AlbumsView onAnalyze={analyze} />}
              {view === "tracks" && <TracksView onAnalyze={analyze} />}
              {view === "analytics" && <AnalyticsView onAnalyze={analyze} />}
              {view === "reports" && <ReportsView />}
              {view === "analyzer" && <OceanAnalyzerPage />}
              {view === "status" && <SystemStatusView health={health} />}
              {view === "settings" && <SettingsView health={health} />}
            </div>
          </PageContainer>
        </div>
        {toast && <div className="toast anim-pop">{toast}</div>}
      </div>
    </TooltipProvider>
  );
}

/**
 * Spotify has locked this application's API quota. Everything that needs the
 * Web API is unavailable until it lifts — but distributor lookups read the
 * user's own Spotify client and keep working, so say both things plainly.
 */
function SpotifyCooldownBanner({ ms }: { ms: number }) {
  const min = Math.ceil(ms / 60000);
  const text = min < 60 ? `${min} minute${min === 1 ? "" : "s"}` : `${Math.floor(min / 60)}h ${min % 60}m`;
  return (
    <div className="panel anim-in" style={{ borderColor: "color-mix(in srgb, var(--warning) 35%, var(--border))", marginBottom: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span className="badge warn" style={{ flexShrink: 0 }}><span className="dot" />Spotify API paused</span>
        <div className="hint" style={{ fontSize: 12 }}>
          Spotify is rate-limiting this application for about <b>{text}</b>. Track metadata, album and artist
          catalogues are unavailable until then. Distributor lookups from your own Spotify client are unaffected,
          and the right-click panel inside Spotify keeps working.
        </div>
      </div>
    </div>
  );
}

/** The Dashboard view: landing hero (no session) or the release workspace. */
function LookupView({ session, artist, running, step, stageList, error, flash, onAnalyze, onOpenSettings, onOpenReports, onOpenHistory, health }: {
  session: Session | null;
  artist: { loading: boolean; data: ArtistCatalogData | null; error: string | null; fetchedAt: string | null; artistId: string | null } | null;
  running: boolean; step: number; stageList: string[]; error: string | null;
  flash: (m: string) => void; onAnalyze: (input: string) => void; onOpenSettings: () => void;
  onOpenReports: () => void; onOpenHistory: () => void; health: Health | null;
}) {
  // Artist catalogue takes over the view when an artist link was analyzed.
  if (artist) {
    if (artist.loading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      );
    }
    if (artist.error || !artist.data) {
      return (
        <ErrorState
          title="Artist catalogue unavailable"
          message={artist.error ?? "The catalogue could not be built."}
          onRetry={artist.artistId ? () => onAnalyze(`https://open.spotify.com/artist/${artist.artistId}`) : undefined}
          className="mx-auto mt-10 max-w-lg"
        />
      );
    }
    return (
      <div className="space-y-6">
        <CatalogDashboard
          data={artist.data}
          fetchedAt={artist.fetchedAt}
          onReanalyze={() => onAnalyze(artist.data!.spotifyUrl)}
          onExport={onOpenReports}
          onOpenHistory={onOpenHistory}
        />
        <ArtistCatalogWorkspace data={artist.data} flash={flash} onAnalyze={onAnalyze} onOpenSettings={onOpenSettings} />
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <div className="mx-auto max-w-2xl pb-2 pt-10 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Discover the distributor behind any Spotify release.</h1>
          <p className="mx-auto mt-2 max-w-lg text-sm text-foreground-secondary">
            Paste an artist, album, or track URL to analyze catalog ownership, metadata, identifiers, and distributor history.
          </p>
        </div>
        <div className="mx-auto max-w-2xl">
          <SpotifyUrlInput variant="hero" onAnalyze={onAnalyze} running={running} />
          {error && !running && <p className="mt-3 text-center text-sm text-danger">{error}</p>}
          {!running && (
            <p className="mt-2 text-center text-[11.5px] text-foreground-muted">
              Supported: Spotify track / album / artist URL · Spotify URI · ISRC · UPC · Soundcharts song UUID
            </p>
          )}
        </div>
        {running ? (
          <div className="mx-auto mt-8 max-w-2xl">
            <AnalysisProgress stages={stageList} currentStep={step} />
          </div>
        ) : (
          <LandingStatus health={health} />
        )}
      </>
    );
  }
  return (
    <>
      {error && <div className="hint anim-in" style={{ color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
      {running && (
        <div className="row anim-in" style={{ marginBottom: 12, gap: 8 }}>
          <span className="spin" aria-hidden /><span className="hint">{stageList[Math.min(step, stageList.length - 1)]}…</span>
        </div>
      )}
      <ReleaseWorkspace key={session.release.spotifyAlbumId || session.initialTrackId} session={session} flash={flash} onOpenSettings={onOpenSettings} />
    </>
  );
}

/** Honest, compact landing status — real health + connector state, no fake KPIs. */
function LandingStatus({ health }: { health: Health | null }) {
  const [connLabel, setConnLabel] = useState<{ cls: string; label: string }>({ cls: "muted", label: "Checking…" });
  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      import("./lib/connector").then(({ queryConnectorState }) =>
        queryConnectorState().then((c) => {
          if (cancelled) return;
          setConnLabel(
            c.connected || c.bridge.debuggable ? { cls: "ok", label: "Online" }
            : c.bridge.desktopAlive ? { cls: "warn", label: c.bridge.spotifyRunning ? "Link inactive" : "Spotify closed" }
            : c.paired ? { cls: "warn", label: "Offline" }
            : { cls: "muted", label: "Not paired" }
          );
        }).catch(() => { if (!cancelled) setConnLabel({ cls: "muted", label: "Not detected" }); })
      );
    tick();
    const t = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  const st = overallStatus(health);
  void st;
  return (
    <div className="cards anim-in" style={{ gridTemplateColumns: "repeat(3,1fr)", maxWidth: 720, margin: "18px auto 0" }}>
      <div className="card"><div className="card-label">Distributor mapping</div><div style={{ fontSize: 22, fontWeight: 680, marginTop: 6 }}>{health?.uuidMappingCount ?? "—"}</div><div className="hint" style={{ fontSize: 12 }}>canonical UUID records</div></div>
      <div className="card"><div className="card-label">Lookup service</div><div style={{ marginTop: 8 }}><span className={`badge ${health?.primaryLookupReady ? "ok" : "muted"}`}><span className="dot" />{health?.primaryLookupReady ? "Operational" : "Not configured"}</span></div><div className="hint" style={{ fontSize: 12, marginTop: 6 }}>track metadata &amp; analytics</div></div>
      <div className="card"><div className="card-label">Spotify connector</div><div style={{ marginTop: 8 }}><span className={`badge ${connLabel.cls}`}><span className="dot" />{connLabel.label}</span></div><div className="hint" style={{ fontSize: 12, marginTop: 6 }}>resolves the distributor</div></div>
    </div>
  );
}
