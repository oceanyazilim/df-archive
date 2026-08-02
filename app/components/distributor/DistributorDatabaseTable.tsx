"use client";

import { useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Building2 } from "lucide-react";
import type { HistoryItem } from "../../lib/types";
import { EmptyState } from "../shared/EmptyState";
import { SkeletonTableRow } from "../shared/Skeleton";

export interface ObservedDistributor {
  name: string;
  analyses: number;
  trackCount: number;
  artistCount: number;
  lastSeen: string;
}

/** Aggregates the real lookup history into one row per distinct observed distributor. */
export function aggregateObservedDistributors(items: HistoryItem[]): ObservedDistributor[] {
  const map = new Map<string, { name: string; analyses: number; tracks: Set<string>; artists: Set<string>; lastSeen: string }>();
  for (const h of items) {
    if (!h.distributor) continue;
    const e = map.get(h.distributor) ?? { name: h.distributor, analyses: 0, tracks: new Set<string>(), artists: new Set<string>(), lastSeen: h.at };
    e.analyses++;
    if (h.spotifyTrackId ?? h.isrc ?? h.trackTitle) e.tracks.add(h.spotifyTrackId ?? h.isrc ?? h.trackTitle ?? "");
    for (const a of h.artists ?? []) e.artists.add(a);
    if (h.at > e.lastSeen) e.lastSeen = h.at;
    map.set(h.distributor, e);
  }
  return [...map.values()]
    .map((e) => ({ name: e.name, analyses: e.analyses, trackCount: e.tracks.size, artistCount: e.artists.size, lastSeen: e.lastSeen }))
    .sort((a, b) => b.analyses - a.analyses);
}

const col = createColumnHelper<ObservedDistributor>();
const columns = [
  col.accessor("name", {
    header: "Distributor",
    cell: (ctx) => <span className="font-medium text-foreground">{ctx.getValue()}</span>,
  }),
  col.accessor("analyses", { header: "Detections", cell: (ctx) => <span className="tabular-nums text-foreground-secondary">{ctx.getValue()}</span> }),
  col.accessor("trackCount", { header: "Tracks", cell: (ctx) => <span className="tabular-nums text-foreground-secondary">{ctx.getValue()}</span> }),
  col.accessor("artistCount", { header: "Artists", cell: (ctx) => <span className="tabular-nums text-foreground-secondary">{ctx.getValue()}</span> }),
  col.accessor("lastSeen", {
    header: "Last detected",
    cell: (ctx) => <span className="whitespace-nowrap text-foreground-secondary">{new Date(ctx.getValue()).toLocaleDateString()}</span>,
  }),
];

export function DistributorDatabaseTable({ rows, loading, query, onOpen }: { rows: ObservedDistributor[]; loading: boolean; query: string; onOpen: (row: ObservedDistributor) => void }) {
  const [sorting, setSorting] = useState([{ id: "analyses", desc: true }]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: query },
    onSortingChange: setSorting,
    globalFilterFn: (row, _id, value) => row.original.name.toLowerCase().includes(String(value).toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;

  return (
    <div className="overflow-x-auto rounded-md border border-border-strong">
      <table className="w-full text-[13px]">
        <thead className="bg-card-elevated">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border-subtle">
              {hg.headers.map((h) => {
                const dir = h.column.getIsSorted();
                return (
                  <th key={h.id} className="whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                    <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground-secondary">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading && Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} columns={columns.length} />)}
          {!loading && visibleRows.map((row) => (
            <tr key={row.id} onClick={() => onOpen(row.original)} className="cursor-pointer border-b border-border-subtle last:border-0 transition-colors hover:bg-card-hover">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && visibleRows.length === 0 && (
        <EmptyState icon={<Building2 className="size-5" aria-hidden />} title="No distributors observed yet" description="Distributors appear here once analyses resolve them." className="border-0" />
      )}
    </div>
  );
}
