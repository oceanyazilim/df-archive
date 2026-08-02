"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { ArtistCatalogData } from "../ArtistCatalog";
import { catalogTimeline, groupTracksByMonth, metadataCompleteness, releaseTypeCounts } from "../../lib/aggregate";
import { staggerContainer, staggerItem } from "../../lib/motion";
import { ArtistSummary } from "./ArtistSummary";
import { MetricCard } from "./MetricCard";
import { CatalogActivityChart } from "./CatalogActivityChart";
import { DistributorBreakdown, type DistributorSlice } from "./DistributorBreakdown";
import { MetadataHealth } from "./MetadataHealth";
import { ReleaseTypeChart } from "./ReleaseTypeChart";
import { CatalogTimeline } from "./CatalogTimeline";
import { RecentActivity } from "./RecentActivity";
import { Disc3, Music2, ShieldCheck } from "lucide-react";

export interface CatalogDashboardProps {
  data: ArtistCatalogData;
  fetchedAt: string | null;
  onReanalyze: () => void;
  onExport: () => void;
  onOpenHistory: () => void;
  /** Populated once bulk distributor resolution has run (lifted from the release table in Phase 7). */
  distributorBreakdown?: DistributorSlice[];
}

/** The full catalog-wide overview: identity → KPIs → charts → second row, staggered into view. */
export function CatalogDashboard({ data, fetchedAt, onReanalyze, onExport, onOpenHistory, distributorBreakdown }: CatalogDashboardProps) {
  const monthly = useMemo(() => groupTracksByMonth(data.tracks), [data.tracks]);
  const releaseTypes = useMemo(() => releaseTypeCounts(data.tracks), [data.tracks]);
  const health = useMemo(() => metadataCompleteness(data.tracks), [data.tracks]);
  const timeline = useMemo(() => catalogTimeline(data.tracks), [data.tracks]);

  const mainDistributor = distributorBreakdown?.length ? distributorBreakdown[0].name : null;

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-5">
      <motion.div variants={staggerItem}>
        <ArtistSummary
          data={data}
          fetchedAt={fetchedAt}
          mainDistributor={mainDistributor}
          distributorCount={distributorBreakdown?.length ?? 0}
          onReanalyze={onReanalyze}
          onExport={onExport}
        />
      </motion.div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="Total Releases" value={data.counts.albums.toLocaleString()} icon={<Disc3 className="size-4" aria-hidden />} sub={`${data.counts.total.toLocaleString()} tracks total`} />
        <MetricCard label="Total Tracks" value={data.counts.total.toLocaleString()} icon={<Music2 className="size-4" aria-hidden />} sub={`${data.counts.withIsrc.toLocaleString()} with ISRC`} />
        <MetricCard
          label="Primary Distributor"
          value={mainDistributor ?? "Unresolved"}
          tone={mainDistributor ? "accent" : "default"}
          sub={mainDistributor ? `${Math.round(((distributorBreakdown?.[0]?.count ?? 0) / data.counts.total) * 100)}% of analyzed catalog` : "Resolve distributors below"}
        />
        <MetricCard
          label="Metadata Health"
          value={`${health.healthyPct}%`}
          tone={health.healthyPct >= 90 ? "success" : health.healthyPct >= 70 ? "warning" : "danger"}
          icon={<ShieldCheck className="size-4" aria-hidden />}
          sub={`${health.categories.filter((c) => (c.count ?? 0) > 0).length} categories flagged`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3"><CatalogActivityChart data={monthly} /></div>
        <div className="xl:col-span-2"><DistributorBreakdown data={distributorBreakdown} /></div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <MetadataHealth healthyPct={health.healthyPct} categories={health.categories} />
        <ReleaseTypeChart data={releaseTypes} />
        <CatalogTimeline entries={timeline} />
        <RecentActivity onOpenHistory={onOpenHistory} />
      </div>
    </motion.div>
  );
}
