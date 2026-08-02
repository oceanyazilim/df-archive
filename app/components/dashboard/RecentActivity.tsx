"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { StatusBadge, metadataStatusTone } from "../shared/StatusBadge";
import { Skeleton } from "../shared/Skeleton";
import type { HistoryItem } from "../../lib/types";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Real recent-analysis feed from /api/history — never fake e-commerce-style activity. */
export function RecentActivity({ onOpenHistory }: { onOpenHistory: () => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/history?limit=6")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setItems(Array.isArray(d.items) ? d.items : []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Panel
      title="Recent Analysis Activity"
      actions={
        <button onClick={onOpenHistory} className="text-[11.5px] font-medium text-accent hover:underline">
          View all
        </button>
      }
    >
      {items === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Activity className="size-5" aria-hidden />} title="No analyses yet" description="Analyzed URLs will show up here." />
      ) : (
        <div className="space-y-0.5">
          {items.map((it, i) => (
            <div key={it.id ?? i} className="flex items-center gap-3 rounded-sm px-1.5 py-2 text-[13px] transition-colors hover:bg-card-hover">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{it.trackTitle ?? it.albumTitle ?? it.input}</p>
                <p className="truncate text-[11.5px] text-foreground-muted">
                  {it.inputType ?? "url"} · {it.distributor ?? "Unknown distributor"}
                </p>
              </div>
              <StatusBadge tone={metadataStatusTone(it.resolutionStatus)} className="shrink-0">{it.resolutionStatus}</StatusBadge>
              <span className="shrink-0 text-[11px] text-foreground-muted">{timeAgo(it.at)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
