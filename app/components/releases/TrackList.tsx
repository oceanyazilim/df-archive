import { ExternalLink, Loader2 } from "lucide-react";
import type { Resolved } from "../../lib/hooks/useArtistCatalog";
import { dur, NA } from "../../lib/types";
import { CopyButton } from "../shared/CopyButton";
import { DistributorBadge } from "../distributor/DistributorBadge";
import { cn } from "../../lib/cn";

export interface TrackListEntry {
  /** Stable React key — a real Spotify track id, or a synthetic id when only a Soundcharts uuid exists. */
  key: string;
  trackNumber: number;
  title: string;
  durationMs: number | null;
  isrc: string | null;
  explicit: boolean;
  /** What resolvedByTrackId is keyed by (real Spotify track id only). */
  spotifyTrackId: string | null;
  /**
   * The id to pass to onOpenTrack — a track's own Spotify id when it has one,
   * otherwise its Soundcharts song uuid, so a track removed from the artist's
   * current Spotify profile (but still known to the analytics catalogue) can
   * still be opened and inspected.
   */
  openId: string | null;
}

export function TrackList({ tracks, resolvedByTrackId, onOpenTrack }: {
  tracks: TrackListEntry[];
  resolvedByTrackId: Record<string, Resolved | undefined>;
  onOpenTrack?: (id: string) => void;
}) {
  if (tracks.length === 0) return <p className="text-xs text-foreground-muted">No tracks available.</p>;
  return (
    <div className="divide-y divide-border-subtle">
      {tracks.map((t) => {
        const r = t.spotifyTrackId ? resolvedByTrackId[t.spotifyTrackId] : undefined;
        return (
          <div key={t.key} className="flex items-center gap-2.5 py-2">
            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">{t.trackNumber}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] text-foreground">{t.title}</span>
                {t.explicit && <span className="shrink-0 rounded bg-card-elevated px-1 text-[9px] font-bold text-foreground-muted">E</span>}
                {!t.spotifyTrackId && t.openId && (
                  <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning" title="Known to the analytics catalogue but no longer on the artist's Spotify profile">
                    Removed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px] text-foreground-muted">
                <span className="font-mono">{t.isrc ?? NA}</span>
                {t.isrc && <CopyButton value={t.isrc} label="" className="px-0.5" />}
              </div>
            </div>
            <span className="shrink-0 tabular-nums text-[11.5px] text-foreground-secondary">{dur(t.durationMs) ?? "—"}</span>
            <span className="shrink-0">
              {r?.status === "running" ? (
                <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
              ) : (
                <DistributorBadge distributors={r?.distributor ? [r.distributor] : []} className={cn("text-[10px]", !r?.distributor && "opacity-70")} />
              )}
            </span>
            {onOpenTrack && t.openId && (
              <button
                onClick={() => onOpenTrack(t.openId!)}
                aria-label={t.spotifyTrackId ? "Open the full track workspace" : "Open from the analytics catalogue — this track is no longer on the Spotify profile"}
                title={t.spotifyTrackId ? "Open the full track workspace" : "Open from the analytics catalogue — this track is no longer on the Spotify profile"}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-card-hover hover:text-accent"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
