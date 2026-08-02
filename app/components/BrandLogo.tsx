"use client";

import { useEffect, useState } from "react";
import whiteLogo from "../../src/assets/white-virus-logo.png";
import blackLogo from "../../src/assets/black-virus-logo.png";

/**
 * Theme-aware brand logo — the ONLY component that imports the logo image files.
 *
 * Renders EXACTLY ONE <img>, chosen by the resolved theme (never two images, no
 * CSS hiding, no filters):
 *   dark  theme -> white-virus-logo.png
 *   light theme -> black-virus-logo.png
 * System mode is resolved to the actual light/dark via the `data-theme` attribute
 * the app sets on <html> (before paint + on every theme change).
 *
 * Approved variants (used only in the sidebar / mobile drawer branding):
 *   sidebar (30) · collapsedSidebar (28) · mobile (30) · emptyState (54)
 */
export type BrandLogoVariant = "sidebar" | "collapsedSidebar" | "mobile" | "emptyState";

const VARIANT: Record<BrandLogoVariant, { height: number; wordmark: boolean }> = {
  sidebar: { height: 30, wordmark: true },
  collapsedSidebar: { height: 28, wordmark: false },
  mobile: { height: 30, wordmark: true },
  emptyState: { height: 54, wordmark: false },
};

function readResolvedTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark"; // SSR default (matches pre-paint)
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function BrandLogo({ variant = "sidebar", height, wordmark }: { variant?: BrandLogoVariant; height?: number; wordmark?: boolean }) {
  const preset = VARIANT[variant];
  const h = height ?? preset.height;
  const showWordmark = wordmark ?? preset.wordmark;

  // Track the resolved theme so we render a SINGLE, correct image. Switching the
  // theme replaces the src on the same <img> — it never adds a second image.
  const [theme, setTheme] = useState<"light" | "dark">(readResolvedTheme);
  useEffect(() => {
    const update = () => setTheme(readResolvedTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const src = theme === "dark" ? whiteLogo.src : blackLogo.src;

  return (
    <span className="brand-lockup" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Ocean Distro Finder"
        suppressHydrationWarning
        style={{ height: h, width: "auto", objectFit: "contain", display: "block" }}
      />
      {showWordmark && (
        <span className="brand-wordmark" style={{ lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 640, fontSize: 14, letterSpacing: "-0.01em", color: "var(--text-primary)", whiteSpace: "nowrap" }}>Ocean Distro Finder</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)" }}>Music Intelligence</span>
        </span>
      )}
    </span>
  );
}
