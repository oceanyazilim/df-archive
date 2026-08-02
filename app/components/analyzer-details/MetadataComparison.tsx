import { Check, Minus, X } from "lucide-react";
import type { AnalyzerResult } from "@core/analyzer/service";
import { Panel } from "../shared/Card";
import { cn } from "../../lib/cn";

type Status = "match" | "different" | "missing";

interface FieldRow {
  key: string;
  a: string;
  b: string;
  status: Status;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function diffFields(a: AnalyzerResult, b: AnalyzerResult): FieldRow[] {
  const ao = a as unknown as Record<string, unknown>;
  const bo = b as unknown as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(ao), ...Object.keys(bo)])).filter((k) => k !== "streams" && k !== "links" && k !== "topTracks" && k !== "tracks" && k !== "releases");
  return keys.map((key) => {
    const hasA = key in ao && ao[key] !== null && ao[key] !== undefined;
    const hasB = key in bo && bo[key] !== null && bo[key] !== undefined;
    const va = stringify(ao[key]);
    const vb = stringify(bo[key]);
    const status: Status = !hasA || !hasB ? "missing" : va === vb ? "match" : "different";
    return { key, a: va, b: vb, status };
  });
}

const STATUS_ICON: Record<Status, typeof Check> = { match: Check, different: X, missing: Minus };
const STATUS_CLASS: Record<Status, string> = { match: "text-success", different: "text-danger", missing: "text-foreground-muted" };

export interface MetadataComparisonProps {
  a: AnalyzerResult;
  b: AnalyzerResult;
  labelA: string;
  labelB: string;
}

export function MetadataComparison({ a, b, labelA, labelB }: MetadataComparisonProps) {
  const rows = diffFields(a, b);
  const differentCount = rows.filter((r) => r.status === "different").length;
  const missingCount = rows.filter((r) => r.status === "missing").length;

  return (
    <Panel
      title="Field Comparison"
      description={`${differentCount} different · ${missingCount} missing · ${rows.length - differentCount - missingCount} matching`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
              <th className="w-8 py-2" />
              <th className="py-2 pr-3 font-medium">Field</th>
              <th className="py-2 pr-3 font-medium">{labelA}</th>
              <th className="py-2 font-medium">{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = STATUS_ICON[r.status];
              return (
                <tr key={r.key} className={cn("border-b border-border-subtle last:border-0", r.status === "different" && "bg-danger/5")}>
                  <td className="py-2"><Icon className={cn("size-3.5", STATUS_CLASS[r.status])} aria-hidden /></td>
                  <td className="py-2 pr-3 font-mono text-[11.5px] text-foreground-secondary">{r.key}</td>
                  <td className="max-w-[220px] truncate py-2 pr-3 text-foreground" title={r.a}>{r.a}</td>
                  <td className="max-w-[220px] truncate py-2 text-foreground" title={r.b}>{r.b}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
