"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppSidebar } from "./components/layout/AppSidebar";
import { TopNavigation } from "./components/layout/TopNavigation";
import { MobileNavigation } from "./components/layout/MobileNavigation";
import { PageContainer } from "./components/layout/PageContainer";
import { NavigationTransitionProvider, useNavigationTransition } from "./components/providers/NavigationTransitionProvider";
import { AdminProvider, useAdmin } from "./components/providers/AdminProvider";
import { AdminLoginDialog } from "./components/shared/AdminLoginDialog";
import { ActivationScreen } from "./components/license/ActivationScreen";
import { WelcomeScreen } from "./components/dashboard/WelcomeScreen";
import { VipDialog } from "./components/shared/VipDialog";
import { recordAnalysis } from "./lib/localHistory";
import { useAnalysisNav } from "./lib/analysisNav";
import { useLicense } from "./lib/license";
import { ADMIN_ONLY_VIEWS, VIEW_TITLE, VIP_VIEWS } from "./components/layout/nav-config";
import { FullscreenLoaderOverlay } from "./components/loaders/FullscreenLoaderOverlay";

const INIT_SUBSTATUSES = ["Preparing workspace", "Loading interface", "Connecting services", "Preparing analyzer"];
import { motion, MotionConfig } from "framer-motion";
import { TooltipProvider } from "./components/shared/Tooltip";
import { Skeleton } from "./components/shared/Skeleton";
import { ErrorState } from "./components/shared/ErrorState";
import { SpotifyUrlInput } from "./components/analyzer/SpotifyUrlInput";
import { LazyOcean3DLoader as Ocean3DLoader } from "./components/loaders/LazyOcean3DLoader";
import { ArtistWorkspace } from "./components/dashboard/ArtistWorkspace";
import { PlaylistWorkspace } from "./components/dashboard/PlaylistWorkspace";
import { OceanAnalyzerPage, type AnalyzerTarget } from "./components/analyzer-details/OceanAnalyzerPage";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { describeError } from "./lib/errorMessages";
import { BackgroundFX } from "./components/BackgroundFX";
import { ReleaseWorkspace, Session } from "./components/LookupWorkspace";
import type { ArtistCatalogData, PlaylistCatalogData } from "./components/ArtistCatalog";
import { HistoryView } from "./components/views/HistoryView";
import { CustomerAnalyticsView, CustomerHistoryView } from "./components/views/CustomerHistoryView";
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
import { RecentAnalysesCard } from "./components/dashboard/RecentAnalysesCard";
import { ANALYSIS_SEQUENCE, getAnalysisStatusConfig, stageBandProgress, type AnalysisKind, type AnalysisStatus } from "./lib/analysisState";

/** Loaded artist / playlist catalogue state, shared with the nav stack. */
type ArtistState = { loading: boolean; data: ArtistCatalogData | null; error: string | null; fetchedAt: string | null; artistId: string | null };
type PlaylistState = { loading: boolean; data: PlaylistCatalogData | null; error: string | null; fetchedAt: string | null; playlistId: string | null };

export default function Page() {
  return (
    <AdminProvider>
      <NavigationTransitionProvider>
        <LicenseGate>
          <PageInner />
        </LicenseGate>
      </NavigationTransitionProvider>
    </AdminProvider>
  );
}

/**
 * Nothing renders until the license is confirmed. The API routes enforce the
 * same rule server-side, so this is about telling the user what to do — not
 * about keeping them out.
 */
