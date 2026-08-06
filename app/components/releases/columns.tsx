"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import type { ReleaseRow } from "../../lib/hooks/useArtistCatalog";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { StatusBadge } from "../shared/StatusBadge";
import { DistributorBadge } from "../distributor/DistributorBadge";
import { fmtDate } from "../../lib/types";

const STATUS_META: Record<ReleaseRow["metadataStatus"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  healthy: { label: "Healthy", tone: "success" },
  warning: { label: "Warning", tone: "warning" },
  conflict: { label: "Conflict", tone: "danger" },
  missing: { label: "Missing Data", tone: "warning" },
  unresolved: { label: "Unknown", tone: "neutral" },
};

const TYPE_LABEL: Record<string, string> = { album: "Album", single: "Single", compilation: "Compilation", appears_on: "Appears On", removed: "Removed" };

const col = createColumnHelper<ReleaseRow>();

export function buildColumns(onOpen: (row: ReleaseRow) => void) {
  return [
    col.display({
      id: "cover",
      header: "",
      size: 44,
      cell: ({ row }) => <ArtworkThumb src={null} alt={row.original.title} size={34} />,
    }),
    col.accessor("title", {
      header: "Release",
      cell: ({ row }) => (
        <button onClick={() => onOpen(row.original)} className="text-left font-medium text-foreground hover:text-accent hover:underline">
          {row.original.title}
        </button>
      ),
    }),
    col.accessor((r) => r.artists.join(", "), {
      id: "artist",
      header: "Artist",
      cell: (ctx) => <span className="text-foreground-secondary">{ctx.getValue() || "—"}</span>,
    }),
    col.accessor("releaseType", {
      header: "Type",
      cell: (ctx) =>
        ctx.getValue() === "removed"
          ? <StatusBadge tone="danger">Removed</StatusBadge>
          : <span className="text-foreground-secondary">{TYPE_LABEL[ctx.getValue() ?? ""] ?? "Unknown"}</span>,
    }),
    col.accessor("releaseDate", {
      header: "Release date",
      cell: (ctx) => <span className="whitespace-nowrap text-foreground-secondary">{fmtDate(ctx.getValue())}</span>,
    }),
    col.accessor("trackCount", {
      header: "Tracks",
      cell: (ctx) => <span className="tabular-nums text-foreground-secondary">{ctx.getValue()}</span>,
    }),
    col.accessor("upc", {
      header: "UPC",
      cell: (ctx) => <span className="font-mono text-[11.5px] text-foreground-muted">{ctx.getValue() ?? "—"}</span>,
    }),
    col.accessor("distributors", {
      header: "Distributor",
      cell: (ctx) => <DistributorBadge distributors={ctx.getValue()} />,
    }),
    col.accessor("metadataStatus", {
      header: "Status",
      cell: (ctx) => {
        const meta = STATUS_META[ctx.getValue()];
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      },
    }),
    col.display({
      id: "actions",
      header: "",
      size: 40,
      cell: ({ row }) => (
        <button onClick={() => onOpen(row.original)} aria-label="Open release" className="flex size-7 items-center justify-center rounded-sm text-foreground-muted hover:bg-card-hover hover:text-foreground">
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      ),
    }),
  ];
}
