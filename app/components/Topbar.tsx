"use client";

import { useEffect, useRef, useState } from "react";
import { Health, overallStatus, View } from "../lib/types";

/**
 * Enterprise top header: sidebar toggle · global analyzer input (the primary
 * action of the product) · status pill · theme selector · settings · profile.
 */
export function Topbar({ onCollapse, onAnalyze, running, health, onNavigate }: {
  onCollapse: () => void;
  onAnalyze: (input: string) => void;
  running: boolean;
  health: Health | null;
  onNavigate: (v: View) => void;
}) {
  const [input, setInput] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const st = overallStatus(health);

  // Close the profile menu on outside click / Escape.
  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [profileOpen]);

  const submit = () => { if (input.trim() && !running) onAnalyze(input.trim()); };

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onCollapse} aria-label="Toggle sidebar" title="Toggle sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
      </button>

      {/* Global analyzer — the product's primary action, always reachable. */}
      <div className="global-analyzer" role="search">
        <svg className="ga-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M11 4a7 7 0 1 0 4.9 12l4.1 4.1M11 4a7 7 0 0 1 7 7" />
        </svg>
        <input
          type="text" value={input} disabled={running}
          placeholder="Spotify track / album / artist URL, ISRC, UPC or song UUID"
          aria-label="Analyze a music URL or identifier"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        {input && !running && (
          <button className="ga-clear" aria-label="Clear input" onClick={() => setInput("")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
        <button className="btn primary btn-sm ga-btn" onClick={submit} disabled={running || !input.trim()}>
          {running ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="spin" aria-hidden />Analyzing</span> : "Analyze"}
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <span className="op-dot" title="Overall status"><span className={`led ${st.cls}`} />{st.label}</span>
      <button className="icon-btn" onClick={() => onNavigate("settings")} aria-label="Settings" title="Settings">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 2h-4L10 5a7 7 0 0 0-1.7 1L6 5 4 8.4 6 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.9h4l.5-2.9a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z" /></svg>
      </button>

      <div ref={profileRef} style={{ position: "relative" }}>
        <button className="avatar-btn" onClick={() => setProfileOpen((o) => !o)} aria-label="Profile menu" aria-expanded={profileOpen} title="Profile">
          OD
        </button>
        {profileOpen && (
          <div className="profile-menu anim-pop" role="menu">
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Ocean Distro Finder</div>
              <div className="hint" style={{ fontSize: 11 }}>Local workspace · v1.0.0</div>
            </div>
            <button role="menuitem" onClick={() => { setProfileOpen(false); onNavigate("settings"); }}>Settings</button>
            <button role="menuitem" onClick={() => { setProfileOpen(false); onNavigate("status"); }}>System status</button>
            <button role="menuitem" onClick={() => { setProfileOpen(false); onNavigate("reports"); }}>Reports &amp; export</button>
          </div>
        )}
      </div>
    </header>
  );
}
