"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { cn } from "../../lib/cn";
import { useWebglSupport } from "../../lib/hooks/useWebglSupport";
import { usePageVisible } from "../../lib/hooks/usePageVisible";
import { GlbErrorBoundary } from "./GlbErrorBoundary";
import { OceanLogoScene } from "./OceanLogoScene";
import { OceanLogoFallback } from "./OceanLogoFallback";
import type { Ocean3DLoaderProps } from "./types";

const SIZE = { fullscreen: "clamp(220px, 34vh, 360px)", compact: "84px", inline: "150px" } as const;

function sceneHeight(props: Pick<Ocean3DLoaderProps, "fullscreen" | "compact">): string {
  if (props.fullscreen) return SIZE.fullscreen;
  if (props.compact) return SIZE.compact;
  return SIZE.inline;
}

const MODE_ARIA_TEXT: Record<Ocean3DLoaderProps["mode"], string> = {
  "app-initialization": "Ocean Distro Finder is loading",
  "page-transition": "Loading the next page",
  "distributor-search": "Searching for distributor information",
  "catalog-analysis": "Analyzing artist catalog",
  success: "Analysis complete",
};

/**
 * The shared 3D brand-loader shell. Canvas + camera + studio lighting +
 * OceanLogoScene, with a graceful WebGL/GLB-failure fallback to the static
 * logo — loading text/progress (rendered by callers via OceanProgressBar in
 * Phase C) never depends on the 3D scene succeeding.
 */
export function Ocean3DLoader({ mode, fullscreen, compact, className }: Ocean3DLoaderProps) {
  const webglSupported = useWebglSupport();
  const pageVisible = usePageVisible();
  const reducedMotion = !!useReducedMotion();
  const height = sceneHeight({ fullscreen, compact });
  const useFallback = webglSupported === false;

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ height }}
      role="img"
      aria-label={MODE_ARIA_TEXT[mode]}
    >
      {useFallback ? (
        <OceanLogoFallback size={compact ? 72 : 140} className="h-full" />
      ) : (
        <GlbErrorBoundary fallback={<OceanLogoFallback size={compact ? 72 : 140} className="h-full" />}>
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-full bg-card-elevated/40" style={{ maxWidth: height, margin: "0 auto" }} />}>
            <Canvas
              dpr={[1, 2]}
              frameloop={pageVisible ? "always" : "never"}
              gl={{ alpha: true, antialias: true }}
              camera={{ fov: 32, position: [0, 0.12, 3.4] }}
              style={{ background: "transparent" }}
            >
              <ambientLight intensity={0.55} />
              <directionalLight position={[2.4, 3, 2.6]} intensity={1.1} color="#F4F7FB" />
              <directionalLight position={[-2.2, -1, -2.4]} intensity={0.65} color="#39BDF8" />
              <OceanLogoScene mode={mode} reducedMotion={reducedMotion} />
            </Canvas>
          </Suspense>
        </GlbErrorBoundary>
      )}
    </div>
  );
}
