export type Ocean3DLoaderMode = "app-initialization" | "page-transition" | "distributor-search" | "catalog-analysis" | "success";

/** Progress can be a real 0-100 number, or explicitly "indeterminate" — never a fabricated precise value. */
export type LoaderProgress = number | "indeterminate";

export interface Ocean3DLoaderProps {
  mode: Ocean3DLoaderMode;
  /** 0-100, or "indeterminate" when the backend gives no real percentage. */
  progress?: LoaderProgress;
  stage?: string;
  description?: string;
  fullscreen?: boolean;
  compact?: boolean;
  /** Distributor-search sub-stage — drives the orbit/scan/node behavior described per-substage in the spec. */
  searchSubstage?: "metadata" | "uuid" | "alias" | "confidence" | "complete";
  /** Real, non-fabricated catalog-analysis counters — omitted fields render as unknown, never a fake 0. */
  catalogStats?: { releases?: number; totalReleases?: number; tracks?: number; distributors?: number; warnings?: number };
  /** Ordered stage checklist for LoaderStageList — { label, state }. */
  stages?: { label: string; state: "done" | "active" | "pending" }[];
  className?: string;
}
