"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Search, Trash2 } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { EmptyState } from "../shared/EmptyState";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Skeleton } from "../shared/Skeleton";
import { Button } from "../shared/Button";
import { StatusBadge, metadataStatusTone } from "../shared/StatusBadge";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { AdminOnlyView } from "../shared/AdminOnlyView";
import { useIsAdmin } from "../providers/AdminProvider";
import { HistoryItem, jget, fmtDate } from "../../lib/types";

const STATUS_OPTIONS = ["all", "verified", "unresolved", "conflict"];

/** Recent Analyses — real lookup history only. Reopens cached results without re-running the analysis. */
export function HistoryView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const isAdmin = useIsAdmin();

  const load = useCallback(() => jget<{ items: HistoryItem[] }>("/api/history").then((d) => setItems(d.items)).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);

  const filtered = (items ?? []).filter((h) => {
    if (status !== "all" && h.resolutionStatus !== status) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (h.trackTitle ?? "").toLowerCase().includes(s) || (h.artists ?? []).join(" ").toLowerCase().includes(s) || (h.distributor ?? "").toLowerCase().includes(s) || (h.isrc ?? "").toLowerCase().includes(s);
  });

  async function clearHistory() {
    setClearing(true);
    await fetch("/api/history", { method: "DELETE" });
    setClearing(false);
    setConfirmClear(false);
    load();
  }

  if (!isAdmin) return <AdminOnlyView title="Recent Analyses" />;

  return (
    <div>
      <PageHead
        title="Recent Analyses"
        description="Previously analyzed tracks. No credentials or private responses are stored."
        actions={
          <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setConfirmClear(true)} disabled={!items?.length}>
            Clear history
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 max-w-sm flex-1 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search track, artist, distributor, ISRC…" className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted" />
        </div>
        <div className="flex gap-0.5 rounded-md border border-border-strong bg-card-elevated p-0.5">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors ${status === s ? "bg-card-hover text-foreground" : "text-foreground-muted hover:text-foreground-secondary"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {!items ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<History className="size-5" aria-hidden />} title={q || status !== "all" ? "No matches" : "No lookups yet"} description={q || status !== "all" ? "Try a different search or filter." : "Analyze a track from the search bar above — every analysis lands here."} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-strong">
          <table className="w-full text-[13px]">
            <thead className="bg-card-elevated">
              <tr className="border-b border-border-subtle text-left text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                <th className="w-12 px-3 py-2.5" />
                <th className="px-3 py-2.5">Track</th>
                <th className="px-3 py-2.5">Artist</th>
                <th className="px-3 py-2.5">ISRC</th>
                <th className="px-3 py-2.5">Distributor</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Analyzed</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((h, i) => (
                <tr key={h.id ?? i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                  <td className="px-3 py-2"><ArtworkThumb src={h.artworkUrl} alt={h.trackTitle ?? "artwork"} size={32} /></td>
                  <td className="px-3 py-2 font-medium text-foreground">{h.trackTitle ?? h.input.slice(0, 24)}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{(h.artists ?? []).join(", ") || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground-muted">{h.isrc ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{h.distributor ?? "—"}</td>
                  <td className="px-3 py-2"><StatusBadge tone={metadataStatusTone(h.resolutionStatus)}>{h.resolutionStatus}</StatusBadge></td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground-muted">{fmtDate(h.at)}</td>
                  <td className="px-3 py-2"><Button variant="secondary" size="sm" onClick={() => onAnalyze(h.spotifyTrackId ?? h.input)}>Re-analyze</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all history?"
        description="This permanently removes every recorded analysis from this workspace. It can't be undone."
        confirmLabel="Clear history"
        destructive
        loading={clearing}
        onConfirm={clearHistory}
      />
    </div>
  );
}
