"use client";

import { BrandLogo } from "./BrandLogo";
import { View, Health, overallStatus } from "../lib/types";

const ICON: Record<View, React.ReactNode> = {
  lookup: <path d="M11 4a7 7 0 1 0 4.9 12l4.1 4.1M11 4a7 7 0 0 1 7 7" />,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  uuid: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" /></>,
  distributors: <><path d="M3 7h13v10H3zM16 10h4l1 3v4h-5" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="17.5" cy="17" r="1.6" /></>,
  artists: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-3.6 4.2-5.5 8-5.5s6.8 1.9 8 5.5" /></>,
  albums: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" /></>,
  tracks: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  analytics: <path d="M4 19V11M10 19V5M16 19v-6M21 19H3" />,
  reports: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 12h6M9 16h6" /></>,
  status: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-4L10 5a7 7 0 0 0-1.7 1L6 5 4 8.4 6 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.9h4l.5-2.9a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z" /></>,
};

const NavIco = ({ v }: { v: View }) => (
  <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[v]}</svg>
);

const NAV: { section: string; items: { id: View; label: string }[] }[] = [
  { section: "Main", items: [{ id: "lookup", label: "Track Lookup" }, { id: "history", label: "Lookup History" }] },
  {
    section: "Data",
    items: [
      { id: "uuid", label: "UUID Directory" }, { id: "distributors", label: "Distributors" },
      { id: "artists", label: "Artists" }, { id: "albums", label: "Albums" }, { id: "tracks", label: "Tracks" },
    ],
  },
  { section: "Analytics", items: [{ id: "analytics", label: "Streaming Analytics" }, { id: "reports", label: "Reports" }] },
  { section: "System", items: [{ id: "status", label: "System Status" }, { id: "settings", label: "Settings" }] },
];

export function Sidebar({ view, onNavigate, collapsed, drawerOpen, health }: {
  view: View; onNavigate: (v: View) => void; collapsed: boolean; drawerOpen: boolean; health: Health | null;
}) {
  const st = overallStatus(health);
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${drawerOpen ? "drawer-open" : ""}`}>
      <div className="brand"><BrandLogo variant={collapsed ? "collapsedSidebar" : "sidebar"} /></div>
      <nav style={{ overflowY: "auto", overflowX: "hidden", flex: 1, display: "flex", flexDirection: "column", gap: 2 }} aria-label="Main navigation">
        {NAV.map((g) => (
          <div key={g.section}>
            <div className="nav-section">{collapsed ? " " : g.section}</div>
            {g.items.map((it) => (
              <button key={it.id} className={`nav-item ${view === it.id ? "active" : ""}`}
                onClick={() => onNavigate(it.id)} title={it.label} aria-label={it.label} aria-current={view === it.id}>
                <NavIco v={it.id} /><span>{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      {!collapsed && (
        <div className="side-status">
          <div className="side-line"><span className={`led ${st.cls}`} />{st.label}</div>
          <div className="side-line" style={{ color: "var(--text-muted)" }}>Environment · development</div>
          <div className="side-line" style={{ color: "var(--text-muted)" }}>Version 1.0.0</div>
        </div>
      )}
    </aside>
  );
}
