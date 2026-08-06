"use client";

/** Compact "pick up where you left off" list for the empty dashboard. */

import { ArrowUpRight, Clock, Disc3, History, ListMusic, Music2, Users } from "lucide-react";
import { Panel } from "../shared/Card";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { RETENTION_LABEL, useRecentAnalyses, type RecentKind } from "../../lib/localHistory";

const KIND_ICON: Record<RecentKind, typeof Music2> = {
  track: Music2, album: Disc3, artist: Users, playlist: ListMusic, unknown: History,
};

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RecentAnalysesCard({ onAnalyze, onOpenAll, className }: {
  onAnalyze: (input: string) => void;
  onOpenAll: () => void;
  className?: string;
}) {
  const { items } = useRecentAnalyses();
  if (items.length === 0) return null;

  return (
    <Panel
      title="Recent analyses"
      description={`Kept for ${RETENTION_LABEL} on this computer.`}
      className={className}
      actions={
        <button onClick={onOpenAll} className="text-[12px] text-accent transition-colors hover:underline">
          See all
        </button>
      }
    >
      <div className="divide-y divide-border-subtle">
        {items.slice(0, 5).map((e) => {
          const Icon = KIND_ICON[e.kind];
          return (
            <button
              key={e.id}
              onClick={() => onAnalyze(e.input)}
              className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors"
            >
              <ArtworkThumb src={e.artworkUrl} alt={e.title ?? "Analysis"} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                  <span className="truncate text-[13px] text-foreground group-hover:text-accent">{e.title ?? e.input}</span>
                </div>
                <div className="truncate text-[11.5px] text-foreground-muted">
                  {e.subtitle ? `${e.subtitle} · ` : ""}{e.distributor ?? "no distributor resolved"}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted">
                <Clock className="size-3" aria-hidden /> {ago(e.at)}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
