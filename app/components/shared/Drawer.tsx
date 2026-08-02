"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { IconButton } from "./IconButton";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Roughly matches the 480-560px right-side-drawer spec; overridable per use case. */
  width?: number;
}

/** Right-side details drawer used for releases and distributors. Radix Dialog underneath for focus-trap/escape/aria. */
export function Drawer({ open, onOpenChange, title, subtitle, actions, children, width = 520 }: DrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-drawer bg-black/55",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        />
        <DialogPrimitive.Content
          style={{ width, maxWidth: "92vw" }}
          className={cn(
            "fixed inset-y-0 right-0 z-drawer flex h-full flex-col border-l border-border-strong bg-sidebar shadow-lg focus:outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:duration-200 data-[state=open]:duration-300",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground">{title}</DialogPrimitive.Title>
              {subtitle && <DialogPrimitive.Description className="mt-0.5 truncate text-xs text-foreground-secondary">{subtitle}</DialogPrimitive.Description>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              <DialogPrimitive.Close asChild>
                <IconButton label="Close" icon={<X className="size-4" aria-hidden />} variant="ghost" size="lg" className="lg:size-8" />
              </DialogPrimitive.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
