"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppSidebar } from "./components/layout/AppSidebar";
import { TopNavigation } from "./components/layout/TopNavigation";
import { MobileNavigation } from "./components/layout/MobileNavigation";
import { PageContainer } from "./components/layout/PageContainer";
import { NavigationTransitionProvider, useNavigationTransition } from "./components/providers/NavigationTransitionProvider";
import { AdminProvider } from "./components/providers/AdminProvider";
import { VIEW_TITLE } from "./components/layout/nav-config";
import { FullscreenLoaderOverlay } from "./components/loaders/FullscreenLoaderOverlay";

const INIT_SUBSTATUSES = ["Preparing workspace", "Loading interface", "Connecting services", "Preparing analyzer"];
import { motion, MotionConfig } from "framer-motion";
import { TooltipProvider } from "./components/shared/Tooltip";
import { Skeleton } from "./components/shared/Skeleton";
import { ErrorState } from "./components/shared/ErrorState";
import { SpotifyUrlInput } from "./components/analyzer/SpotifyUrlInput";
import { LazyOcean3DLoader as Ocean3DLoader } from "./components/loaders/LazyOcean3DLoader";
import { ArtistWorkspace } from "./components/dashboard/ArtistWorkspace";
import { OceanAnalyzerPage, type AnalyzerTarget } from "./components/analyzer-details/OceanAnalyzerPage";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { describeError } from "./lib/errorMessages";
import { BackgroundFX } from "./components/BackgroundFX";
import { ReleaseWorkspace, Session } from "./components/LookupWorkspace";
import type { ArtistCatalogData } from "./components/ArtistCatalog";
import { HistoryView } from "./components/views/HistoryView";
import { ArtistsView, AlbumsView, TracksView } from "./components/views/catalog";
import { DistributorDatabasePage } from "./components/distributor/DistributorDatabasePage";
import { AnalyticsView } from "./components/views/AnalyticsView";
import { ReportsView } from "./components/views/ReportsView";
import { UuidDirectoryView, SystemStatusView, SettingsView } from "./components/views/system";
import { EmptyState } from "./components/ui";
import {
  View, Health, Workspace, AlbumRelease, jget,
  ALBUM_ID_RE, synthReleaseFromWorkspace,
} from "./lib/types";
import { IdleHintMessage } from "./components/dashboard/IdleHintMessage";
import { ANALYSIS_SEQUENCE, getAnalysisStatusConfig, stageBandProgress, type AnalysisKind, type AnalysisStatus } from "./lib/analysisState";

export default function Page() {
  return (
    <AdminProvider>
      <NavigationTransitionProvider>
        <PageInner />
      </NavigationTransitionProvider>
    </AdminProvider>
  );
}

