"use client";

import { useMemo } from "react";
import { ExternalLink, ListMusic, RefreshCw } from "lucide-react";
import type { ArtistCatalogData, PlaylistCatalogData } from "../ArtistCatalog";
import type { AnalyzerTarget } from "../analyzer-details/OceanAnalyzerPage";
import { useArtistCatalog } from "../../lib/hooks/useArtistCatalog";
import { ReleaseCatalog } from "../releases/ReleaseCatalog";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { StatCard } from "../shared/StatCard";
import { Button } from "../shared/Button";

export interface PlaylistWorkspaceProps {
  data: PlaylistCatalogData;
  fetchedAt: string | null;
  onReanalyze: () => void;
  onOpenAnalyzer: (target: AnalyzerTarget) => void;
  onAnalyze: (input: string) => void;
  flash: (m: string) => void;
}

/**
 * The artist-catalogue treatment for a playlist: same release table, same
 * resolution/recovery pipeline — removed (unplayable) entries surface as the
 * "removed" type and recover their ISRC/UPC/distributor exactly like removed
 * artist releases. The header speaks playlist, not artist.
 */
export function PlaylistWorkspace({ data, fetchedAt, onReanalyze, onOpenAnalyzer, onAnalyze, flash }: PlaylistWorkspaceProps) {
  // The release machinery consumes the shared catalogue contract; only the
  // key field differs for a playlist.
  const asCatalogData = useMemo<ArtistCatalogData>(
    () => ({ ...data, spotifyArtistId: data.spotifyPlaylistId, soundchartsArtistUuid: null }),
    [data]
  );
  const catalog = useArtistCatalog(asCatalogData);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border-strong bg-card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <ArtworkThumb src={data.imageUrl} alt={data.name ?? "Playlist"} size={72} rounded="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
              <ListMusic className="size-3.5" aria-hidden /> Playlist analysis
            </div>
            <h2 className="mt-0.5 truncate text-xl font-semibold text-foreground">{data.name ?? "Untitled playlist"}</h2>
            <p className="mt-0.5 text-[12.5px] text-foreground-muted">
              {data.owner ? `by ${data.owner}` : ""}
              {data.followers !== null ? ` · ${data.followers.toLocaleString()} followers` : ""}
              {fetchedAt ? ` · analyzed ${new Date(fetchedAt).toLocaleString()}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={onReanalyze}>Re-analyze</Button>
            <a
              href={data.spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-sm border border-border-strong bg-card px-3 text-[12.5px] text-foreground-secondary hover:bg-card-hover"
            >
              Open on Spotify <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </div>
        {data.coverage.note && <p className="mt-3 text-[11.5px] text-foreground-muted">{data.coverage.note}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Tracks analyzed" value={data.counts.total} />
        <StatCard label="Still live" value={data.counts.onProfile} />
        <StatCard label="Removed" value={data.counts.offProfile} tone={data.counts.offProfile > 0 ? "danger" : "default"} />
        <StatCard label="With ISRC" value={data.counts.withIsrc} />
      </div>

      <ReleaseCatalog data={asCatalogData} catalog={catalog} onOpenAnalyzer={onOpenAnalyzer} onAnalyze={onAnalyze} flash={flash} />
    </div>
  );
}
