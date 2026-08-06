"use client";

import { useEffect, useState } from "react";

/**
 * Subtle animated gradient backdrop, user-configurable from Settings
 * (GradientCustomizer). Renders two blurred color fields that drift slowly
 * behind the UI. Always low-opacity and pointer-events:none — readability of
 * cards and text is never affected. Disabled entirely when the user opts out
 * or prefers reduced motion (the drift pauses via CSS).
 */
export type BgConfig = { enabled: boolean; c1: string; c2: string };

export const BG_STORAGE_KEY = "odf-bg";
export const BG_EVENT = "odf-bg-change";
export const BG_DEFAULT: BgConfig = { enabled: false, c1: "#9CF04A", c2: "#4C8F1C" };

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function readBgConfig(): BgConfig {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (!raw) return BG_DEFAULT;
    const j = JSON.parse(raw) as Partial<BgConfig>;
    return {
      enabled: j.enabled === true,
      c1: typeof j.c1 === "string" && HEX_RE.test(j.c1) ? j.c1 : BG_DEFAULT.c1,
      c2: typeof j.c2 === "string" && HEX_RE.test(j.c2) ? j.c2 : BG_DEFAULT.c2,
    };
  } catch { return BG_DEFAULT; }
}

export function writeBgConfig(cfg: BgConfig): void {
  try { localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent(BG_EVENT));
}

export function BackgroundFX() {
  const [cfg, setCfg] = useState<BgConfig>(BG_DEFAULT);
  useEffect(() => {
    const update = () => setCfg(readBgConfig());
    update();
    window.addEventListener(BG_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(BG_EVENT, update); window.removeEventListener("storage", update); };
  }, []);

  if (!cfg.enabled) return null;
  return (
    <div className="bgfx" aria-hidden>
      <div className="bgfx-blob bgfx-a" style={{ background: `radial-gradient(circle at center, ${cfg.c1}, transparent 70%)` }} />
      <div className="bgfx-blob bgfx-b" style={{ background: `radial-gradient(circle at center, ${cfg.c2}, transparent 70%)` }} />
    </div>
  );
}
