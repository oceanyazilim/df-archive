"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Columns3, Download, ListFilter, Loader2, RefreshCw, Rows3, Search, Square, SquareCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../shared/Button";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "healthy", label: "Healthy" },
  { value: "warning", label: "Warning" },
  { value: "conflict", label: "Conflict" },
  { value: "missing", label: "Missing Data" },
  { value: "unresolved", label: "Unknown" },
];

export interface ReleaseFiltersProps {
  query: string;
  onQueryChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  density: "compact" | "comfortable";
  onDensityChange: (d: "compact" | "comfortable") => void;
  running: boolean;
  onResolveAll: () => void;
  onStop: () => void;
  resolvableCount: number;
  doneCount: number;
  onExport: () => void;
  columnOptions: { id: string; label: string; visible: boolean }[];
  onToggleColumn: (id: string) => void;
}

export function ReleaseFilters({
  query, onQueryChange, statusFilter, onStatusFilterChange, density, onDensityChange,
  running, onResolveAll, onStop, resolvableCount, doneCount, onExport, columnOptions, onToggleColumn,
}: ReleaseFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
        <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search title, artist, UPC, or distributor…"
          className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
        />
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-3 text-[13px] text-foreground-secondary hover:bg-card-hover">
            <ListFilter className="size-3.5" aria-hidden />
            {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "Status"}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className={cn(
              "z-dropdown min-w-[180px] rounded-md border border-border-strong bg-card-elevated p-1 shadow-lg",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
            )}
          >
            {STATUS_OPTIONS.map((o) => (
              <DropdownMenu.Item
                key={o.value}
                onSelect={() => onStatusFilterChange(o.value)}
                className="flex items-center justify-between rounded-sm px-2.5 py-2 text-[13px] text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground"
              >
                {o.label}
                {statusFilter === o.value && <Check className="size-3.5 text-accent" aria-hidden />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-3 text-[13px] text-foreground-secondary hover:bg-card-hover">
            <Columns3 className="size-3.5" aria-hidden /> Columns
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className={cn(
              "z-dropdown min-w-[180px] rounded-md border border-border-strong bg-card-elevated p-1 shadow-lg",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
            )}
          >
            {columnOptions.map((c) => (
              <DropdownMenu.Item
                key={c.id}
                onSelect={(e) => { e.preventDefault(); onToggleColumn(c.id); }}
                className="flex items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground"
              >
                {c.visible ? <SquareCheck className="size-3.5 text-accent" aria-hidden /> : <Square className="size-3.5" aria-hidden />}
                {c.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        onClick={() => onDensityChange(density === "compact" ? "comfortable" : "compact")}
        className="flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-3 text-[13px] text-foreground-secondary hover:bg-card-hover"
        title="Toggle row density"
      >
        <Rows3 className="size-3.5" aria-hidden /> {density === "compact" ? "Compact" : "Comfortable"}
      </button>

      {running ? (
        <Button variant="secondary" size="sm" onClick={onStop}>Stop ({doneCount}/{resolvableCount})</Button>
      ) : (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={onResolveAll} disabled={!resolvableCount}>
          Resolve distributors
        </Button>
      )}
      {running && <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden />}

      <Button variant="secondary" size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={onExport}>Export</Button>
    </div>
  );
}