function PageInner() {
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
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [analysisKind, setAnalysisKind] = useState<AnalysisKind>("release");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [analyzerTarget, setAnalyzerTarget] = useState<AnalyzerTarget | null>(null);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 1500); }, []);
  // `analyze` is defined below; the URL-restore effect needs it without
  // re-running whenever its identity changes.
  const analyzeRef = useRef<((input: string) => void) | null>(null);

  useEffect(() => {
    const f = () => jget<Health>("/api/health").then((h) => { setHealth(h); setLastHealthAt(Date.now()); setAppReady(true); }).catch(() => {});
    f();
    const t = setInterval(f, 10000);
    return () => clearInterval(t);
  }, []);

  // App-initialization gate: real (first /api/health response) or a short
  // cap, whichever comes first — never an arbitrary multi-second delay, so
  // it can't make the app feel slower than it already is.
  const [appReady, setAppReady] = useState(false);
  useEffect(() => {
    const cap = setTimeout(() => setAppReady(true), 600);
    return () => clearTimeout(cap);
  }, []);
  const [initSubstatus, setInitSubstatus] = useState(INIT_SUBSTATUSES[0]);
  useEffect(() => {
    if (appReady) return;
    let i = 0;
    const t = setInterval(() => { i = (i + 1) % INIT_SUBSTATUSES.length; setInitSubstatus(INIT_SUBSTATUSES[i]); }, 400);
    return () => clearInterval(t);
  }, [appReady]);

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
    const kind: AnalysisKind = parseMusicLookupInput(input.trim()).type === "spotify_artist" ? "artist" : "release";
    const seq = ANALYSIS_SEQUENCE[kind];
    setAnalysisKind(kind);
    setRunning(true); setError(null); setAnalysisStatus(seq[0]);
    let seqIdx = 0;
    const ticker = setInterval(() => { seqIdx = Math.min(seqIdx + 1, seq.length - 1); setAnalysisStatus(seq[seqIdx]); }, 420);
    try {
      const r = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }) });
      const data = (await r.json()) as Record<string, unknown>;
      if (data.error) { const e = data.error as { code?: string; message: string }; setError({ code: e.code, message: e.message }); return; }

      // Artist link → the full catalogue view (a separate, heavier load).
      if (data.kind === "artist") {
        const artistId = String(data.spotifyArtistId ?? "");
        setSession(null);
        setArtist({ loading: true, data: null, error: null, fetchedAt: null, artistId });
        try {
          const cat = await jget<{ catalog?: ArtistCatalogData; fetchedAt?: string; error?: { message: string } }>(`/api/artist/${artistId}/catalog`);
          if (!cat.catalog) throw new Error(cat.error?.message ?? "Artist catalogue could not be built.");
          setArtist({ loading: false, data: cat.catalog, error: null, fetchedAt: cat.fetchedAt ?? null, artistId });
          await flashSuccess(false);
        } catch (e) {
          setArtist({ loading: false, data: null, error: (e as Error).message, fetchedAt: null, artistId });
        }
        return;
      }

      if (data.kind === "album") {
        const release = data.release as AlbumRelease;
        if (!release.tracks.length) { setError({ message: "This release has no tracks." }); return; }
        setArtist(null);
        setSession({ release, initialTrackId: release.tracks[0].spotifyTrackId, seed: null });
        await flashSuccess(false);
        return;
      }

      setArtist(null);
      const ws = data as unknown as Workspace;
      if (ws.errors?.length && !ws.identity.soundchartsSongUuid && !ws.metadata.trackTitle) { setError({ code: ws.errors[0].code, message: ws.errors[0].message }); return; }
      const hadWarnings = !!ws.errors?.length;
      const trackId = ws.identity.spotifyTrackId ?? ws.input.normalized;
      const albumId = ws.identity.spotifyAlbumId;
      const seed = { trackId, ws };
      if (albumId && ALBUM_ID_RE.test(albumId)) {
        try {
          const alb = await jget<{ kind?: string; release?: AlbumRelease }>(`/api/album/${albumId}`);
          if (alb.kind === "album" && alb.release && alb.release.tracks.length) {
            const initial = alb.release.tracks.some((t) => t.spotifyTrackId === trackId) ? trackId : alb.release.tracks[0].spotifyTrackId;
            setSession({ release: alb.release, initialTrackId: initial, seed });
            await flashSuccess(hadWarnings);
            return;
          }
        } catch { /* fall through to a synthetic single-track release */ }
      }
      setSession({ release: synthReleaseFromWorkspace(ws), initialTrackId: trackId, seed });
      await flashSuccess(hadWarnings);
    } catch (e) { setError({ message: (e as Error).message }); }
    finally { clearInterval(ticker); setRunning(false); }

    // Briefly shows the success loader state (decelerating rotation, confirmation
    // ring, check icon) before the dashboard's staggered reveal takes over —
    // capped short so it never feels like it's blocking the result.
    async function flashSuccess(partial: boolean) {
      setAnalysisStatus(partial ? "partial-success" : "success");
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
  }, []);

  analyzeRef.current = analyze;

  const { beginTransition, markReady } = useNavigationTransition();
  const go = useCallback((v: View) => {
    if (v !== view) beginTransition(VIEW_TITLE[v]);
    setView(v);
    setDrawer(false);
  }, [view, beginTransition]);
  const openAnalyzer = useCallback((target: AnalyzerTarget) => { setAnalyzerTarget(target); go("analyzer"); }, [go]);

  // PageContainer remounts (key={view}) on every navigation — this fires once
  // the new view has painted, closing the transition loader (or canceling its
  // pending show entirely if the switch was faster than the flash-guard delay).
  useEffect(() => { markReady(); }, [view, markReady]);

  return (
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <div className="relative min-h-screen bg-background">
        <FullscreenLoaderOverlay
          visible={!appReady}
          mode="app-initialization"
          title="Ocean Distro Finder is starting"
          description={initSubstatus}
        />
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
          />
          <PageContainer key={view}>
            {health?.spotifyCooldown?.active && <SpotifyCooldownBanner ms={health.spotifyCooldown.remainingMs} />}
            <div className="view-anim">
              {view === "lookup" && (
                <LookupView
                  session={session} artist={artist} running={running} analysisStatus={analysisStatus} analysisKind={analysisKind} error={error}
                  flash={flash} onAnalyze={analyze}
                  onOpenSettings={() => go("settings")} onOpenReports={() => go("reports")} onOpenHistory={() => go("history")}
                  onOpenAnalyzer={openAnalyzer}
                />
              )}
              {view === "history" && <HistoryView onAnalyze={analyze} />}
              {view === "uuid" && <UuidDirectoryView />}
              {view === "distributors" && <DistributorDatabasePage />}
              {view === "artists" && <ArtistsView />}
              {view === "albums" && <AlbumsView onAnalyze={analyze} />}
              {view === "tracks" && <TracksView onAnalyze={analyze} />}
              {view === "analytics" && <AnalyticsView onAnalyze={analyze} />}
              {view === "reports" && <ReportsView />}
              {view === "analyzer" && <OceanAnalyzerPage initialTarget={analyzerTarget} />}
              {view === "status" && <SystemStatusView health={health} />}
              {view === "settings" && <SettingsView health={health} />}
            </div>
          </PageContainer>
        </div>
        {toast && <div className="toast anim-pop">{toast}</div>}
      </div>
    </TooltipProvider>
    </MotionConfig>
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
function LookupView({ session, artist, running, analysisStatus, analysisKind, error, flash, onAnalyze, onOpenSettings, onOpenReports, onOpenHistory, onOpenAnalyzer }: {
  session: Session | null;
  artist: { loading: boolean; data: ArtistCatalogData | null; error: string | null; fetchedAt: string | null; artistId: string | null } | null;
  running: boolean; analysisStatus: AnalysisStatus; analysisKind: AnalysisKind; error: { code?: string; message: string } | null;
  flash: (m: string) => void; onAnalyze: (input: string) => void; onOpenSettings: () => void;
  onOpenReports: () => void; onOpenHistory: () => void; onOpenAnalyzer: (target: AnalyzerTarget) => void;
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
      <motion.div key={artist.data.spotifyUrl} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: [0.22, 0.8, 0.36, 1] }}>
        <ArtistWorkspace
          data={artist.data}
          fetchedAt={artist.fetchedAt}
          onReanalyze={() => onAnalyze(artist.data!.spotifyUrl)}
          onExport={onOpenReports}
          onOpenHistory={onOpenHistory}
          onOpenAnalyzer={onOpenAnalyzer}
          onAnalyze={onAnalyze}
          flash={flash}
        />
      </motion.div>
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
          {error && !running && (() => {
            const d = describeError(error.code, error.message);
            return <ErrorState title={d.title} message={d.message} technicalDetail={error.code} className="mt-4" />;
          })()}
          {!running && (
            <p className="mt-2 text-center text-[11.5px] text-foreground-muted">
              Supported: Spotify track / album / artist URL · Spotify URI · ISRC · UPC · Soundcharts song UUID
            </p>
          )}
        </div>
        {running ? (
          <div className="mx-auto mt-8 max-w-2xl">
            {(() => {
              const cfg = getAnalysisStatusConfig(analysisStatus, analysisKind);
              return (
                <Ocean3DLoader
                  mode={cfg.loaderMode}
                  fullscreen={analysisKind === "artist"}
                  progress={stageBandProgress(analysisStatus, analysisKind)}
                  stage={cfg.title}
                  description={cfg.description}
                  searchSubstage={cfg.searchSubstage}
                  stages={ANALYSIS_SEQUENCE[analysisKind].map((s) => ({
                    label: getAnalysisStatusConfig(s, analysisKind).title,
                    state: s === analysisStatus ? "active" : ANALYSIS_SEQUENCE[analysisKind].indexOf(s) < ANALYSIS_SEQUENCE[analysisKind].indexOf(analysisStatus) ? "done" : "pending",
                  }))}
                />
              );
            })()}
          </div>
        ) : (
          <IdleHintMessage className="mx-auto mt-6 max-w-md" />
        )}
      </>
    );
  }
  return (
    <>
      {error && (() => {
        const d = describeError(error.code, error.message);
        return <ErrorState title={d.title} message={d.message} technicalDetail={error.code} className="mb-4" />;
      })()}
      {running && (() => {
        const cfg = getAnalysisStatusConfig(analysisStatus, analysisKind);
        return (
          <div className="mb-4">
            <Ocean3DLoader
              mode={cfg.loaderMode}
              compact
              progress={stageBandProgress(analysisStatus, analysisKind)}
              stage={cfg.title}
              searchSubstage={cfg.searchSubstage}
            />
          </div>
        );
      })()}
      <motion.div
        key={session.release.spotifyAlbumId || session.initialTrackId}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 0.8, 0.36, 1] }}
      >
        <ReleaseWorkspace session={session} flash={flash} onOpenSettings={onOpenSettings} />
      </motion.div>
    </>
  );
}

