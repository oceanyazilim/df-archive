"use client";

import { useMemo } from "react";
import type { ArtistCatalogData } from "../ArtistCatalog";
import type { AnalyzerTarget } from "../analyzer-details/OceanAnalyzerPage";
import { useArtistCatalog } from "../../lib/hooks/useArtistCatalog";
import { resolvedDistributorBreakdown } from "../../lib/aggregate";
import { CatalogDashboard } from "./CatalogDashboard";
import { ReleaseCatalog } from "../releases/ReleaseCatalog";

export interface ArtistWorkspaceProps {
  data: ArtistCatalogData;
  fetchedAt: string | null;
  onReanalyze: () => void;
  onExport: () => void;
  onOpenHistory: () => void;
  onOpenAnalyzer: (target: AnalyzerTarget) => void;
  flash: (m: string) => void;
}

/**
 * Owns the single `useArtistCatalog` resolution-state instance for this
 * artist and hands it to both the catalog dashboard (distributor donut,
 * primary-distributor stat) and the release table/drawer — resolving a
 * track once updates both surfaces.
 */
export function ArtistWorkspace({ data, fetchedAt, onReanalyze, onExport, onOpenHistory, onOpenAnalyzer, flash }: ArtistWorkspaceProps) {
  const catalog = useArtistCatalog(data);
  const distributorBreakdown = useMemo(() => resolvedDistributorBreakdown(catalog.resolved), [catalog.resolved]);

  return (
    <div className="space-y-6">
      <CatalogDashboard
        data={data}
        fetchedAt={fetchedAt}
        onReanalyze={onReanalyze}
        onExport={onExport}
        onOpenHistory={onOpenHistory}
        distributorBreakdown={distributorBreakdown}
      />
      <ReleaseCatalog data={data} catalog={catalog} onOpenAnalyzer={onOpenAnalyzer} flash={flash} />
    </div>
  );
}
