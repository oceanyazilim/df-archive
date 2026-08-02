import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Card } from "./Card";

export type StatTone = "default" | "success" | "warning" | "danger" | "accent";

const toneValueClass: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  accent: "text-accent",
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  sparkline?: ReactNode;
  className?: string;
}

/** The generic KPI tile used across the dashboard, release table, and distributor pages. */
export function StatCard({ label, value, sub, icon, tone = "default", sparkline, className }: StatCardProps) {
  return (
    <Card hoverable className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{label}</span>
        {icon && <span className="text-foreground-muted">{icon}</span>}
      </div>
      <div className={cn("mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums", toneValueClass[tone])}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-foreground-secondary">{sub}</div>}
      {sparkline && <div className="mt-3">{sparkline}</div>}
    </Card>
  );
}
