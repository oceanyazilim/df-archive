import { Panel } from "../shared/Card";
import type { MetadataHealthCategory } from "../../lib/aggregate";
import { cn } from "../../lib/cn";

const SEVERITY_DOT: Record<MetadataHealthCategory["severity"], string> = {
  info: "bg-foreground-muted",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function MetadataHealth({ healthyPct, categories, onFilter }: { healthyPct: number; categories: MetadataHealthCategory[]; onFilter?: (key: string) => void }) {
  return (
    <Panel
      title="Metadata Health"
      description={`${healthyPct}% healthy across this catalog`}
    >
      <div className="space-y-1">
        {categories.map((c) => {
          const Tag = onFilter && c.count ? "button" : "div";
          return (
            <Tag
              key={c.key}
              onClick={onFilter && c.count ? () => onFilter(c.key) : undefined}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-1.5 py-1.5 text-left text-[13px]",
                onFilter && c.count && "transition-colors hover:bg-card-hover"
              )}
            >
              <span className="flex items-center gap-2 text-foreground-secondary">
                <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[c.severity])} aria-hidden />
                {c.label}
              </span>
              {c.count === null ? (
                <span className="text-[11px] text-foreground-muted" title={c.note}>—</span>
              ) : (
                <span className={cn("tabular-nums font-medium", c.count > 0 ? "text-foreground" : "text-foreground-muted")}>{c.count}</span>
              )}
            </Tag>
          );
        })}
      </div>
    </Panel>
  );
}
