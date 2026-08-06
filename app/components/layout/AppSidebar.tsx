"use client";

import { motion, useReducedMotion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../../lib/cn";
import type { View, Health } from "../../lib/types";
import { BrandLogo } from "../BrandLogo";
import { NAV } from "./nav-config";
import { NavItem } from "./NavItem";
import { SystemStatusCard } from "./SystemStatusCard";
import { UserMenu } from "./UserMenu";
import { useIsAdmin } from "../providers/AdminProvider";

export interface AppSidebarProps {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawerOpen: boolean;
  health: Health | null;
  lastHealthAt: number | null;
  /** A customer clicked a VIP-locked section. */
  onLocked: (label: string) => void;
}

export function AppSidebar({ view, onNavigate, collapsed, onToggleCollapsed, drawerOpen, health, lastHealthAt, onLocked }: AppSidebarProps) {
  const reduced = useReducedMotion();
  const isAdmin = useIsAdmin();
  // Customers never see operator tools; VIP items stay visible but locked, so
  // they can tell what the plan adds instead of guessing.
  const nav = NAV
    .map((group) => ({ ...group, items: group.items.filter((item) => item.access !== "admin" || isAdmin) }))
    .filter((group) => group.items.length > 0);
  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 264 }}
      transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 0.8, 0.36, 1] }}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full shrink-0 flex-col border-r border-border-subtle bg-sidebar",
        "max-lg:transition-transform max-lg:duration-base max-lg:ease-out",
        "max-lg:-translate-x-full",
        drawerOpen && "max-lg:translate-x-0"
      )}
    >
      {/* Logo only in the top-left brand row — no wordmark, no badge text. */}
      <div className={cn("flex items-center px-4 pb-3 pt-4", collapsed && "justify-center px-0")}>
        <BrandLogo variant={collapsed ? "collapsedSidebar" : "sidebar"} />
      </div>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "mx-3 mb-2 flex min-h-11 items-center gap-2 rounded-sm px-2.5 py-1.5 text-[11.5px] font-medium text-foreground-muted transition-colors hover:bg-card-hover hover:text-foreground-secondary",
          collapsed && "mx-auto justify-center px-1.5"
        )}
      >
        {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <><PanelLeftClose className="size-4" aria-hidden /> Collapse</>}
      </button>

      <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-2">
        {nav.map((group) => (
          <div key={group.section}>
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground-muted">
                {group.section}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const locked = item.access === "vip" && !isAdmin;
                return (
                  <NavItem
                    key={`${group.section}-${item.label}`}
                    item={item}
                    active={view === item.view}
                    collapsed={collapsed}
                    locked={locked}
                    onClick={() => (locked ? onLocked(item.label) : onNavigate(item.view))}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Service diagnostics are an operator concern — a customer only needs
          to know the app works, and it tells them when it does not. */}
      {isAdmin && <SystemStatusCard health={health} lastHealthAt={lastHealthAt} collapsed={collapsed} />}
      <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
    </motion.aside>
  );
}
