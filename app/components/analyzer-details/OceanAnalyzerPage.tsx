"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCompare, Loader2, ScanSearch, X } from "lucide-react";
import type { AnalyzerKind, AnalyzerResult } from "@core/analyzer/service";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { PageHead } from "../shared/PageHead";
import { EmptyState } from "../shared/EmptyState";
import { ErrorState } from "../shared/ErrorState";
import { Skeleton } from "../shared/Skeleton";
import { Button } from "../shared/Button";
import { StatusBadge, metadataStatusTone } from "../shared/StatusBadge";
import { CopyButton } from "../shared/CopyButton";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/Tabs";
import { SpotifyUrlInput } from "../analyzer/SpotifyUrlInput";
import { MetadataOverview } from "./MetadataOverview";
import { DetectionConfidence } from "./DetectionConfidence";
import { DistributorNotFoundState } from "../distributor/DistributorNotFoundState";
import { RawDataViewer } from "./RawDataViewer";
import { MetadataComparison } from "./MetadataComparison";
import { dur, fmtDate, NA } from "../../lib/types";
import type { HistoryItem } from "../../lib/types";
import { ApiError, describeError } from "../../lib/errorMessages";

export interface AnalyzerTarget {
  kind: AnalyzerKind;
  id: string;
  licensorUuid?: string | null;
}

const KIND_MAP: Partial<Record<ReturnType<typeof parseMusicLookupInput>["type"], AnalyzerKind>> = {
  spotify_track: "track",
  spotify_album: "album",
  spotify_artist: "artist",
};

function targetFromInput(raw: string): AnalyzerTarget | null {
  const parsed = parseMusicLookupInput(raw);
  const kind = KIND_MAP[parsed.type];
  return kind ? { kind, id: parsed.normalizedValue } : null;
}

async function fetchAnalyzer(target: AnalyzerTarget): Promise<AnalyzerResult> {
  const qs = target.licensorUuid ? `?licensorUuid=${encodeURIComponent(target.licensorUuid)}` : "";
  const r = await fetch(`/api/analyzer/${target.kind}/${target.id}${qs}`);
  const j = await r.json();
  if (j.error) throw new ApiError(j.error.message, j.error.code);
  return j.data as AnalyzerResult;
}

