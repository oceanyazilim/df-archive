import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-card/60 px-6 py-11 text-center", className)}>
      {icon && (
        <div className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-card-elevated text-foreground-muted">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-xs text-foreground-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}
