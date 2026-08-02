import oceanLogo from "../../../src/assets/Ocean-Logo.png";
import { cn } from "../../lib/cn";

/**
 * Used when WebGL is unavailable or the GLB fails to load — the PNG brand
 * mark with a CSS-only pulse (and slow rotation, skipped under
 * prefers-reduced-motion via the animate-pulse-slow/motion-reduce combo).
 * Loading functionality (progress bar, stage text) never depends on 3D.
 */
export function OceanLogoFallback({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center", className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={oceanLogo.src}
        alt="Ocean Distro Finder"
        style={{ height: size * 0.62, width: "auto" }}
        className="animate-loader-pulse object-contain motion-reduce:animate-none"
      />
    </div>
  );
}
