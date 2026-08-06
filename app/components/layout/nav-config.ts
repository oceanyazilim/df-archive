import type { View } from "../../lib/types";
import {
  LayoutDashboard, ScanSearch, History, Users, Disc3, Music2, Building2,
  Activity, KeyRound, Download, HeartPulse, Settings2, Telescope,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Who may reach an item:
 *   all   — everyone with a licensed copy.
 *   vip   — customers SEE it (so they know it exists) but it is locked; the
 *           lock explains how to get it. Admins use it normally.
 *   admin — operator surfaces: hidden entirely from customers.
 */
export type NavAccess = "all" | "vip" | "admin";

export interface NavLeaf {
  view: View;
  label: string;
  icon: LucideIcon;
  access?: NavAccess;
}

export interface NavSection {
  section: string;
  items: NavLeaf[];
}

/**
 * The full target IA groups items as Overview / Catalog / Analytics / Tools / System.
 * Only items with a real, working destination are listed — new sections/items
 * are added here as their pages land, never as placeholders.
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
      { view: "artists", label: "Artists", icon: Users, access: "vip" },
      { view: "albums", label: "Releases", icon: Disc3, access: "vip" },
      { view: "tracks", label: "Tracks", icon: Music2, access: "vip" },
      { view: "distributors", label: "Distributor Database", icon: Building2, access: "vip" },
    ],
  },
  {
    section: "Analytics",
    items: [{ view: "analytics", label: "Performance", icon: Activity }],
  },
  {
    section: "Tools",
    items: [
      { view: "analyzer", label: "Ocean Analyzer", icon: Telescope, access: "admin" },
      { view: "uuid", label: "UUID Database", icon: KeyRound, access: "admin" },
      { view: "reports", label: "Export Center", icon: Download, access: "admin" },
    ],
  },
  {
    section: "System",
    items: [
      { view: "status", label: "API Status", icon: HeartPulse, access: "admin" },
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
  analyzer: "Ocean Analyzer",
  status: "System",
  settings: "System",
};

/** Views a customer must never land on, however they got there. */
export const ADMIN_ONLY_VIEWS: View[] = NAV
  .flatMap((s) => s.items)
  .filter((i) => i.access === "admin")
  .map((i) => i.view);

/** Views a customer sees but cannot open without the VIP plan. */
export const VIP_VIEWS: View[] = NAV
  .flatMap((s) => s.items)
  .filter((i) => i.access === "vip")
  .map((i) => i.view);
