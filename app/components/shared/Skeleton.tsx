import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      role="presentation"
      aria-hidden
      className={cn(
        "rounded-sm bg-[linear-gradient(90deg,var(--surface-raised)_25%,var(--skeleton-hi)_50%,var(--surface-raised)_75%)] bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none",
        className
      )}
    />
  );
}

/** A row of skeleton blocks shaped like a stat card, for dashboard loading states. */
export function SkeletonStatCard() {
  return (
    <div className="rounded border border-border-strong bg-card p-4 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function SkeletonTableRow({ columns = 6 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <Skeleton className="h-4 w-full max-w-[140px]" />
        </td>
      ))}
    </tr>
  );
}
