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

export interface AppSidebarProps {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawerOpen: boolean;
  health: Health | null;
  lastHealthAt: number | null;
}

export function AppSidebar({ view, onNavigate, collapsed, onToggleCollapsed, drawerOpen, health, lastHealthAt }: AppSidebarProps) {
  const reduced = useReducedMotion();
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
      <div className={cn("flex items-center gap-2 px-4 pb-3 pt-4", collapsed && "justify-center px-0")}>
        <div className="min-w-0 flex-1">
          <BrandLogo variant={collapsed ? "collapsedSidebar" : "sidebar"} />
        </div>
        {!collapsed && (
          <span className="shrink-0 rounded-full border border-border-strong bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
            Analyzer v4
          </span>
        )}
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
        {NAV.map((group) => (
          <div key={group.section}>
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground-muted">
                {group.section}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={`${group.section}-${item.label}`}
                  item={item}
                  active={view === item.view}
                  collapsed={collapsed}
                  onClick={() => onNavigate(item.view)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <SystemStatusCard health={health} lastHealthAt={lastHealthAt} collapsed={collapsed} />
      <UserMenu collapsed={collapsed} onNavigate={onNavigate} />
    </motion.aside>
  );
}
