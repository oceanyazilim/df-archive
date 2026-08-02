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
import { OrbitEffect } from "./OrbitEffect";
import { ScanEffect } from "./ScanEffect";
import { OceanProgressBar } from "./OceanProgressBar";
import { LoaderStageList } from "./LoaderStageList";
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

function progress01Of(progress: Ocean3DLoaderProps["progress"]): number {
  return typeof progress === "number" ? Math.min(1, Math.max(0, progress / 100)) : 0;
}

/**
 * The shared 3D brand-loader shell. Canvas + camera + studio lighting +
 * OceanLogoScene (+ per-mode OrbitEffect/ScanEffect), with a graceful
 * WebGL/GLB-failure fallback to the static logo — and the progress bar /
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
  const showScanEffect = mode === "distributor-search" && !reducedMotion;
  const showOrbitEffect = mode === "distributor-search" || mode === "catalog-analysis" || mode === "success";

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
      <div className="relative w-full" style={{ height }} role="img" aria-label={MODE_ARIA_TEXT[mode]}>
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
                {showOrbitEffect && <OrbitEffect mode={mode} reducedMotion={reducedMotion} progress01={p01} searchSubstage={searchSubstage} />}
                {showScanEffect && <ScanEffect reducedMotion={reducedMotion} />}
              </Canvas>
            </Suspense>
          </GlbErrorBoundary>
        )}
      </div>

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
