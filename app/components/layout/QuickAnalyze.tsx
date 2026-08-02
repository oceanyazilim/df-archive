"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Sparkles, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../shared/Button";

/**
 * Quick-analyze entry point reachable from every page (top-right). Opens a
 * compact popover with the same `onAnalyze` used by the dashboard hero input —
 * Phase 4 swaps this inner input for the shared `SpotifyUrlInput` compact variant.
 */
export function QuickAnalyze({ onAnalyze, running }: { onAnalyze: (input: string) => void; running: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function submit() {
    const v = value.trim();
    if (!v || running) return;
    onAnalyze(v);
    setOpen(false);
    setValue("");
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="primary" size="sm" icon={<Sparkles className="size-3.5" aria-hidden />}>
          Quick analyze
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={10}
          className={cn(
            "z-dropdown w-[380px] rounded-md border border-border-strong bg-card-elevated p-3 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary">Analyze a Spotify URL</span>
            <PopoverPrimitive.Close asChild>
              <button aria-label="Close" className="text-foreground-muted hover:text-foreground">
                <X className="size-3.5" aria-hidden />
              </button>
            </PopoverPrimitive.Close>
          </div>
          <div className="flex items-center gap-1.5 rounded-sm border border-border-strong bg-input px-2.5 focus-within:border-accent/50">
            <input
              autoFocus
              value={value}
              disabled={running}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Track, album, or artist URL…"
              className="h-9 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted disabled:opacity-60"
            />
            <Button variant="primary" size="sm" onClick={submit} disabled={!value.trim()} loading={running}>
              Analyze
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
