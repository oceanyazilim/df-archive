import { Loader2 } from "lucide-react";
import type { Resolved } from "../../lib/hooks/useArtistCatalog";
import { dur, NA } from "../../lib/types";
import { CopyButton } from "../shared/CopyButton";
import { DistributorBadge } from "../distributor/DistributorBadge";
import { cn } from "../../lib/cn";

export interface TrackListEntry {
  spotifyTrackId: string;
  trackNumber: number;
  title: string;
  durationMs: number | null;
  isrc: string | null;
  explicit: boolean;
}

export function TrackList({ tracks, resolvedByTrackId }: { tracks: TrackListEntry[]; resolvedByTrackId: Record<string, Resolved | undefined> }) {
  if (tracks.length === 0) return <p className="text-xs text-foreground-muted">No tracks available.</p>;
  return (
    <div className="divide-y divide-border-subtle">
      {tracks.map((t) => {
        const r = resolvedByTrackId[t.spotifyTrackId];
        return (
          <div key={t.spotifyTrackId} className="flex items-center gap-2.5 py-2">
            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-foreground-muted">{t.trackNumber}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] text-foreground">{t.title}</span>
                {t.explicit && <span className="shrink-0 rounded bg-card-elevated px-1 text-[9px] font-bold text-foreground-muted">E</span>}
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
          </div>
        );
      })}
    </div>
  );
}
