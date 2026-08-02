"use client";

import { AnimatePresence, motion } from "framer-motion";
import { overlayFade } from "../../lib/motion";
import { LazyOcean3DLoader as Ocean3DLoader } from "./LazyOcean3DLoader";
import { OceanProgressBar } from "./OceanProgressBar";
import { LoaderStageList, type LoaderStage } from "./LoaderStageList";
import type { Ocean3DLoaderMode, LoaderProgress } from "./types";

export interface FullscreenLoaderOverlayProps {
  visible: boolean;
  mode: Ocean3DLoaderMode;
  title: string;
  description?: string;
  progress?: LoaderProgress;
  stages?: LoaderStage[];
}

/**
 * Fullscreen dark overlay for app-initialization (and any other loader that
 * needs to block the whole page). #080B0F backdrop, a restrained radial blue
 * glow behind the logo, and a slight blur of whatever page content sits
 * beneath it. Status is announced via aria-live so the loading state isn't
 * motion-only.
 */
export function FullscreenLoaderOverlay({ visible, mode, title, description, progress, stages }: FullscreenLoaderOverlayProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          variants={overlayFade}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-modal flex items-center justify-center backdrop-blur-sm"
          style={{ background: "#080B0F" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: "radial-gradient(circle at 50% 42%, rgba(57,189,248,0.14), transparent 62%)" }}
            aria-hidden
          />
          <div className="relative z-10 flex w-full max-w-sm flex-col items-center px-6 text-center" aria-live="polite" role="status">
            <Ocean3DLoader mode={mode} fullscreen />
            <h2 className="mt-2 text-base font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-sm text-foreground-secondary">{description}</p>}
            <div className="mt-5 w-full">
              <OceanProgressBar progress={progress ?? "indeterminate"} />
            </div>
            {stages && stages.length > 0 && <LoaderStageList stages={stages} className="mt-4 w-full text-left" />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
