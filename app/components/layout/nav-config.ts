import type { View } from "../../lib/types";
import {
  LayoutDashboard, ScanSearch, History, Users, Disc3, Music2, Building2,
  Activity, KeyRound, Download, HeartPulse, Settings2, Telescope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavLeaf {
  view: View;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  section: string;
  items: NavLeaf[];
}

/**
 * The full target IA groups items as Overview / Catalog / Analytics / Tools / System.
 * Only items with a real, working destination today are listed — new sections/items
 * are added here as their pages land in later phases (Dashboard charts, Ocean
 * Analyzer, dedicated Distributor Database, etc.), never as placeholders.
 */
export const NAV: NavSection[] = [
  {
    section: "Overview",
    items: [
      { view: "lookup", label: "Dashboard", icon: LayoutDashboard },
      { view: "lookup", label: "Analyze URL", icon: ScanSearch },
      { view: "history", label: "Recent Analyses", icon: History },
    ],
  },
  {
    section: "Catalog",
    items: [
      { view: "artists", label: "Artists", icon: Users },
      { view: "albums", label: "Releases", icon: Disc3 },
      { view: "tracks", label: "Tracks", icon: Music2 },
      { view: "distributors", label: "Distributor Database", icon: Building2 },
    ],
  },
  {
    section: "Analytics",
    items: [{ view: "analytics", label: "Performance", icon: Activity }],
  },
  {
    section: "Tools",
    items: [
      { view: "analyzer", label: "Ocean Analyzer", icon: Telescope },
      { view: "uuid", label: "UUID Database", icon: KeyRound },
      { view: "reports", label: "Export Center", icon: Download },
    ],
  },
  {
    section: "System",
    items: [
      { view: "status", label: "API Status", icon: HeartPulse },
      { view: "settings", label: "Settings", icon: Settings2 },
    ],
  },
];

export const VIEW_TITLE: Record<View, string> = {
  lookup: "Dashboard",
  history: "Recent Analyses",
  uuid: "UUID Database",
  distributors: "Distributor Database",
  artists: "Artists",
  albums: "Releases",
  tracks: "Tracks",
  analytics: "Performance",
  reports: "Export Center",
  analyzer: "Ocean Analyzer",
  status: "API Status",
  settings: "Settings",
};

export const VIEW_SECTION: Record<View, string> = {
  lookup: "Overview",
  history: "Overview",
  uuid: "Tools",
  distributors: "Catalog",
  artists: "Catalog",
  albums: "Catalog",
  tracks: "Catalog",
  analytics: "Analytics",
  reports: "Tools",
  analyzer: "Tools",
  status: "System",
  settings: "System",
};
