"use client";

import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { Panel } from "../shared/Card";
import { CensoredValue } from "../shared/CensoredValue";
import { useIsAdmin } from "../providers/AdminProvider";
import { cn } from "../../lib/cn";
import type { AnalyzerDistributor } from "@core/analyzer/service";

const STATUS_META: Record<AnalyzerDistributor["status"], { label: string; tone: string; icon: typeof CheckCircle2; desc: string }> = {
  verified: { label: "Matched", tone: "text-success", icon: CheckCircle2, desc: "The licensor UUID exactly matched a canonical distributor record." },
  uuid_not_mapped: { label: "UUID not in database", tone: "text-warning", icon: HelpCircle, desc: "A licensor UUID was captured, but it has no entry in the mapping yet." },
  uuid_unavailable: { label: "No UUID captured", tone: "text-foreground-muted", icon: HelpCircle, desc: "The public Spotify API does not expose this value — resolve via the Spotify connector." },
  invalid_uuid: { label: "Invalid UUID", tone: "text-danger", icon: XCircle, desc: "The captured value was not a well-formed licensor UUID." },
  conflict: { label: "Conflicting mapping", tone: "text-danger", icon: XCircle, desc: "This UUID maps to more than one distributor name in the mapping file." },
};

/**
 * Distributor detection is exact licensor-UUID matching, never a probabilistic
 * guess — this shows a binary matched/not-matched state, not a fake confidence %.
 */
export function DetectionConfidence({ distributor }: { distributor: AnalyzerDistributor }) {
  const meta = STATUS_META[distributor.status];
  const Icon = meta.icon;
  const isAdmin = useIsAdmin();
  return (
    <Panel title="Distributor Detection" description="Exact licensor-UUID match — never inferred from label or title">
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-6 shrink-0", meta.tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", meta.tone)}>{meta.label}</p>
          <p className="mt-0.5 text-xs text-foreground-secondary">{meta.desc}</p>
          {distributor.name && <p className="mt-3 text-lg font-semibold text-foreground">{distributor.name}</p>}
          {distributor.licensorUuid && (
            <div className="mt-2 flex items-center gap-1.5">
              <CensoredValue value={distributor.licensorUuid} isAdmin={isAdmin} copyLabel="" />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