function LicenseGate({ children }: { children: React.ReactNode }) {
  const { status, checking, refresh } = useLicense();
  if (checking && !status) {
    return <div className="grid min-h-screen place-items-center bg-background text-[13px] text-foreground-muted">Checking license…</div>;
  }
  if (status && !status.licensed) {
    return <ActivationScreen status={status} onActivated={() => refresh(true)} />;
  }
  return <>{children}</>;
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
  const [artist, setArtist] = useState<ArtistState | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistState | null>(null);
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
  // Artist analysis is admin-only. The ref keeps `analyze` (deps: []) reading
  // the live value; the server enforces the same gate on the API.
  const { isAdmin } = useAdmin();
  const isAdminRef = useRef(false);
  isAdminRef.current = isAdmin;
  const [adminGate, setAdminGate] = useState(false);
  const [vipFeature, setVipFeature] = useState<string | null>(null);
  // The greeting is the customer entry point; the workspace opens after the
  // first analysis, or when they skip it.
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const nav = useAnalysisNav<Session, ArtistState, PlaylistState>();

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

  /**
   * Record a finished analysis: it becomes a step in the session's
   * back/forward stack and an entry in the customer's 7-day history.
   */
  const commitAnalysis = useCallback((
    input: string,
    label: string,
    snapshot: { session: Session | null; artist: ArtistState | null; playlist: PlaylistState | null },
    meta: { kind: "track" | "album" | "artist" | "playlist" | "unknown"; subtitle?: string | null; artworkUrl?: string | null; distributor?: string | null; ok?: boolean }
  ) => {
    nav.push({ input, label, ...snapshot });
    recordAnalysis({
      input,
      kind: meta.kind,
      title: label,
      subtitle: meta.subtitle ?? null,
      artworkUrl: meta.artworkUrl ?? null,
      distributor: meta.distributor ?? null,
      ok: meta.ok !== false,
    });
  }, [nav]);

  /** Global analyzer — one entry point for track/album URL, ISRC, or UUID. */
  const analyze = useCallback(async (input: string) => {
    setView("lookup");
    setWorkspaceOpen(true);
    if (!input.trim()) return;
    const parsed = parseMusicLookupInput(input.trim());
    const kind: AnalysisKind = parsed.type === "spotify_artist" || parsed.type === "spotify_playlist" ? "artist" : "release";
    const seq = ANALYSIS_SEQUENCE[kind];
    setAnalysisKind(kind);
    setRunning(true); setError(null); setAnalysisStatus(seq[0]);
    let seqIdx = 0;
    const ticker = setInterval(() => { seqIdx = Math.min(seqIdx + 1, seq.length - 1); setAnalysisStatus(seq[seqIdx]); }, 420);
    try {
      // Playlist link → the playlist catalogue view. Admin-only like artist
      // analysis; no /api/lookup round-trip is needed.
      if (parsed.type === "spotify_playlist") {
        const playlistId = parsed.normalizedValue;
        if (!isAdminRef.current) {
          setSession(null); setArtist(null); setPlaylist(null);
          setError({ code: "ADMIN_ONLY", message: "Playlist analysis is only available to the site admin. Sign in, then run the query again." });
          setAdminGate(true);
          return;
        }
        setSession(null); setArtist(null);
        setPlaylist({ loading: true, data: null, error: null, fetchedAt: null, playlistId });
        try {
          const cat = await jget<{ catalog?: PlaylistCatalogData; fetchedAt?: string; error?: { message: string } }>(`/api/playlist/${playlistId}/catalog`);
          if (!cat.catalog) throw new Error(cat.error?.message ?? "Playlist catalogue could not be built.");
          const next = { loading: false, data: cat.catalog, error: null, fetchedAt: cat.fetchedAt ?? null, playlistId };
          setPlaylist(next);
          commitAnalysis(input, cat.catalog.name ?? "Playlist", { session: null, artist: null, playlist: next }, { kind: "playlist", subtitle: cat.catalog.owner, artworkUrl: cat.catalog.imageUrl });
          await flashSuccess(false);
        } catch (e) {
          setPlaylist({ loading: false, data: null, error: (e as Error).message, fetchedAt: null, playlistId });
        }
        return;
      }

      const r = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }) });
      const data = (await r.json()) as Record<string, unknown>;
      if (data.error) { const e = data.error as { code?: string; message: string }; setError({ code: e.code, message: e.message }); return; }

      // Artist link → the full catalogue view (a separate, heavier load).
      // Admin-only: the catalogue exposes the full removed-release history.
      if (data.kind === "artist") {
        if (!isAdminRef.current) {
          setSession(null);
          setArtist(null);
          setPlaylist(null);
          setError({ code: "ADMIN_ONLY", message: "Artist analysis is only available to the site admin. Sign in, then run the query again." });
          setAdminGate(true);
          return;
        }
        const artistId = String(data.spotifyArtistId ?? "");
        setSession(null);
        setPlaylist(null);
        setArtist({ loading: true, data: null, error: null, fetchedAt: null, artistId });
        try {
          const cat = await jget<{ catalog?: ArtistCatalogData; fetchedAt?: string; error?: { message: string } }>(`/api/artist/${artistId}/catalog`);
          if (!cat.catalog) throw new Error(cat.error?.message ?? "Artist catalogue could not be built.");
          const next = { loading: false, data: cat.catalog, error: null, fetchedAt: cat.fetchedAt ?? null, artistId };
          setArtist(next);
          commitAnalysis(input, cat.catalog.name ?? "Artist", { session: null, artist: next, playlist: null }, { kind: "artist", subtitle: `${cat.catalog.counts.total} tracks`, artworkUrl: cat.catalog.imageUrl });
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
        setPlaylist(null);
        const next = { release, initialTrackId: release.tracks[0].spotifyTrackId, seed: null };
        setSession(next);
        commitAnalysis(input, release.title, { session: next, artist: null, playlist: null }, { kind: "album", subtitle: release.artists.join(", "), artworkUrl: release.artworkUrl ?? null });
        await flashSuccess(false);
        return;
      }

      setArtist(null);
      setPlaylist(null);
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
            const next = { release: alb.release, initialTrackId: initial, seed };
            setSession(next);
            commitAnalysis(input, ws.metadata.trackTitle ?? alb.release.title, { session: next, artist: null, playlist: null }, {
              kind: "track",
              subtitle: (ws.metadata.artists ?? []).join(", ") || alb.release.artists.join(", "),
              artworkUrl: alb.release.artworkUrl ?? null,
              distributor: ws.distributor?.name ?? null,
              ok: !hadWarnings,
            });
            await flashSuccess(hadWarnings);
            return;
          }
        } catch { /* fall through to a synthetic single-track release */ }
      }
      const synth = { release: synthReleaseFromWorkspace(ws), initialTrackId: trackId, seed };
      setSession(synth);
      commitAnalysis(input, ws.metadata.trackTitle ?? "Track", { session: synth, artist: null, playlist: null }, {
        kind: "track",
        subtitle: (ws.metadata.artists ?? []).join(", "),
        artworkUrl: ws.metadata.artworkUrl ?? null,
        distributor: ws.distributor?.name ?? null,
        ok: !hadWarnings,
      });
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
  }, [commitAnalysis]);

  analyzeRef.current = analyze;

  /** Restore a stack entry — no provider calls, the snapshot is complete. */
  const applySnapshot = useCallback((e: { session: Session | null; artist: ArtistState | null; playlist: PlaylistState | null }) => {
    setView("lookup");
    setError(null);
    setSession(e.session);
    setArtist(e.artist);
    setPlaylist(e.playlist);
  }, []);

  const { beginTransition, markReady } = useNavigationTransition();
  const go = useCallback((v: View) => {
    // A customer can never land on an operator view, whatever route they take.
    if (!isAdminRef.current && ADMIN_ONLY_VIEWS.includes(v)) return;
    if (!isAdminRef.current && VIP_VIEWS.includes(v)) { setVipFeature(VIEW_TITLE[v]); return; }
    if (v !== view) beginTransition(VIEW_TITLE[v]);
    setView(v);
    setDrawer(false);
    setWorkspaceOpen(true);
  }, [view, beginTransition]);
  const openAnalyzer = useCallback((target: AnalyzerTarget) => { setAnalyzerTarget(target); go("analyzer"); }, [go]);

  // PageContainer remounts (key={view}) on every navigation — this fires once
  // the new view has painted, closing the transition loader (or canceling its
  // pending show entirely if the switch was faster than the flash-guard delay).
  useEffect(() => { markReady(); }, [view, markReady]);

  // The greeting owns the first screen for customers; admins go straight to
  // the workspace they operate all day.
  const showWelcome = !isAdmin && !workspaceOpen && !session && !artist && !playlist;
  if (appReady && showWelcome) {
    return (
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <div className="relative min-h-screen bg-background">
            <BackgroundFX />
            <WelcomeScreen onAnalyze={analyze} onSkip={() => setWorkspaceOpen(true)} running={running} />
            {error && !running && (
              <div className="pointer-events-none fixed inset-x-0 bottom-8 flex justify-center px-5">
                <div className="pointer-events-auto max-w-lg rounded-md border border-danger/30 bg-card px-4 py-3 text-[12.5px] text-foreground-secondary">
                  {describeError(error.code, error.message).message}
                </div>
              </div>
            )}
          </div>
        </TooltipProvider>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <div className="relative min-h-screen bg-background">
        <FullscreenLoaderOverlay
          visible={!appReady}
          mode="app-initialization"
          title="Virus Records is starting"
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
          onLocked={setVipFeature}
        />

        <div className={`relative flex min-h-screen flex-col ml-0 transition-[margin] duration-base ease-out ${collapsed ? "lg:ml-[72px]" : "lg:ml-[264px]"}`}>
          <TopNavigation
            view={view}
            onToggleSidebar={() => (window.innerWidth < 1024 ? setDrawer(true) : setCollapsed((c) => !c))}
            onAnalyze={analyze}
            running={running}
            health={health}
            canGoBack={nav.canGoBack}
            canGoForward={nav.canGoForward}
            onBack={() => nav.step(-1, applySnapshot)}
            onForward={() => nav.step(1, applySnapshot)}
            backLabel={nav.backLabel}
            forwardLabel={nav.forwardLabel}
            hideSearch={view === "lookup" && !session && !artist && !playlist}
          />
          <PageContainer key={view}>
            {health?.spotifyCooldown?.active && <SpotifyCooldownBanner ms={health.spotifyCooldown.remainingMs} />}
            <div className="view-anim">
              {view === "lookup" && (
                <LookupView
                  session={session} artist={artist} playlist={playlist} running={running} analysisStatus={analysisStatus} analysisKind={analysisKind} error={error}
                  flash={flash} onAnalyze={analyze}
                  onOpenSettings={() => go("settings")} onOpenReports={() => go("reports")} onOpenHistory={() => go("history")}
                  onOpenAnalyzer={openAnalyzer}
                />
              )}
              {/* Operators see every query the tool ran; customers see their own 7-day history. */}
              {view === "history" && (isAdmin ? <HistoryView onAnalyze={analyze} /> : <CustomerHistoryView onAnalyze={analyze} />)}
              {view === "uuid" && <UuidDirectoryView />}
              {view === "distributors" && <DistributorDatabasePage />}
              {view === "artists" && <ArtistsView />}
              {view === "albums" && <AlbumsView onAnalyze={analyze} />}
              {view === "tracks" && <TracksView onAnalyze={analyze} />}
              {view === "analytics" && (isAdmin ? <AnalyticsView onAnalyze={analyze} /> : <CustomerAnalyticsView onAnalyze={analyze} />)}
              {view === "reports" && <ReportsView />}
              {view === "analyzer" && <OceanAnalyzerPage initialTarget={analyzerTarget} />}
              {view === "status" && <SystemStatusView health={health} />}
              {view === "settings" && <SettingsView health={health} />}
            </div>
          </PageContainer>
        </div>
        {toast && <div className="toast anim-pop">{toast}</div>}
        <AdminLoginDialog open={adminGate} onOpenChange={setAdminGate} />
        <VipDialog open={!!vipFeature} onOpenChange={(o) => !o && setVipFeature(null)} feature={vipFeature} />
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
function LookupView({ session, artist, playlist, running, analysisStatus, analysisKind, error, flash, onAnalyze, onOpenSettings, onOpenReports, onOpenHistory, onOpenAnalyzer }: {
  session: Session | null;
  artist: { loading: boolean; data: ArtistCatalogData | null; error: string | null; fetchedAt: string | null; artistId: string | null } | null;
  playlist: { loading: boolean; data: PlaylistCatalogData | null; error: string | null; fetchedAt: string | null; playlistId: string | null } | null;
  running: boolean; analysisStatus: AnalysisStatus; analysisKind: AnalysisKind; error: { code?: string; message: string } | null;
  flash: (m: string) => void; onAnalyze: (input: string) => void; onOpenSettings: () => void;
  onOpenReports: () => void; onOpenHistory: () => void; onOpenAnalyzer: (target: AnalyzerTarget) => void;
}) {
  // Playlist catalogue takes over the view when a playlist link was analyzed.
  if (playlist) {
    if (playlist.loading) {
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
    if (playlist.error || !playlist.data) {
      return (
        <ErrorState
          title="Playlist catalogue unavailable"
          message={playlist.error ?? "The playlist could not be read."}
          onRetry={playlist.playlistId ? () => onAnalyze(`https://open.spotify.com/playlist/${playlist.playlistId}`) : undefined}
          className="mx-auto mt-10 max-w-lg"
        />
      );
    }
    return (
      <motion.div key={playlist.data.spotifyUrl} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: [0.22, 0.8, 0.36, 1] }}>
        <PlaylistWorkspace
          data={playlist.data}
          fetchedAt={playlist.fetchedAt}
          onReanalyze={() => onAnalyze(playlist.data!.spotifyUrl)}
          onOpenAnalyzer={onOpenAnalyzer}
          onAnalyze={onAnalyze}
          flash={flash}
        />
      </motion.div>
    );
  }

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
              Supported: Spotify track / album / artist / playlist URL · Spotify URI · ISRC · UPC · Soundcharts song UUID
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
          <>
            <RecentAnalysesCard className="mx-auto mt-8 max-w-2xl" onAnalyze={onAnalyze} onOpenAll={onOpenHistory} />
            <IdleHintMessage className="mx-auto mt-6 max-w-md" />
          </>
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

