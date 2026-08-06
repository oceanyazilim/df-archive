"use client";

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../shared/Tooltip";
import type { NavLeaf } from "./nav-config";

export interface NavItemProps {
  item: NavLeaf;
  active: boolean;
  collapsed: boolean;
  /** VIP item without the plan: shown, but it opens the upgrade notice. */
  locked?: boolean;
  onClick: () => void;
}

export function NavItem({ item, active, collapsed, locked, onClick }: NavItemProps) {
  const Icon = item.icon;
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      aria-label={locked ? `${item.label} — VIP plan required` : item.label}
      className={cn(
        "group relative flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] font-medium transition-colors duration-fast ease-out",
        collapsed && "justify-center px-0",
        active && !locked
          ? "text-foreground bg-gradient-to-r from-accent-dim to-transparent"
          : locked
            ? "text-foreground-muted hover:bg-card-hover hover:text-foreground-secondary"
            : "text-foreground-secondary hover:bg-card-hover hover:text-foreground",
        // The cursor is the first signal that this one is not available yet.
        locked && "cursor-not-allowed"
      )}
    >
      {active && !locked && (
        <motion.span
          layoutId="nav-active-indicator"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active && !locked ? "text-accent" : "text-foreground-muted group-hover:text-foreground-secondary",
          // On hover the icon itself turns into a padlock, so the state reads
          // even before the VIP pill is noticed.
          locked && "group-hover:hidden"
        )}
        aria-hidden
      />
      {locked && <Lock className="hidden size-4 shrink-0 text-warning group-hover:block" aria-hidden />}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && locked && (
        <span className="ml-auto shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-warning opacity-0 transition-opacity group-hover:opacity-100">
          VIP
        </span>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip content={locked ? `${item.label} · VIP` : item.label} side="right">
        {button}
      </Tooltip>
    );
  }
  return button;
}
