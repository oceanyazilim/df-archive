"use client";

import { motion } from "framer-motion";
import { cn } from "../../lib/cn";
import { Tooltip } from "../shared/Tooltip";
import type { NavLeaf } from "./nav-config";

export interface NavItemProps {
  item: NavLeaf;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

export function NavItem({ item, active, collapsed, onClick }: NavItemProps) {
  const Icon = item.icon;
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      aria-label={item.label}
      className={cn(
        "group relative flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] font-medium transition-colors duration-fast ease-out",
        collapsed && "justify-center px-0",
        active ? "text-foreground bg-gradient-to-r from-accent-dim to-transparent" : "text-foreground-secondary hover:bg-card-hover hover:text-foreground"
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active-indicator"
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon className={cn("size-4 shrink-0 transition-colors", active ? "text-accent" : "text-foreground-muted group-hover:text-foreground-secondary")} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} side="right">
        {button}
      </Tooltip>
    );
  }
  return button;
}
