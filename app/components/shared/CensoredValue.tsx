"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { CopyButton } from "./CopyButton";

export interface CensoredValueProps {
  value: string | null | undefined;
  isAdmin: boolean;
  copyLabel?: string;
  className?: string;
}

/**
 * Renders a real UUID (with copy) for admins. For everyone else, a masked
 * block with a lock icon — the raw value never reaches the DOM at all for
 * non-admins. Clicking it explains who to contact instead of exposing it.
 */
export function CensoredValue({ value, isAdmin, copyLabel = "Copy", className }: CensoredValueProps) {
  const [open, setOpen] = useState(false);

  if (isAdmin) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <code className="font-mono text-[11.5px] text-foreground-secondary">{value ?? "—"}</code>
        {value && <CopyButton value={value} label={copyLabel} />}
      </span>
    );
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-card-elevated px-2 py-0.5 font-mono text-[11.5px] text-foreground-muted transition-colors hover:bg-card-hover",
            className
          )}
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          ••••••••••••
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={6}
          className={cn(
            "z-tooltip max-w-[220px] rounded-sm border border-border-strong bg-card-elevated px-3 py-2 text-xs text-foreground-secondary shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        >
          Contact the admin of this website for access to this information.
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
