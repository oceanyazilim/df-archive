"use client";

import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, ExternalLink, MoreHorizontal, RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { NA, fmtDate } from "../../lib/types";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Button } from "../shared/Button";
import { CopyButton } from "../shared/CopyButton";
import type { ArtistCatalogData } from "../ArtistCatalog";
import { catalogDateRange } from "../../lib/aggregate";

/** Best-effort average color from the artist image, for a subtle radial backdrop. Falls back silently on any CORS/taint failure. */
function useDominantColor(src: string | null): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setColor(null); return; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 16);
        const { data } = ctx.getImageData(0, 0, 16, 16);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        if (!cancelled && n) setColor(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch { /* tainted canvas (no CORS headers) — keep default backdrop */ }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return color;
}

export interface ArtistSummaryProps {
  data: ArtistCatalogData;
  fetchedAt: string | null;
  mainDistributor: string | null;
  distributorCount: number;
  onReanalyze: () => void;
  onExport: () => void;
}

export function ArtistSummary({ data, fetchedAt, mainDistributor, distributorCount, onReanalyze, onExport }: ArtistSummaryProps) {
  const dominant = useDominantColor(data.imageUrl);
  const { first, last } = catalogDateRange(data.tracks);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-strong bg-card p-5 sm:p-6">
      <div
        className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full opacity-[0.14] blur-3xl"
        style={{ background: dominant ?? "#9CF04A" }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
        <ArtworkThumb src={data.imageUrl} alt={data.name ?? "Artist"} size={88} rounded="full" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[22px] font-semibold tracking-tight text-foreground">{data.name ?? "Unknown artist"}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
                <span className="inline-flex items-center gap-1 font-mono">
                  {data.spotifyArtistId}
                  <CopyButton value={data.spotifyArtistId} label="" className="px-0.5" />
                </span>
                {fetchedAt && <span>Last analyzed {fmtDate(fetchedAt)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild variant="secondary" size="sm">
                <a href={data.spotifyUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden /> Open on Spotify
                </a>
              </Button>
              <Button variant="secondary" size="sm" icon={<RotateCw className="size-3.5" aria-hidden />} onClick={onReanalyze}>Re-analyze</Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button aria-label="More options" className="flex size-9 items-center justify-center rounded-sm border border-border-strong bg-card text-foreground-secondary hover:bg-card-hover">
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className={cn(
                      "z-dropdown min-w-[190px] rounded-md border border-border-strong bg-card-elevated p-1 shadow-lg",
                      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
                    )}
                  >
                    <DropdownMenu.Item asChild>
                      <button onClick={onExport} className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] text-foreground-secondary hover:bg-card-hover hover:text-foreground">
                        <Download className="size-4" aria-hidden /> Export report
                      </button>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Fact label="Monthly listeners" value={NA} />
            <Fact label="Followers" value={NA} />
            <Fact label="Releases" value={data.counts.albums.toLocaleString()} />
            <Fact label="Tracks" value={data.counts.total.toLocaleString()} />
            <Fact label="Primary distributor" value={mainDistributor ?? "Not yet resolved"} />
            <Fact label="Distributors detected" value={distributorCount > 0 ? distributorCount.toLocaleString() : "—"} />
            <Fact label="Catalog range" value={first && last ? `${fmtDate(first)} – ${fmtDate(last)}` : NA} />
            <Fact label="Off-profile tracks" value={data.counts.offProfile.toLocaleString()} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value}</div>
    </div>
  );
}
