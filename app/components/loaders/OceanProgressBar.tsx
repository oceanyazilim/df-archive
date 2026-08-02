"use client";

import { cn } from "../../lib/cn";
import type { LoaderProgress } from "./types";

export interface OceanProgressBarProps {
  /** A real 0-100 number, or "indeterminate" when the backend gives no real percentage — never a fabricated value. */
  progress: LoaderProgress;
  stageLabel?: string;
  timeLabel?: string;
  className?: string;
}

/**
 * Determinate (real, clamped 0-100, animated width, never regresses within
 * one run — callers are responsible for only increasing it) or indeterminate
 * (an animated sliding segment, "Processing" instead of a fake percentage).
 */
export function OceanProgressBar({ progress, stageLabel, timeLabel, className }: OceanProgressBarProps) {
  const determinate = typeof progress === "number";
  const pct = determinate ? Math.min(100, Math.max(0, progress)) : null;

  return (
    <div className={cn("w-full", className)}>
      <div
        role="progressbar"
        aria-label={stageLabel ?? "Loading progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(pct!) : undefined}
        className="relative h-[6px] w-full overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.07)" }}
      >
        {determinate ? (
          <div
            className="relative h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, backgroundImage: "linear-gradient(90deg, #1578FF, #39BDF8)" }}
          >
            <span
              className="absolute inset-y-0 left-0 w-1/3 animate-progress-highlight motion-reduce:animate-none"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)" }}
              aria-hidden
            />
          </div>
        ) : (
          <span
            className="absolute inset-y-0 w-1/3 animate-progress-highlight motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-40"
            style={{ backgroundImage: "linear-gradient(90deg, #1578FF, #39BDF8)", borderRadius: 999 }}
            aria-hidden
          />
        )}
      </div>
      {(stageLabel || determinate || timeLabel) && (
        <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
          <span className="truncate text-foreground-secondary">{stageLabel}</span>
          <span className="shrink-0 tabular-nums text-foreground-muted">
            {determinate ? `${Math.round(pct!)}%` : "Processing"}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
