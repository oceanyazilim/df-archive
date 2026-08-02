"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Sparkles, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../shared/Button";
import { SpotifyUrlInput } from "../analyzer/SpotifyUrlInput";

/** Quick-analyze entry point reachable from every page (top-right nav). */
export function QuickAnalyze({ onAnalyze, running }: { onAnalyze: (input: string) => void; running: boolean }) {
  const [open, setOpen] = useState(false);

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
            "z-dropdown w-[400px] rounded-md border border-border-strong bg-card-elevated p-3 shadow-lg",
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
          <SpotifyUrlInput variant="compact" running={running} onAnalyze={(v) => { onAnalyze(v); setOpen(false); }} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
