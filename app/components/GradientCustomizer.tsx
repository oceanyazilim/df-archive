"use client";

import { useEffect, useState } from "react";
import { BgConfig, BG_DEFAULT, readBgConfig, writeBgConfig } from "./BackgroundFX";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PRESETS: { name: string; c1: string; c2: string }[] = [
  // Virus (the brand pair) leads; the rest are alternatives, not the old
  // ocean-blue defaults the app shipped before the rebrand.
  { name: "Virus", c1: "#9CF04A", c2: "#4C8F1C" },
  { name: "Toxic", c1: "#9CF04A", c2: "#A98BFF" },
  { name: "Violet", c1: "#A98BFF", c2: "#5B2FBF" },
  { name: "Sunset", c1: "#E8590C", c2: "#862E9C" },
];

/** Settings panel: two-color animated background customization (subtle by design). */
export function GradientCustomizer() {
  const [cfg, setCfg] = useState<BgConfig>(BG_DEFAULT);
  useEffect(() => { setCfg(readBgConfig()); }, []);

  const apply = (next: BgConfig) => { setCfg(next); writeBgConfig(next); };
  const setHex = (key: "c1" | "c2", v: string) => {
    const next = { ...cfg, [key]: v };
    setCfg(next);
    if (HEX_RE.test(v)) writeBgConfig(next);
  };

  return (
    <section className="panel anim-in">
      <h3 className="panel-title">Dashboard Background</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        A subtle animated gradient behind the dashboard. It stays low-contrast — cards and text always remain fully readable.
      </p>
      <div className="kv"><span className="k">Animated background</span>
        <label className="switch">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => apply({ ...cfg, enabled: e.target.checked })} aria-label="Enable animated background" />
          <span className="slider" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 16 }}>
        {(["c1", "c2"] as const).map((key) => (
          <div key={key} className="field">
            <label>{key === "c1" ? "Primary color" : "Secondary color"}</label>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input type="color" value={HEX_RE.test(cfg[key]) ? cfg[key] : "#000000"} onChange={(e) => setHex(key, e.target.value)}
                aria-label={`${key === "c1" ? "Primary" : "Secondary"} color picker`} style={{ width: 34, height: 30, padding: 2, border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", cursor: "pointer" }} />
              <input type="text" value={cfg[key]} onChange={(e) => setHex(key, e.target.value.trim())} spellCheck={false}
                aria-label={`${key === "c1" ? "Primary" : "Secondary"} HEX color`} className="mono" style={{ width: 96 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, gap: 6 }}>
        {PRESETS.map((p) => (
          <button key={p.name} className="btn btn-sm" onClick={() => apply({ enabled: true, c1: p.c1, c2: p.c2 })} title={`${p.c1} + ${p.c2}`}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: `linear-gradient(135deg, ${p.c1}, ${p.c2})`, marginRight: 6, verticalAlign: "-1px" }} />
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}
