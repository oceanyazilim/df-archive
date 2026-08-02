"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, ScanSearch, Copy } from "lucide-react";
import type { ReleaseRow, Resolved } from "../../lib/hooks/useArtistCatalog";
import type { AlbumRelease } from "../../lib/types";
import { fmtDate, NA } from "../../lib/types";
import { Drawer } from "../shared/Drawer";
import { Button } from "../shared/Button";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { CopyButton } from "../shared/CopyButton";
import { Skeleton } from "../shared/Skeleton";
import { DistributorBadge } from "../distributor/DistributorBadge";
import { DistributorNotFoundState } from "../distributor/DistributorNotFoundState";
import { TrackList } from "./TrackList";
import { exportReleaseJson } from "./exportUtils";
import type { AnalyzerTarget } from "../analyzer-details/OceanAnalyzerPage";

const TYPE_LABEL: Record<string, string> = { album: "Album", single: "Single", compilation: "Compilation", appears_on: "Appears On" };

export interface ReleaseDetailsDrawerProps {
  release: ReleaseRow | null;
  resolved: Record<string, Resolved>;
  onClose: () => void;
  onOpenAnalyzer: (target: AnalyzerTarget) => void;
  onAnalyze: (input: string) => void;
  flash: (m: string) => void;
}

export function ReleaseDetailsDrawer({ release, resolved, onClose, onOpenAnalyzer, onAnalyze, flash }: ReleaseDetailsDrawerProps) {
  const [full, setFull] = useState<AlbumRelease | null>(null);
  const [loading, setLoading] = useState(false);
  const isRealAlbum = !!release?.albumId && !release.albumId.startsWith("__no-album-");

  useEffect(() => {
    setFull(null);
    if (!release || !isRealAlbum) return;
    setLoading(true);
    fetch(`/api/album/${release.albumId}`)
      .then((r) => r.json())
      .then((d) => setFull(d?.kind === "album" ? d.release : null))
      .catch(() => setFull(null))
      .finally(() => setLoading(false));
  }, [release, isRealAlbum]);

  const resolvedByTrackId = useMemo(() => {
    const map: Record<string, Resolved | undefined> = {};
    if (release) for (const t of release.tracks) if (t.spotifyTrackId) map[t.spotifyTrackId] = resolved[t.key];
    return map;
  }, [release, resolved]);

  // Distinguish "hasn't been resolved yet" from "resolved and genuinely came back empty" —
  // only the latter is a real Distributor-Not-Found state, never claimed prematurely.
  const attemptedAll = release ? release.tracks.every((t) => {
    const s = resolved[t.key]?.status;
    return s === "done" || s === "failed";
  }) : false;
  const genuinelyNotFound = release ? attemptedAll && release.distributors.length === 0 && release.tracks.some((t) => t.spotifyTrackId) : false;

  const warnings = useMemo(() => {
    if (!release) return [];
    const out: string[] = [];
    if (release.distributors.length > 1) out.push(`Conflicting distributors across tracks: ${release.distributors.join(", ")}`);
    if (!release.upc) out.push("Missing UPC for this release");
    const missingIsrc = release.tracks.filter((t) => !t.isrc).length;
    if (missingIsrc > 0) out.push(`${missingIsrc} track${missingIsrc > 1 ? "s" : ""} missing ISRC`);
    return out;
  }, [release]);

  if (!release) return null;

  const artworkUrl = full?.artworkUrl ?? null;
  const spotifyUrl = isRealAlbum ? `https://open.spotify.com/album/${release.albumId}` : null;
  const trackListSource = full?.tracks.length
    ? full.tracks.map((t) => ({ key: t.spotifyTrackId, spotifyTrackId: t.spotifyTrackId, openId: t.spotifyTrackId, trackNumber: t.trackNumber, title: t.title, durationMs: t.durationMs, isrc: t.isrc, explicit: t.explicit }))
    : release.tracks.map((t, i) => ({
        key: t.spotifyTrackId ?? t.soundchartsSongUuid ?? `row-${i}`,
        spotifyTrackId: t.spotifyTrackId,
        // Removed-from-profile tracks have no Spotify id — fall back to the Soundcharts uuid so they stay openable.
        openId: t.spotifyTrackId ?? t.soundchartsSongUuid,
        trackNumber: t.trackNumber ?? i + 1,
        title: t.title,
        durationMs: t.durationMs,
        isrc: t.isrc,
        explicit: t.explicit ?? false,
      }));

  return (
    <Drawer
      open={!!release}
      onOpenChange={(open) => !open && onClose()}
      title={release.title}
      subtitle={release.artists.join(", ")}
      width={540}
    >
      <div className="space-y-5">
        <div className="flex gap-4">
          {loading ? <Skeleton className="size-24 shrink-0 rounded-lg" /> : <ArtworkThumb src={artworkUrl} alt={release.title} size={96} rounded="lg" />}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-base font-semibold text-foreground">{release.title}</p>
            <p className="truncate text-sm text-foreground-secondary">{release.artists.join(", ") || NA}</p>
            <p className="text-xs text-foreground-muted">
              {TYPE_LABEL[release.releaseType ?? ""] ?? "Unknown"} · {fmtDate(release.releaseDate)} · {release.trackCount} track{release.trackCount === 1 ? "" : "s"}
            </p>
            {spotifyUrl && (
              <a href={spotifyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                Open on Spotify <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
        </div>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Distributor Detection</h4>
          {genuinelyNotFound ? (
            <DistributorNotFoundState
              licensorUuid={null}
              spotifyAlbumId={isRealAlbum ? release.albumId : null}
              releaseTitle={release.title}
              artists={release.artists}
            />
          ) : (
            <div className="rounded-md border border-border-strong bg-card p-3">
              <DistributorBadge distributors={release.distributors} />
              <p className="mt-2 text-[11.5px] text-foreground-muted">
                {release.distributors.length > 1
                  ? "This release's tracks resolved to more than one distributor — a real conflict, not a display error."
                  : release.distributors.length === 1
                  ? "Resolved via exact licensor-UUID match through the Spotify connector."
                  : "Not yet resolved. Use “Resolve distributors” on the release table, or open a track below."}
              </p>
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Identifiers</h4>
          <div className="divide-y divide-border-subtle rounded-md border border-border-strong bg-card px-3">
            <IdRow label="UPC" value={full?.upc ?? release.upc} />
            <IdRow label="Spotify Album ID" value={isRealAlbum ? release.albumId : null} />
            <IdRow label="Label" value={full?.label ?? null} />
            <IdRow label="Total tracks" value={full ? `${full.totalTracks}` : `${release.trackCount}`} />
          </div>
        </section>

        {warnings.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Metadata Warnings</h4>
            <div className="space-y-1.5">
              {warnings.map((w) => (
                <div key={w} className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[12.5px] text-foreground-secondary">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  {w}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Tracks</h4>
          {loading ? <Skeleton className="h-40 w-full" /> : <TrackList tracks={trackListSource} resolvedByTrackId={resolvedByTrackId} onOpenTrack={onAnalyze} />}
        </section>

        <section className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
          {isRealAlbum && (
            <Button variant="secondary" size="sm" icon={<ScanSearch className="size-3.5" aria-hidden />} onClick={() => onOpenAnalyzer({ kind: "album", id: release.albumId })}>
              Open Ocean Analyzer
            </Button>
          )}
          <Button
            variant="secondary" size="sm" icon={<Copy className="size-3.5" aria-hidden />}
            onClick={() => {
              const summary = `${release.title} — ${release.artists.join(", ")}\nUPC: ${full?.upc ?? release.upc ?? NA}\nDistributor: ${release.distributors.join(", ") || "Unresolved"}`;
              navigator.clipboard.writeText(summary).then(() => flash("Copied metadata")).catch(() => {});
            }}
          >
            Copy metadata
          </Button>
          <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={() => exportReleaseJson(full ?? release, release.albumId)}>
            Export release
          </Button>
        </section>
      </div>
    </Drawer>
  );
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs text-foreground-muted">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-mono text-[12px] text-foreground">
        {value ?? NA}
        {value && <CopyButton value={value} label="" />}
      </span>
    </div>
  );
}
