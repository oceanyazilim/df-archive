import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  hoverable?: boolean;
}

export function Card({ className, elevated, hoverable, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border-strong",
        elevated ? "bg-card-elevated" : "bg-card",
        hoverable && "transition-[border-color,transform,box-shadow] duration-base ease-out hover:border-accent/30 hover:-translate-y-0.5 hover:shadow",
        className
      )}
      {...props}
    />
  );
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}

/** A titled content panel — the workhorse container for dashboard/chart/table cards. */
export function Panel({ title, description, actions, className, children, ...props }: PanelProps) {
  return (
    <Card className={cn("p-4 sm:p-5", className)} {...props}>
      {(title || actions) && (
        // Wraps instead of squeezing: a wide toolbar used to crush the title
        // to a single letter (the streaming chart's controls are long).
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-[180px] flex-1">
            {title && <h3 className="text-[15px] font-semibold text-foreground tracking-tight">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-foreground-secondary">{description}</p>}
          </div>
          {actions && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}
