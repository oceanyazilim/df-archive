"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, RotateCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

export interface ErrorStateProps {
  title: string;
  message: string;
  /** Raw error code/detail shown only inside a collapsible section — never surfaced as the primary message. */
  technicalDetail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * A complete, specific error explanation — never a generic "Something went wrong."
 * Technical detail (error codes, raw messages) is opt-in via a disclosure, per the
 * product rule that end users see plain language first.
 */
export function ErrorState({ title, message, technicalDetail, onRetry, retryLabel = "Try again", className }: ErrorStateProps) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-danger/25 bg-danger/5 px-6 py-11 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-lg border border-danger/30 bg-danger/10 text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-xs text-foreground-secondary">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RotateCw className="size-3.5" aria-hidden />} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {technicalDetail && (
        <div className="w-full max-w-sm pt-1 text-left">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="mx-auto flex items-center gap-1 text-[11px] text-foreground-muted hover:text-foreground-secondary"
            aria-expanded={showDetail}
          >
            <ChevronDown className={cn("size-3 transition-transform duration-fast", showDetail && "rotate-180")} aria-hidden />
            Technical details
          </button>
          {showDetail && (
            <pre className="mt-2 max-h-32 overflow-auto rounded border border-border-strong bg-input p-2.5 text-[11px] text-foreground-muted whitespace-pre-wrap break-words font-mono">
              {technicalDetail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
