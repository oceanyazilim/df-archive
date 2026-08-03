import oceanLogo from "../../src/assets/Ocean-Logo.png";

/**
 * The static Ocean Distro Finder brand mark — the ONLY component that imports
 * the logo image file. Renders exactly one <img>, image only, never
 * recreated with text/CSS, never recolored or filtered. A very subtle hover
 * brightness lift is the only permanent effect (no glow, no rotation).
 *
 * Approved variants (used only in the sidebar / mobile-drawer branding, since
 * the sidebar doubles as the mobile nav):
 *   sidebar (48) · collapsedSidebar (38) · emptyState (54)
 */
export type BrandLogoVariant = "sidebar" | "collapsedSidebar" | "emptyState";

const VARIANT_HEIGHT: Record<BrandLogoVariant, number> = {
  sidebar: 48,
  collapsedSidebar: 38,
  emptyState: 54,
};

export function BrandLogo({ variant = "sidebar", height, className }: { variant?: BrandLogoVariant; height?: number; className?: string }) {
  const h = height ?? VARIANT_HEIGHT[variant];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={oceanLogo.src}
      alt="Ocean Distro Finder"
      style={{ height: h, width: "auto" }}
      className={`block object-contain transition-[filter] duration-fast ease-out hover:brightness-110 ${className ?? ""}`}
    />
  );
}
