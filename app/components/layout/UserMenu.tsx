"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, HeartPulse, Lock, LogOut, MoreHorizontal, Settings2, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import type { View } from "../../lib/types";
import { useAdmin } from "../providers/AdminProvider";
import { AdminLoginDialog } from "../shared/AdminLoginDialog";

const menuItemClass =
  "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] text-foreground-secondary outline-none transition-colors hover:bg-card-hover hover:text-foreground focus-visible:bg-card-hover";

export function UserMenu({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: (v: View) => void }) {
  const { isAdmin, logout } = useAdmin();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className={cn("flex items-center gap-2.5 border-t border-border-subtle px-3 py-3", collapsed && "justify-center px-0")}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong bg-gradient-to-br from-accent to-accent-secondary text-[11px] font-bold text-[var(--on-accent)]">
        OD
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground">Virus Records</div>
          <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
            <span className="truncate">Local workspace</span>
            <span className="shrink-0 rounded-full border border-border-strong bg-card-elevated px-1.5 py-px text-[9.5px] font-medium">Analyzer v4</span>
          </div>
        </div>
      )}
      {!collapsed && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label="More options" className="flex size-7 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-card-hover hover:text-foreground">
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="end"
              sideOffset={8}
              className={cn(
                "z-dropdown min-w-[200px] rounded-md border border-border-strong bg-card-elevated p-1 shadow-lg",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
              )}
            >
              <DropdownMenu.Item asChild>
                <button className={menuItemClass} onClick={() => onNavigate("settings")}>
                  <Settings2 className="size-4" aria-hidden /> Settings
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <button className={menuItemClass} onClick={() => onNavigate("status")}>
                  <HeartPulse className="size-4" aria-hidden /> API status
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <button className={menuItemClass} onClick={() => onNavigate("reports")}>
                  <Download className="size-4" aria-hidden /> Export center
                </button>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              {isAdmin ? (
                <DropdownMenu.Item asChild>
                  <button className={menuItemClass} onClick={() => logout()}>
                    <LogOut className="size-4" aria-hidden /> Sign out of admin
                  </button>
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
                  <button className={menuItemClass} onClick={() => setLoginOpen(true)}>
                    <Lock className="size-4" aria-hidden /> Admin sign-in
                  </button>
                </DropdownMenu.Item>
              )}
              {isAdmin && (
                <div className={cn(menuItemClass, "pointer-events-none text-success")}>
                  <ShieldCheck className="size-4" aria-hidden /> Admin session active
                </div>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <AdminLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
