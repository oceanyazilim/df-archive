"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { useAdmin } from "../providers/AdminProvider";

export function AdminLoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { login } = useAdmin();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    const ok = await login(password);
    setLoading(false);
    if (ok) {
      setPassword("");
      onOpenChange(false);
    } else {
      setError("Incorrect password.");
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) { setPassword(""); setError(null); }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-modal bg-black/60",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-modal w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-card-elevated p-5 shadow-lg focus:outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Lock className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-sm font-semibold text-foreground">Admin sign-in</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-xs text-foreground-secondary">
                Unlocks UUIDs, lookup history, and the header search.
              </DialogPrimitive.Description>
            </div>
          </div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            className="mt-4 h-9 w-full rounded-sm border border-border-strong bg-input px-2.5 text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
          />
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </DialogPrimitive.Close>
            <Button variant="primary" size="sm" loading={loading} onClick={submit} disabled={!password}>
              Sign in
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
