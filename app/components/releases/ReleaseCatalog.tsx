"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ArtistCatalogData } from "../ArtistCatalog";
import type { UseArtistCatalogResult, ReleaseRow } from "../../lib/hooks/useArtistCatalog";
import type { AnalyzerTarget } from "../analyzer-details/OceanAnalyzerPage";
import { ReleaseTable } from "./ReleaseTable";
import { ReleaseDetailsDrawer } from "./ReleaseDetailsDrawer";
import { exportReleasesCsv } from "./exportUtils";

export interface ReleaseCatalogProps {
  data: ArtistCatalogData;
  catalog: UseArtistCatalogResult;
  onOpenAnalyzer: (target: AnalyzerTarget) => void;
  flash: (m: string) => void;
}

export function ReleaseCatalog({ data, catalog, onOpenAnalyzer, flash }: ReleaseCatalogProps) {
  const [openRelease, setOpenRelease] = useState<ReleaseRow | null>(null);
  const { resolved, running, resolvable, doneCount, resolveAll, stop, releaseRows } = catalog;
  const cov = data.coverage;
  const partial = cov.spotifyAlbumsTruncated || cov.soundchartsTruncated || !!cov.note;

  return (
    <div className="space-y-4">
      {partial && (
        <div className="flex items-start gap-2.5 rounded-md border border-warning/25 bg-warning/5 px-4 py-3 text-[12.5px] text-foreground-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            {cov.note ? `${cov.note} ` : ""}
            {cov.spotifyAlbumsTruncated ? `Loaded the ${cov.spotifyAlbums} most recent releases from Spotify. ` : ""}
            {cov.soundchartsTruncated && cov.soundchartsTotal !== null ? `Loaded ${cov.soundchartsLoaded} of ${cov.soundchartsTotal} historical entries.` : ""}
          </div>
        </div>
      )}

      <ReleaseTable
        rows={releaseRows}
        running={running}
        onResolveAll={() => resolveAll()}
        onStop={stop}
        resolvableCount={resolvable.length}
        doneCount={doneCount}
        onExport={() => exportReleasesCsv(releaseRows, data.name ?? data.spotifyArtistId)}
        onOpenRelease={(row) => {
          setOpenRelease(row);
          // On-demand resolution: if nothing in this release has been resolved yet, kick it off.
          if (row.distributors.length === 0 && !running) resolveAll(row.tracks);
        }}
      />

      <ReleaseDetailsDrawer
        release={openRelease}
        resolved={resolved}
        onClose={() => setOpenRelease(null)}
        onOpenAnalyzer={onOpenAnalyzer}
        flash={flash}
      />
    </div>
  );
}
