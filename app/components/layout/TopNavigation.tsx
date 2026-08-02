"use client";

import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Bell, Maximize, Menu, Minimize } from "lucide-react";
import { cn } from "../../lib/cn";
import type { Health, View } from "../../lib/types";
import { overallStatus } from "../../lib/types";
import { IconButton } from "../shared/IconButton";
import { EmptyState } from "../shared/EmptyState";
import { GlobalSearch } from "./GlobalSearch";
import { QuickAnalyze } from "./QuickAnalyze";
import { VIEW_SECTION, VIEW_TITLE } from "./nav-config";

export interface TopNavigationProps {
  view: View;
  onToggleSidebar: () => void;
  onAnalyze: (input: string) => void;
  running: boolean;
  health: Health | null;
  onNavigate: (v: View) => void;
}

function useFullscreen() {
  const [fs, setFs] = useState(false);
  const toggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setFs(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setFs(false)).catch(() => {});
    }
  };
  return { fs, toggle };
}

export function TopNavigation({ view, onToggleSidebar, onAnalyze, running, health, onNavigate }: TopNavigationProps) {
  const st = overallStatus(health);
  const { fs, toggle } = useFullscreen();

  return (
    <header className="sticky top-0 z-topbar flex h-header shrink-0 items-center gap-3 border-b border-border-subtle bg-header px-4 backdrop-blur-md sm:px-6">
      <IconButton label="Toggle sidebar" icon={<Menu className="size-4" aria-hidden />} variant="ghost" size="lg" onClick={onToggleSidebar} className="lg:size-8" />

      <div className="min-w-0 shrink-0">
        <nav aria-label="Breadcrumb" className="text-[10.5px] text-foreground-muted">{VIEW_SECTION[view]}</nav>
        <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground">{VIEW_TITLE[view]}</h1>
      </div>

      <div className="flex flex-1 justify-center px-2">
        <GlobalSearch onOpenDistributors={() => onNavigate("distributors")} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <QuickAnalyze onAnalyze={onAnalyze} running={running} />

        <span
          className={cn(
            "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium md:inline-flex",
            st.cls === "ok" ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"
          )}
          title="Overall system status"
        >
          <span className={cn("size-1.5 rounded-full bg-current")} aria-hidden />
          {st.label}
        </span>

        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <IconButton label="Notifications" icon={<Bell className="size-4" aria-hidden />} variant="ghost" />
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              align="end"
              sideOffset={10}
              className={cn(
                "z-dropdown w-[300px] rounded-md border border-border-strong bg-card-elevated p-3 shadow-lg",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
              )}
            >
              <p className="mb-2 text-xs font-medium text-foreground-secondary">Notifications</p>
              <EmptyState title="No notifications yet" description="Distributor mapping conflicts and analysis alerts will show up here." />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>

        <IconButton
          label={fs ? "Exit fullscreen" : "Fullscreen"}
          icon={fs ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          variant="ghost"
          className="hidden sm:inline-flex"
          onClick={toggle}
        />
      </div>
    </header>
  );
}
