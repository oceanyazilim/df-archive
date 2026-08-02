"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { StatCard } from "../shared/StatCard";
import { SkeletonStatCard } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { CopyButton } from "../shared/CopyButton";
import { Panel } from "../shared/Card";
import type { HistoryItem } from "../../lib/types";
import { DistributorDatabaseTable, aggregateObservedDistributors, type ObservedDistributor } from "./DistributorDatabaseTable";
import { DistributorDetailsDrawer } from "./DistributorDetailsDrawer";

type MappingStatus = { validMappings: number; totalRecords: number; duplicateRecords: number; conflicts: number; lastLoadedAt: string | null };
type MappingHit = { uuid: string; distributor: string };
type Conflict = { uuid: string; distributors: string[] };

export function DistributorDatabasePage() {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [status, setStatus] = useState<MappingStatus | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [tableQuery, setTableQuery] = useState("");
  const [mapQuery, setMapQuery] = useState("");
  const [mapResults, setMapResults] = useState<MappingHit[] | null>(null);
  const [openDistributor, setOpenDistributor] = useState<ObservedDistributor | null>(null);

  useEffect(() => {
    fetch("/api/history?limit=500").then((r) => r.json()).then((d) => setHistory(Array.isArray(d.items) ? d.items : [])).catch(() => setHistory([]));
    fetch("/api/uuid-mapping/status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetch("/api/distributors/search?conflicts=1").then((r) => r.json()).then((d) => setConflicts(Array.isArray(d.conflicts) ? d.conflicts : [])).catch(() => {});
  }, []);

  const observed = useMemo(() => aggregateObservedDistributors(history ?? []), [history]);

  function searchMapping() {
    if (!mapQuery.trim()) { setMapResults(null); return; }
    fetch(`/api/distributors/search?q=${encodeURIComponent(mapQuery.trim())}`)
      .then((r) => r.json())
      .then((d) => setMapResults(Array.isArray(d.results) ? d.results : []));
  }

  return (
    <div>
      <PageHead title="Distributor Database" description="Distributors observed across your analyses, plus a direct search of the canonical licensor-UUID mapping." />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {status === null && history === null ? (
          <>
            <SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard label="Mapped distributors" value={status?.validMappings ?? "—"} sub="canonical UUID records" />
            <StatCard label="Observed" value={history ? observed.length : "—"} sub="from your lookup history" />
            <StatCard label="Duplicate records" value={status?.duplicateRecords ?? "—"} />
            <StatCard label="Conflicts" value={status?.conflicts ?? "—"} tone={(status?.conflicts ?? 0) > 0 ? "danger" : "default"} sub="same UUID, different names" />
          </>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {conflicts.map((c) => (
            <div key={c.uuid} className="flex items-start gap-2.5 rounded-md border border-danger/25 bg-danger/5 px-3 py-2.5 text-[12.5px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0">
                <span className="font-mono text-[11.5px] text-foreground-secondary">{c.uuid}</span> maps to multiple names in the mapping file:{" "}
                <span className="text-foreground">{c.distributors.join(", ")}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Panel title="Search the canonical mapping" description="The full mapping is never loaded into the browser — search returns at most 50 rows." className="mb-5">
        <div className="flex gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
            <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
            <input
              value={mapQuery}
              onChange={(e) => setMapQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchMapping()}
              placeholder="Distributor name or licensor UUID…"
              className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
            />
          </div>
        </div>
        {mapResults && (
          mapResults.length === 0 ? (
            <EmptyState title="No matches" className="mt-3" />
          ) : (
            <div className="mt-3 divide-y divide-border-subtle">
              {mapResults.map((r) => (
                <div key={r.uuid} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-medium text-foreground">{r.distributor}</span>
                  <span className="flex items-center gap-1.5">
                    <code className="font-mono text-[11px] text-foreground-muted">{r.uuid}</code>
                    <CopyButton value={r.uuid} label="" />
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </Panel>

      <Panel
        title="Observed Distributors"
        description={`${observed.length} distributor${observed.length === 1 ? "" : "s"} across your analyzed catalog`}
        actions={
          <input
            value={tableQuery}
            onChange={(e) => setTableQuery(e.target.value)}
            placeholder="Filter…"
            className="h-8 w-40 rounded-sm border border-border-strong bg-input px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-foreground-muted"
          />
        }
      >
        <DistributorDatabaseTable rows={observed} loading={history === null} query={tableQuery} onOpen={setOpenDistributor} />
      </Panel>

      <DistributorDetailsDrawer distributor={openDistributor} history={history ?? []} onClose={() => setOpenDistributor(null)} />
    </div>
  );
}
