"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { HistoryItem } from "../../lib/types";
import { fmtDate } from "../../lib/types";
import { Drawer } from "../shared/Drawer";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { CensoredValue } from "../shared/CensoredValue";
import { useIsAdmin } from "../providers/AdminProvider";
import { StatusBadge } from "../shared/StatusBadge";
import { Skeleton } from "../shared/Skeleton";
import type { ObservedDistributor } from "./DistributorDatabaseTable";

export function DistributorDetailsDrawer({ distributor, history, onClose }: { distributor: ObservedDistributor | null; history: HistoryItem[]; onClose: () => void }) {
  const [canonical, setCanonical] = useState<{ uuid: string; distributor: string }[] | null>(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    setCanonical(null);
    if (!distributor) return;
    fetch(`/api/distributors/search?q=${encodeURIComponent(distributor.name)}`)
      .then((r) => r.json())
      .then((d) => setCanonical(Array.isArray(d.results) ? d.results.filter((r: { distributor: string }) => r.distributor === distributor.name) : []))
      .catch(() => setCanonical([]));
  }, [distributor]);

  if (!distributor) return null;
  const matches = history.filter((h) => h.distributor === distributor.name).sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Drawer open={!!distributor} onOpenChange={(open) => !open && onClose()} title={distributor.name} subtitle={`${distributor.analyses} detections across ${distributor.trackCount} tracks`} width={500}>
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Licensor UUID(s)</h4>
          {canonical === null ? (
            <Skeleton className="h-10 w-full" />
          ) : canonical.length === 0 ? (
            <p className="text-xs text-foreground-muted">No exact-name match in the canonical mapping search (names may differ slightly, or the mapping search is bounded).</p>
          ) : (
            <div className="space-y-1.5">
              {canonical.map((c) => (
                <div key={c.uuid} className="flex items-center justify-between gap-2 rounded-md border border-border-strong bg-card px-3 py-2">
                  <CensoredValue value={c.uuid} isAdmin={isAdmin} copyLabel="" />
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Detected on ({matches.length})</h4>
          <div className="space-y-0.5">
            {matches.slice(0, 50).map((h, i) => (
              <div key={h.id ?? i} className="flex items-center gap-2.5 rounded-sm px-1.5 py-2 text-[13px] hover:bg-card-hover">
                <ArtworkThumb src={h.artworkUrl} alt="" size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{h.trackTitle ?? h.albumTitle ?? h.input}</p>
                  <p className="truncate text-[11px] text-foreground-muted">{fmtDate(h.at)}</p>
                </div>
                {h.spotifyTrackId && (
                  <a href={`https://open.spotify.com/track/${h.spotifyTrackId}`} target="_blank" rel="noreferrer" className="shrink-0 text-foreground-muted hover:text-accent">
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
            ))}
            {matches.length > 50 && <p className="pt-2 text-[11px] text-foreground-muted">Showing the 50 most recent of {matches.length}.</p>}
          </div>
        </section>

        <StatusBadge tone="info" dot={false}>Resolved via exact licensor-UUID match</StatusBadge>
      </div>
    </Drawer>
  );
}
