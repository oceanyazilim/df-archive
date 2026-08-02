"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../../lib/cn";
import { useWebglSupport } from "../../lib/hooks/useWebglSupport";
import { usePageVisible } from "../../lib/hooks/usePageVisible";
import { GlbErrorBoundary } from "./GlbErrorBoundary";
import { OceanLogoScene } from "./OceanLogoScene";
import { OceanLogoFallback } from "./OceanLogoFallback";
import { OceanProgressBar } from "./OceanProgressBar";
import { LoaderStageList } from "./LoaderStageList";
import type { Ocean3DLoaderProps } from "./types";

// Bigger and more prominent while an actual query is running — no orbit
// rings or particle effects anymore, just the model, clean and centered.
const SIZE = { fullscreen: "clamp(240px, 38vh, 400px)", compact: "104px", inline: "230px" } as const;

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

function progress01Of(progress: Ocean3DLoaderProps["progress"]): number {
  return typeof progress === "number" ? Math.min(1, Math.max(0, progress / 100)) : 0;
}

/**
 * The shared 3D brand-loader shell — the model itself, entering with a clean
 * fade + scale motion and a simple rotation, nothing orbiting around it. A
 * graceful WebGL/GLB-failure fallback to the static logo; the progress bar /
 * stage list / live stats never depend on the 3D scene succeeding.
 */
export function Ocean3DLoader({
  mode, progress, stage, description, fullscreen, compact, searchSubstage, catalogStats, stages, className,
}: Ocean3DLoaderProps) {
  const webglSupported = useWebglSupport();
  const pageVisible = usePageVisible();
  const reducedMotion = !!useReducedMotion();
  const height = sceneHeight({ fullscreen, compact });
  const useFallback = webglSupported === false;
  const p01 = progress01Of(progress);

  const statLine =
    mode === "catalog-analysis" && catalogStats && (catalogStats.releases != null || catalogStats.tracks != null)
      ? [
          catalogStats.releases != null ? `${catalogStats.releases}${catalogStats.totalReleases != null ? ` / ${catalogStats.totalReleases}` : ""} releases analyzed` : null,
          catalogStats.tracks != null ? `${catalogStats.tracks} tracks processed` : null,
          catalogStats.distributors != null ? `${catalogStats.distributors} distributor${catalogStats.distributors === 1 ? "" : "s"} detected` : null,
        ].filter(Boolean).join(" · ")
      : null;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <motion.div
        key={mode}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 0.8, 0.36, 1] }}
        className="relative w-full"
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
                <OceanLogoScene mode={mode} reducedMotion={reducedMotion} progress01={p01} searchSubstage={searchSubstage} />
              </Canvas>
            </Suspense>
          </GlbErrorBoundary>
        )}
      </motion.div>

      {(stage || description) && (
        <div className="mt-3 text-center">
          {stage && <p className="text-sm font-medium text-foreground" aria-live="polite">{stage}</p>}
          {description && <p className="mt-0.5 text-xs text-foreground-secondary">{description}</p>}
        </div>
      )}

      {statLine && <p className="mt-2 text-[11.5px] tabular-nums text-foreground-muted">{statLine}</p>}

      {progress !== undefined && (
        <div className="mt-4 w-full max-w-xs">
          <OceanProgressBar progress={progress} stageLabel={stage} />
        </div>
      )}

      {stages && stages.length > 0 && <LoaderStageList stages={stages} className="mt-4 w-full max-w-xs text-left" />}
    </div>
  );
}
