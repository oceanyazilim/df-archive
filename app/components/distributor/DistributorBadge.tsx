import { StatusBadge } from "../shared/StatusBadge";

export interface DistributorBadgeProps {
  /** Distinct resolved distributor names for this row — 0 = unresolved, 1 = resolved, >1 = real conflict. */
  distributors: string[];
  className?: string;
}

/** Compact distributor pill reused across the release table, drawer, and distributor pages. */
export function DistributorBadge({ distributors, className }: DistributorBadgeProps) {
  if (distributors.length === 0) return <StatusBadge tone="neutral" className={className}>Unresolved</StatusBadge>;
  if (distributors.length === 1) return <StatusBadge tone="info" className={className}>{distributors[0]}</StatusBadge>;
  return <StatusBadge tone="danger" className={className}>Multiple ({distributors.length})</StatusBadge>;
}
