"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Building2 } from "lucide-react";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { CHART_COLORS, tooltipContentStyle } from "./chartTheme";

export interface DistributorSlice {
  name: string;
  count: number;
}

interface SliceTooltipProps { active?: boolean; payload?: { name: string; value: number; color: string }[] }

function SliceTooltip({ active, payload }: SliceTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={tooltipContentStyle} className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: p.color }} />
        {p.name}: <span className="font-medium tabular-nums">{p.value}</span> tracks
      </div>
    </div>
  );
}

/**
 * Distribution of resolved distributors across the catalog. Requires bulk
 * distributor resolution to have run (the connector-based per-track lookup) —
 * shown as an honest empty state until then rather than fabricated data.
 */
export function DistributorBreakdown({ data }: { data?: DistributorSlice[] }) {
  const total = data?.reduce((s, d) => s + d.count, 0) ?? 0;

  return (
    <Panel title="Distributor Distribution" description="Share of the catalog by resolved distributor">
      {!data || data.length === 0 || total === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" aria-hidden />}
          title="Resolve distributors to see breakdown"
          description="Run distributor resolution on this catalog (from the release table below) to populate this chart."
        />
      ) : (
        <div className="flex items-center gap-5">
          <div className="h-[200px] w-[200px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="count" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} stroke="none">
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<SliceTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {data.slice(0, 6).map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-[13px]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-foreground-secondary">{d.name}</span>
                <span className="shrink-0 tabular-nums text-foreground-muted">{Math.round((d.count / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