function useAnalyzer(target: AnalyzerTarget | null) {
  const [state, setState] = useState<{ loading: boolean; data: AnalyzerResult | null; error: ApiError | null }>({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!target) { setState({ loading: false, data: null, error: null }); return; }
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    fetchAnalyzer(target)
      .then((data) => { if (!cancelled) setState({ loading: false, data, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        setState({ loading: false, data: null, error: e instanceof ApiError ? e : new ApiError((e as Error).message) });
      });
    return () => { cancelled = true; };
  }, [target?.kind, target?.id, target?.licensorUuid]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function OceanAnalyzerPage({ initialTarget }: { initialTarget?: AnalyzerTarget | null }) {
  const [target, setTarget] = useState<AnalyzerTarget | null>(initialTarget ?? null);
  const [comparing, setComparing] = useState(false);
  const [compareTarget, setCompareTarget] = useState<AnalyzerTarget | null>(null);

  const { loading, data, error } = useAnalyzer(target);
  const compare = useAnalyzer(compareTarget);

  function handleAnalyzeUrl(input: string) {
    const t = targetFromInput(input);
    if (t) setTarget(t);
  }
  function handleCompareUrl(input: string) {
    const t = targetFromInput(input);
    if (t) setCompareTarget(t);
  }

  return (
    <div>
      <PageHead
        title="Ocean Analyzer"
        description="Deep raw and parsed metadata, distributor detection logic, and match history for a single Spotify entity."
        actions={
          data && (
            <Button variant={comparing ? "primary" : "secondary"} size="sm" icon={<GitCompare className="size-3.5" aria-hidden />} onClick={() => setComparing((c) => !c)}>
              Compare
            </Button>
          )
        }
      />

      {!target && (
        <EmptyState
          icon={<ScanSearch className="size-5" aria-hidden />}
          title="Paste a Spotify URL to open Ocean Analyzer"
          description="Track, album, or artist — see raw metadata, distributor detection, and identifiers side by side."
          action={<div className="mt-2 w-full max-w-md"><SpotifyUrlInput variant="compact" onAnalyze={handleAnalyzeUrl} running={false} /></div>}
        />
      )}

      {target && loading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {target && error && (() => {
        const d = describeError(error.code, error.message);
        return <ErrorState title={d.title} message={d.message} technicalDetail={error.code} onRetry={d.retryable ? () => setTarget({ ...target }) : undefined} className="mt-6" />;
      })()}

      {target && data && (
        <div className="space-y-5">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
              <TabsTrigger value="tracks">Tracks</TabsTrigger>
              <TabsTrigger value="distributor">Distributor</TabsTrigger>
              <TabsTrigger value="matches">Matches</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="raw">Raw Data</TabsTrigger>
            </TabsList>

            <TabsContent value="overview"><MetadataOverview result={data} /></TabsContent>
            <TabsContent value="metadata"><MetadataTab result={data} /></TabsContent>
            <TabsContent value="tracks"><TracksTab result={data} /></TabsContent>
            <TabsContent value="distributor"><DistributorTab result={data} /></TabsContent>
            <TabsContent value="matches"><MatchesTab result={data} /></TabsContent>
            <TabsContent value="history"><HistoryTab result={data} /></TabsContent>
            <TabsContent value="raw"><RawDataViewer data={data} /></TabsContent>
          </Tabs>

          {comparing && (
            <div className="rounded-lg border border-border-strong bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Compare against another URL</p>
                <button onClick={() => { setComparing(false); setCompareTarget(null); }} aria-label="Close comparison" className="text-foreground-muted hover:text-foreground">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <SpotifyUrlInput variant="compact" onAnalyze={handleCompareUrl} running={compare.loading} />
              {compare.loading && <div className="mt-4 flex items-center gap-2 text-sm text-foreground-secondary"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</div>}
              {compare.error && <p className="mt-3 text-sm text-danger">{compare.error.message}</p>}
              {compare.data && (
                <div className="mt-4">
                  <MetadataComparison a={data} b={compare.data} labelA="Current" labelB="Compared" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetadataTab({ result }: { result: AnalyzerResult }) {
  const rows: { label: string; value: string }[] = [];
  if (result.kind === "track") {
    rows.push(
      { label: "Spotify track ID", value: result.spotifyTrackId },
      { label: "Album ID", value: result.albumId ?? NA },
      { label: "ISRC", value: result.isrc ?? NA },
      { label: "UPC", value: result.upc ?? NA },
      { label: "Label", value: result.label ?? NA },
      { label: "Copyright", value: result.copyrights.join(" · ") || NA },
      { label: "Soundcharts song UUID", value: result.soundchartsSongUuid ?? NA },
    );
  } else if (result.kind === "album") {
    rows.push(
      { label: "Spotify album ID", value: result.spotifyAlbumId },
      { label: "UPC", value: result.upc ?? NA },
      { label: "Label", value: result.label ?? NA },
      { label: "Copyright", value: result.copyrights.join(" · ") || NA },
    );
  } else if (result.kind === "artist") {
    rows.push(
      { label: "Spotify artist ID", value: result.spotifyArtistId },
      { label: "Genres", value: result.genres.join(", ") || NA },
    );
  } else {
    rows.push(
      { label: "Spotify playlist ID", value: result.spotifyPlaylistId },
      { label: "Owner", value: result.owner ?? NA },
      { label: "Description", value: result.description ?? NA },
    );
  }
  return (
    <div className="rounded-lg border border-border-strong bg-card p-4 sm:p-5">
      <div className="divide-y divide-border-subtle">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-xs text-foreground-muted">{r.label}</span>
            <span className="flex items-center gap-1.5 text-right font-mono text-[12.5px] text-foreground">
              {r.value}
              {r.value !== NA && <CopyButton value={r.value} label="" />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TracksTab({ result }: { result: AnalyzerResult }) {
  const rows = useMemo(() => {
    if (result.kind === "album") return result.tracks.map((t) => ({ n: t.trackNumber, title: t.title, artists: t.artists.join(", "), dur: dur(t.durationMs), isrc: t.isrc, explicit: t.explicit }));
    if (result.kind === "artist") return result.topTracks.map((t, i) => ({ n: i + 1, title: t.title, artists: t.albumTitle ?? "", dur: dur(t.durationMs), isrc: null, explicit: null }));
    if (result.kind === "playlist") return result.tracks.map((t, i) => ({ n: i + 1, title: t.title, artists: t.artists.join(", "), dur: dur(t.durationMs), isrc: null, explicit: null }));
    return null;
  }, [result]);

  if (!rows) return <EmptyState title="Single-track analysis" description="This is an individual track — there's no tracklist to show." />;
  if (rows.length === 0) return <EmptyState title="No tracks available" />;

  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-card">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
            <th className="w-10 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Artists</th>
            <th className="px-3 py-2 text-right font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">ISRC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
              <td className="px-3 py-2 tabular-nums text-foreground-muted">{t.n}</td>
              <td className="px-3 py-2 text-foreground">
                {t.title}{t.explicit && <span className="ml-1.5 rounded bg-card-elevated px-1 text-[9px] font-bold text-foreground-muted">E</span>}
              </td>
              <td className="px-3 py-2 text-foreground-secondary">{t.artists || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground-secondary">{t.dur ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-foreground-muted">{t.isrc ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributorTab({ result }: { result: AnalyzerResult }) {
  if (result.kind !== "track") {
    return <EmptyState title="Distributor detection is per track" description="This app resolves distributors from an exact licensor-UUID match on individual tracks. Open a specific track to see detection results." />;
  }
  const notFound = result.distributor.status === "uuid_not_mapped" || result.distributor.status === "uuid_unavailable" || result.distributor.status === "invalid_uuid";
  return (
    <div className="space-y-4">
      <DetectionConfidence distributor={result.distributor} />
      {notFound && (
        <DistributorNotFoundState
          licensorUuid={result.distributor.licensorUuid}
          spotifyTrackId={result.spotifyTrackId}
          spotifyAlbumId={result.albumId}
          trackTitle={result.title}
          artists={result.artists.map((a) => a.name)}
        />
      )}
    </div>
  );
}

function MatchesTab({ result }: { result: AnalyzerResult }) {
  if (result.kind !== "track" || !result.distributor.licensorUuid) {
    return <EmptyState title="No match data yet" description="Matches (UUID lookups, aliases) become available once a licensor UUID has been captured for a track." />;
  }
  return (
    <div className="rounded-lg border border-border-strong bg-card p-4 sm:p-5">
      <p className="text-xs text-foreground-muted">Match method</p>
      <p className="mt-1 text-sm text-foreground">Exact match against the canonical licensor-UUID mapping (<code className="font-mono text-[11.5px]">json/uuid&apos;s.json</code>). No fuzzy matching, label text, or ISRC/UPC prefixes are used.</p>
      <div className="mt-4 flex items-center gap-2">
        <code className="rounded bg-input px-2 py-1 font-mono text-[11px] text-foreground-secondary">{result.distributor.licensorUuid}</code>
        <CopyButton value={result.distributor.licensorUuid} label="" />
      </div>
    </div>
  );
}

function HistoryTab({ result }: { result: AnalyzerResult }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const id = result.kind === "track" ? result.spotifyTrackId : result.kind === "album" ? result.spotifyAlbumId : null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/history?limit=200")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setItems(Array.isArray(d.items) ? d.items : []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const matches = useMemo(() => {
    if (!items || !id) return [];
    return items.filter((it) => it.spotifyTrackId === id || it.spotifyAlbumId === id);
  }, [items, id]);

  if (!id) return <EmptyState title="History is tracked per track or release" description="This entity type doesn't have per-analysis history." />;
  if (items === null) return <Skeleton className="h-32 w-full" />;
  if (matches.length === 0) return <EmptyState title="No prior analyses" description="This entity hasn't been analyzed before on this workspace." />;

  return (
    <div className="space-y-0.5">
      {matches.map((it, i) => (
        <div key={it.id ?? i} className="flex items-center justify-between gap-3 rounded-sm border border-border-subtle bg-card px-3 py-2.5 text-[13px]">
          <div className="flex min-w-0 items-center gap-2.5">
            <ArtworkThumb src={it.artworkUrl} alt="" size={28} />
            <span className="truncate text-foreground-secondary">{fmtDate(it.at)}</span>
          </div>
          <StatusBadge tone={metadataStatusTone(it.resolutionStatus)}>{it.resolutionStatus}</StatusBadge>
        </div>
      ))}
    </div>
  );
}
