"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Crown, Lock, Mail } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

const FEATURES = [
  "Full artist catalogues, including releases removed from the profile",
  "Release and track databases with distributor history",
  "The distributor database with every mapped licensor",
];

/**
 * Shown when a customer opens a VIP-only section. It states plainly what the
 * plan unlocks and how to get it — no payment flow inside the app, because
 * plans are arranged with the administrator directly.
 */
export function VipDialog({ open, onOpenChange, feature }: { open: boolean; onOpenChange: (open: boolean) => void; feature?: string | null }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-modal w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border-strong bg-card p-6 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-warning/30 bg-warning/10">
            <Crown className="size-5 text-warning" aria-hidden />
          </div>

          <Dialog.Title className="text-[16px] font-semibold tracking-tight text-foreground">
            {feature ? `${feature} is part of the VIP plan` : "This section is part of the VIP plan"}
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-foreground-secondary">
            Contact the administrator to purchase the VIP plan and unlock it on this key.
          </Dialog.Description>

          <ul className="mt-4 space-y-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[12.5px] text-foreground-secondary">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                {f}
              </li>
            ))}
          </ul>

          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" size="sm" icon={<Mail className="size-3.5" aria-hidden />} onClick={() => onOpenChange(false)}>
              Contact the administrator
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Not now</Button>
            </Dialog.Close>
          </div>

          <p className="mt-3 text-[11px] text-foreground-muted">
            Track, release and playlist analysis stay available on your current plan.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
