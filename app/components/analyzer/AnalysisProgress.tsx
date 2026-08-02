"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../../lib/cn";
import { AnalysisStage } from "./AnalysisStage";

export interface AnalysisProgressProps {
  stages: string[];
  /** Index of the currently active stage. Stages before it are "done", after are "pending". */
  currentStep: number;
  className?: string;
}

function useElapsed() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setMs(Date.now() - start), 200);
    return () => clearInterval(t);
  }, []);
  return ms;
}

const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * The Ocean Analyzer loading experience: a circular progress ring with a slow
 * decorative orbit, a live stage checklist, and a scanning metadata-card
 * skeleton — communicates real staged work rather than a bare spinner.
 */
export function AnalysisProgress({ stages, currentStep, className }: AnalysisProgressProps) {
  const reduced = useReducedMotion();
  const elapsedMs = useElapsed();
  const clamped = Math.min(currentStep, stages.length);
  const percent = Math.round((clamped / stages.length) * 100);
  const offset = CIRCUMFERENCE * (1 - percent / 100);
  const activeLabel = stages[Math.min(currentStep, stages.length - 1)];

  return (
    <div className={cn("rounded-lg border border-border-strong bg-card p-6", className)}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
        {/* Circular ocean pulse + orbit */}
        <div className="relative flex size-32 shrink-0 items-center justify-center">
          {!reduced && (
            <motion.div
              className="absolute inset-0 rounded-full border border-dashed border-accent/25"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            />
          )}
          <svg viewBox="0 0 96 96" className="size-24 -rotate-90">
            <circle cx="48" cy="48" r={R} fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
            <circle
              cx="48"
              cy="48"
              r={R}
              fill="none"
              stroke="url(#ocean-progress-gradient)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: reduced ? undefined : "stroke-dashoffset 0.4s var(--ease-out)" }}
            />
            <defs>
              <linearGradient id="ocean-progress-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#39BDF8" />
                <stop offset="100%" stopColor="#1578FF" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-xl font-semibold tabular-nums text-foreground">{percent}%</span>
            <span className="text-[10px] text-foreground-muted">{(elapsedMs / 1000).toFixed(1)}s</span>
          </div>
        </div>

        {/* Stage checklist */}
        <div className="min-w-0 flex-1">
          <p className="mb-3 text-sm font-medium text-foreground" aria-live="polite" role="status">
            {activeLabel}…
          </p>
          <div className="space-y-2">
            {stages.map((label, i) => (
              <AnalysisStage key={label} label={label} state={i < clamped ? "done" : i === clamped ? "active" : "pending"} />
            ))}
          </div>
        </div>
      </div>

      {/* Scanning metadata-card skeleton */}
      <div className="relative mt-6 overflow-hidden rounded-md border border-border-subtle bg-card-elevated p-3">
        {!reduced && (
          <div className="pointer-events-none absolute top-0 h-full w-10 animate-scan-line bg-gradient-to-r from-transparent via-accent/30 to-transparent" aria-hidden />
        )}
        <div className="flex items-center gap-3">
          <div className="size-10 shrink-0 rounded bg-[linear-gradient(90deg,var(--surface-raised)_25%,var(--skeleton-hi)_50%,var(--surface-raised)_75%)] bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-2/3 rounded bg-[linear-gradient(90deg,var(--surface-raised)_25%,var(--skeleton-hi)_50%,var(--surface-raised)_75%)] bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none" />
            <div className="h-2.5 w-1/3 rounded bg-[linear-gradient(90deg,var(--surface-raised)_25%,var(--skeleton-hi)_50%,var(--surface-raised)_75%)] bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
