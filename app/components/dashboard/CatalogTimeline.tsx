import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { History } from "lucide-react";
import type { TimelineEntry } from "../../lib/aggregate";
import { cn } from "../../lib/cn";

const DOT_CLASS: Record<TimelineEntry["kind"], string> = {
  first: "bg-accent-secondary border-accent-secondary/40",
  release: "bg-foreground-muted border-border-strong",
  latest: "bg-success border-success/40",
};

export function CatalogTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <Panel title="Catalog Timeline" description="First release through most recent">
      {entries.length === 0 ? (
        <EmptyState icon={<History className="size-5" aria-hidden />} title="No timeline data yet" />
      ) : (
        <ol className="space-y-0">
          {entries.map((e, i) => (
            <li key={`${e.date}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
              {i < entries.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-border-subtle" aria-hidden />}
              <span className={cn("relative z-10 mt-1 size-[11px] shrink-0 rounded-full border-2", DOT_CLASS[e.kind])} aria-hidden />
              <div className="min-w-0 pb-0.5">
                <p className="truncate text-[13px] font-medium text-foreground">{e.label}</p>
                <p className="text-[11.5px] text-foreground-muted">
                  {e.sub}
                  {e.kind === "first" && " · First release"}
                  {e.kind === "latest" && " · Most recent"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
