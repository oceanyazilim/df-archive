"use client";

import { Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export type StageState = "pending" | "active" | "done";

export function AnalysisStage({ label, state }: { label: string; state: StageState }) {
  return (
    <div className={cn("flex items-center gap-2.5 text-[13px]", state === "pending" ? "text-foreground-muted" : "text-foreground-secondary")}>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-base",
          state === "done" && "border-success/40 bg-success/15 text-success",
          state === "active" && "border-accent/40 bg-accent/15 text-accent",
          state === "pending" && "border-border-strong bg-transparent text-transparent"
        )}
      >
        {state === "done" && <Check className="size-3" aria-hidden />}
        {state === "active" && <Loader2 className="size-3 animate-spin" aria-hidden />}
      </span>
      <span className={state === "active" ? "font-medium text-foreground" : undefined}>{label}</span>
    </div>
  );
}
