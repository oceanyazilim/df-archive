"use client";

import { useMemo, useState } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type PaginationState, type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Disc3 } from "lucide-react";
import type { ReleaseRow } from "../../lib/hooks/useArtistCatalog";
import { buildColumns } from "./columns";
import { ReleaseFilters } from "./ReleaseFilters";
import { SkeletonTableRow } from "../shared/Skeleton";
import { EmptyState } from "../shared/EmptyState";
import { Panel } from "../shared/Card";
import { cn } from "../../lib/cn";

const COLUMN_LABELS: Record<string, string> = {
  cover: "Cover", title: "Release", artist: "Artist", releaseType: "Type", releaseDate: "Release date",
  trackCount: "Tracks", upc: "UPC", distributors: "Distributor", metadataStatus: "Status", actions: "Actions",
};

export interface ReleaseTableProps {
  rows: ReleaseRow[];
  loading?: boolean;
  running: boolean;
  onResolveAll: () => void;
  onStop: () => void;
  resolvableCount: number;
  doneCount: number;
  onExport: () => void;
  onOpenRelease: (row: ReleaseRow) => void;
}

export function ReleaseTable({ rows, loading, running, onResolveAll, onStop, resolvableCount, doneCount, onExport, onOpenRelease }: ReleaseTableProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "releaseDate", desc: true }]);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const columns = useMemo(() => buildColumns(onOpenRelease), [onOpenRelease]);
  const filteredRows = useMemo(
    () => rows.filter((r) => statusFilter === "all" || r.metadataStatus === statusFilter),
    [rows, statusFilter]
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter: query, columnVisibility, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue).toLowerCase();
      const r = row.original as ReleaseRow;
      return (
        r.title.toLowerCase().includes(q) ||
        r.artists.join(" ").toLowerCase().includes(q) ||
        (r.upc ?? "").toLowerCase().includes(q) ||
        r.distributors.join(" ").toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const columnOptions = table.getAllLeafColumns()
    .filter((c) => c.id !== "cover" && c.id !== "actions")
    .map((c) => ({ id: c.id, label: COLUMN_LABELS[c.id] ?? c.id, visible: c.getIsVisible() }));

  const pageCount = table.getPageCount();
  const rowCells = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <Panel title="Release Catalog" description={`${filteredRows.length.toLocaleString()} releases`}>
      <div className="mb-4">
        <ReleaseFilters
          query={query} onQueryChange={setQuery}
          statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
          density={density} onDensityChange={setDensity}
          running={running} onResolveAll={onResolveAll} onStop={onStop}
          resolvableCount={resolvableCount} doneCount={doneCount}
          onExport={onExport}
          columnOptions={columnOptions}
          onToggleColumn={(id) => table.getColumn(id)?.toggleVisibility()}
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-border-strong">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-card-elevated">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border-subtle">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  return (
                    <th key={h.id} style={{ width: h.getSize() === 150 ? undefined : h.getSize() }} className="whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {h.isPlaceholder ? null : sortable ? (
                        <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground-secondary">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sortDir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : sortDir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={columns.length} />)}
            {!loading && table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onOpenRelease(row.original)}
                className="cursor-pointer border-b border-border-subtle last:border-0 transition-colors hover:bg-card-hover"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={cn(rowCells, "align-middle")} onClick={(e) => { if ((e.target as HTMLElement).closest("button")) e.stopPropagation(); }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filteredRows.length === 0 && (
          <EmptyState icon={<Disc3 className="size-5" aria-hidden />} title="No releases match this filter" className="border-0" />
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px] text-foreground-secondary">
          <span>Page {pagination.pageIndex + 1} of {pageCount}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="flex size-7 items-center justify-center rounded-sm border border-border-strong disabled:opacity-40 hover:bg-card-hover">
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="flex size-7 items-center justify-center rounded-sm border border-border-strong disabled:opacity-40 hover:bg-card-hover">
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
