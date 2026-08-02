"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { Disc3 } from "lucide-react";
import type { ReleaseTypeCount } from "../../lib/aggregate";
import { CHART_COLORS, chartAxis, tooltipContentStyle } from "./chartTheme";

interface TypeTooltipProps { active?: boolean; payload?: { value: number; payload: { label: string } }[] }

function TypeTooltip({ active, payload }: TypeTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={tooltipContentStyle} className="px-3 py-2">
      {p.payload.label}: <span className="font-medium tabular-nums">{p.value}</span>
    </div>
  );
}

export function ReleaseTypeChart({ data }: { data: ReleaseTypeCount[] }) {
  return (
    <Panel title="Release Type Breakdown" description="Distinct releases by type">
      {data.length === 0 ? (
        <EmptyState icon={<Disc3 className="size-5" aria-hidden />} title="No releases yet" />
      ) : (
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis dataKey="label" type="category" width={92} {...chartAxis} />
              <Tooltip content={<TypeTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {data.map((d, i) => (
                  <Cell key={d.type} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
