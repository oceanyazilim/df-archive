import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "bg-success/10 text-success border-success/25",
        warning: "bg-warning/10 text-warning border-warning/25",
        danger: "bg-danger/10 text-danger border-danger/25",
        info: "bg-accent/10 text-accent border-accent/25",
        purple: "bg-purple/10 text-purple border-purple/25",
        neutral: "bg-card-elevated text-foreground-secondary border-border-strong",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface StatusBadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}

export function StatusBadge({ tone, children, dot = true, className, title }: StatusBadgeProps) {
  return (
    <span title={title} className={cn(badgeVariants({ tone }), className)}>
      {dot && <span className="size-1.5 rounded-full bg-current shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** Maps the app's metadata-status vocabulary to a badge tone, so every table/drawer stays consistent. */
export function metadataStatusTone(status: string): VariantProps<typeof badgeVariants>["tone"] {
  switch (status) {
    case "ready":
    case "healthy":
      return "success";
    case "partial":
    case "warning":
      return "warning";
    case "conflict":
    case "failed":
      return "danger";
    case "loading":
    case "not_loaded":
      return "neutral";
    default:
      return "neutral";
  }
}
