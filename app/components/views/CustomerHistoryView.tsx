"use client";

/**
 * The customer's own analyses. Their data, their browser, gone after 7 days —
 * unlike the admin HistoryView, which is the operator's record of every query
 * the tool ever ran.
 */

import { useMemo, useState } from "react";
import { Clock, Disc3, History, ListMusic, Music2, RotateCw, Search, Trash2, Users, X } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { EmptyState } from "../shared/EmptyState";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Button } from "../shared/Button";
import { StatusBadge } from "../shared/StatusBadge";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { Panel } from "../shared/Card";
import { StatCard } from "../shared/StatCard";
import { RETENTION_LABEL, useRecentAnalyses, type RecentAnalysis, type RecentKind } from "../../lib/localHistory";

const KIND_ICON: Record<RecentKind, typeof Music2> = {
  track: Music2, album: Disc3, artist: Users, playlist: ListMusic, unknown: History,
};
const KIND_LABEL: Record<RecentKind, string> = {
  track: "Track", album: "Release", artist: "Artist", playlist: "Playlist", unknown: "Lookup",
};

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Days until this entry is deleted — the retention promise, made visible. */
function expiresIn(at: number): string {
  const days = 7 - Math.floor((Date.now() - at) / 86400000);
  return days <= 1 ? "expires today" : `${days} days left`;
}

export function CustomerHistoryView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const { items, clear, remove } = useRecentAnalyses();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | RecentKind>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((e) =>
      (kind === "all" || e.kind === kind) &&
      (!s || [e.title, e.subtitle, e.distributor, e.input].some((v) => v?.toLowerCase().includes(s)))
    );
  }, [items, q, kind]);

  return (
    <div>
      <PageHead
        title="Recent Analyses"
        description={`Everything you analyzed on this computer. Entries are deleted automatically after ${RETENTION_LABEL}.`}
        actions={
          items.length > 0 ? (
            <Button variant="secondary" size="sm" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setConfirmClear(true)}>
              Clear history
            </Button>
          ) : undefined
        }
      />

      {items.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
            <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, artist or distributor…"
              className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
            />
          </div>
          {(["all", "track", "album", "artist", "playlist"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`h-9 rounded-sm border px-3 text-[12.5px] capitalize transition-colors ${
                kind === k ? "border-accent/40 bg-accent-dim text-foreground" : "border-border-strong bg-card text-foreground-secondary hover:bg-card-hover"
              }`}
            >
              {k === "all" ? "All" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      <Panel>
        {items.length === 0 ? (
          <EmptyState
            title="Nothing analyzed yet"
            description="Paste a Spotify link in the search bar above. Your analyses show up here and stay for 7 days."
          />
        ) : shown.length === 0 ? (
          <EmptyState title="Nothing matches" description="Try a different search or filter." />
        ) : (
          <div className="divide-y divide-border-subtle">
            {shown.map((e) => <Row key={e.id} entry={e} onAnalyze={onAnalyze} onRemove={() => remove(e.id)} />)}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear your analysis history?"
        description="This removes every entry from this computer. The analyses themselves are not affected."
        confirmLabel="Clear history"
        onConfirm={() => { clear(); setConfirmClear(false); }}
      />
    </div>
  );
}

function Row({ entry, onAnalyze, onRemove }: { entry: RecentAnalysis; onAnalyze: (input: string) => void; onRemove: () => void }) {
  const Icon = KIND_ICON[entry.kind];
  return (
    <div className="group flex items-center gap-3 py-2.5">
      <ArtworkThumb src={entry.artworkUrl} alt={entry.title ?? "Analysis"} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
          <span className="truncate text-[13px] font-medium text-foreground">{entry.title ?? entry.input}</span>
          {entry.distributor && <StatusBadge tone="success">{entry.distributor}</StatusBadge>}
        </div>
        <div className="truncate text-[11.5px] text-foreground-muted">
          {entry.subtitle ? `${entry.subtitle} · ` : ""}{KIND_LABEL[entry.kind]} · {ago(entry.at)}
        </div>
      </div>
      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-foreground-muted sm:flex" title="Entries are deleted after 7 days">
        <Clock className="size-3" aria-hidden /> {expiresIn(entry.at)}
      </span>
      <Button variant="ghost" size="sm" icon={<RotateCw className="size-3.5" aria-hidden />} onClick={() => onAnalyze(entry.input)}>
        Open
      </Button>
      <button
        onClick={onRemove}
        aria-label="Remove from history"
        title="Remove from history"
        className="flex size-7 shrink-0 items-center justify-center rounded-sm text-foreground-muted opacity-0 transition-opacity hover:bg-card-hover hover:text-danger group-hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Analytics for a customer: their own activity, from the same 7-day store. */
export function CustomerAnalyticsView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const { items } = useRecentAnalyses();

  const stats = useMemo(() => {
    const byKind = { track: 0, album: 0, artist: 0, playlist: 0, unknown: 0 } as Record<RecentKind, number>;
    const distributors = new Map<string, number>();
    let last24h = 0;
    for (const e of items) {
      byKind[e.kind]++;
      if (Date.now() - e.at < 86400000) last24h++;
      if (e.distributor) distributors.set(e.distributor, (distributors.get(e.distributor) ?? 0) + 1);
    }
    return {
      byKind,
      last24h,
      distributors: [...distributors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      resolved: items.filter((e) => !!e.distributor).length,
    };
  }, [items]);

  return (
    <div>
      <PageHead
        title="Performance"
        description={`Your analysis activity on this computer. Based on the last ${RETENTION_LABEL} — older entries are deleted automatically.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Analyses" value={items.length} />
        <StatCard label="Last 24 hours" value={stats.last24h} />
        <StatCard label="Distributors found" value={stats.resolved} tone={stats.resolved > 0 ? "success" : "default"} />
        <StatCard label="Artists & playlists" value={stats.byKind.artist + stats.byKind.playlist} />
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState title="No activity yet" description="Analyze a link and your numbers appear here." />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="What you analyzed" description="Across the retention window.">
            <div className="space-y-2.5">
              {(["track", "album", "artist", "playlist"] as const).map((k) => {
                const n = stats.byKind[k];
                const pct = items.length ? Math.round((n / items.length) * 100) : 0;
                const Icon = KIND_ICON[k];
                return (
                  <div key={k}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="flex items-center gap-1.5 text-foreground-secondary">
                        <Icon className="size-3.5 text-foreground-muted" aria-hidden /> {KIND_LABEL[k]}
                      </span>
                      <span className="tabular-nums text-foreground-muted">{n}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-card-elevated">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-slow ease-out" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Distributors you met" description="Resolved from your own analyses.">
            {stats.distributors.length === 0 ? (
              <EmptyState title="No distributor resolved yet" description="Analyze a track while Spotify is connected." />
            ) : (
              <div className="divide-y divide-border-subtle">
                {stats.distributors.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between py-2 text-[13px]">
                    <span className="truncate text-foreground">{name}</span>
                    <span className="tabular-nums text-foreground-muted">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Latest" description="Reopen any of them." className="lg:col-span-2">
            <div className="divide-y divide-border-subtle">
              {items.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <ArtworkThumb src={e.artworkUrl} alt={e.title ?? "Analysis"} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-foreground">{e.title ?? e.input}</div>
                    <div className="truncate text-[11.5px] text-foreground-muted">{e.subtitle ?? KIND_LABEL[e.kind]} · {ago(e.at)}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => onAnalyze(e.input)}>Open</Button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
