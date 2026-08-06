"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "../shared/Card";
import { EmptyState } from "../shared/EmptyState";
import { BarChart3 } from "lucide-react";
import type { MonthBucket } from "../../lib/aggregate";
import { chartAxis, chartGrid, tooltipContentStyle, tooltipItemStyle, tooltipLabelStyle } from "./chartTheme";

const RANGES = [
  { key: "1y", label: "1Y", months: 12 },
  { key: "3y", label: "3Y", months: 36 },
  { key: "5y", label: "5Y", months: 60 },
  { key: "all", label: "All", months: Infinity },
] as const;

interface TooltipItem { dataKey: string; name: string; value: number; color: string }
interface ChartTooltipProps { active?: boolean; payload?: TooltipItem[]; label?: string }

function CustomTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipContentStyle} className="px-3 py-2">
      <div style={tooltipLabelStyle}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={tooltipItemStyle} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function CatalogActivityChart({ data }: { data: MonthBucket[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");

  const filtered = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months ?? Infinity;
    return months === Infinity ? data : data.slice(-months);
  }, [data, range]);

  return (
    <Panel
      title="Catalog Activity"
      description="Releases and tracks published over time"
      actions={
        <div className="flex gap-0.5 rounded-md border border-border-strong bg-card-elevated p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${range === r.key ? "bg-card-hover text-foreground" : "text-foreground-muted hover:text-foreground-secondary"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState icon={<BarChart3 className="size-5" aria-hidden />} title="No release-date data yet" description="Catalog activity appears once release dates are available for this artist." />
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filtered} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={chartGrid.stroke} vertical={false} />
              <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} {...chartAxis} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Bar dataKey="releases" name="Releases" fill="#4C8F1C" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Line dataKey="tracks" name="Tracks" stroke="#9CF04A" strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
