import type { Ocean3DLoaderMode } from "../components/loaders/types";

export type AnalysisStatus =
  | "idle"
  | "validating"
  | "fetching-profile"
  | "loading-catalog"
  | "processing-metadata"
  | "matching-uuid"
  | "checking-aliases"
  | "calculating-confidence"
  | "preparing-results"
  | "success"
  | "partial-success"
  | "error";

export type AnalysisKind = "release" | "artist";

export interface AnalysisStatusConfig {
  loaderMode: Ocean3DLoaderMode;
  title: string;
  description: string;
  /** Approximate stage-based progress band, per the spec's fallback table — real percentages are used instead wherever the backend actually provides them (currently: nowhere in this app, so every run is stage-based). */
  progressBand: [number, number];
  searchSubstage?: "metadata" | "uuid" | "alias" | "confidence" | "complete";
  retryable: boolean;
}

/**
 * Ordered stage sequence for each analysis kind. A single track/album lookup
 * (`release`) and an artist-catalog lookup (`artist`) visit different real
 * subsets of the full AnalysisStatus union — the backend genuinely does
 * different work for each (see src/lookup/service.ts vs src/artist/catalog.ts),
 * so the sequences aren't the same length or shape.
 */
export const ANALYSIS_SEQUENCE: Record<AnalysisKind, AnalysisStatus[]> = {
  release: ["validating", "processing-metadata", "matching-uuid", "checking-aliases", "calculating-confidence", "preparing-results"],
  artist: ["validating", "fetching-profile", "loading-catalog", "preparing-results"],
};

export function getAnalysisStatusConfig(status: AnalysisStatus, kind: AnalysisKind): AnalysisStatusConfig {
  switch (status) {
    case "idle":
      return { loaderMode: "distributor-search", title: "", description: "", progressBand: [0, 0], retryable: false };
    case "validating":
      return { loaderMode: "distributor-search", title: "Validating Spotify URL", description: "Checking the link format and detecting its type.", progressBand: [5, 10], searchSubstage: "metadata", retryable: false };
    case "fetching-profile":
      return { loaderMode: "catalog-analysis", title: "Fetching artist profile", description: "Reading the artist's current Spotify profile.", progressBand: [10, 25], retryable: false };
    case "loading-catalog":
      return { loaderMode: "catalog-analysis", title: "Loading release catalog", description: "Merging Spotify and analytics history for every release.", progressBand: [25, 55], retryable: false };
    case "processing-metadata":
      return { loaderMode: "distributor-search", title: "Reading release metadata", description: "Reading track, album, and identifier data from Spotify.", progressBand: [25, 55], searchSubstage: "metadata", retryable: false };
    case "matching-uuid":
      return { loaderMode: "distributor-search", title: "Matching licensor UUID", description: "Comparing the captured licensor identifier against the canonical mapping.", progressBand: [55, 75], searchSubstage: "uuid", retryable: false };
    case "checking-aliases":
      return { loaderMode: "distributor-search", title: "Checking distributor aliases", description: "Looking for known alternate names for the matched distributor.", progressBand: [75, 88], searchSubstage: "alias", retryable: false };
    case "calculating-confidence":
      return { loaderMode: "distributor-search", title: "Calculating detection confidence", description: "Confirming the match is exact, not inferred.", progressBand: [88, 96], searchSubstage: "confidence", retryable: false };
    case "preparing-results":
      return { loaderMode: kind === "artist" ? "catalog-analysis" : "distributor-search", title: "Preparing results", description: "Assembling the dashboard.", progressBand: [96, 100], searchSubstage: "complete", retryable: false };
    case "success":
      return { loaderMode: "success", title: "Analysis complete", description: "", progressBand: [100, 100], retryable: false };
    case "partial-success":
      return { loaderMode: "success", title: "Analysis complete — partial data", description: "Some sections could not be loaded.", progressBand: [100, 100], retryable: false };
    case "error":
      return { loaderMode: "distributor-search", title: "Analysis failed", description: "", progressBand: [0, 0], retryable: true };
  }
}

/** Midpoint of the stage's progress band — used as the determinate value while that stage is active (never a fabricated precise number, just the stage's own honestly-approximate band). */
export function stageBandProgress(status: AnalysisStatus, kind: AnalysisKind): number {
  const [min, max] = getAnalysisStatusConfig(status, kind).progressBand;
  return Math.round((min + max) / 2);
}
