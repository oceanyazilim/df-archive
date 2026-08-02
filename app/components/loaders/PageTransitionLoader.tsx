"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { overlayFade } from "../../lib/motion";
import { LazyOcean3DLoader } from "./LazyOcean3DLoader";

/** Shorter and more elegant than the fullscreen app-init loader — a brief, elegant beat between views, never an endless spin. */
export function PageTransitionLoader({ visible, destinationTitle }: { visible: boolean; destinationTitle: string }) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number>();

  useEffect(() => {
    if (!visible) { setProgress(0); return; }
    const start = performance.now();
    const DURATION = 550;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          variants={overlayFade}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-modal flex items-center justify-center backdrop-blur-sm"
          style={{ background: "rgba(8,11,15,0.82)" }}
          aria-live="polite"
          role="status"
        >
          <div className="flex flex-col items-center">
            <LazyOcean3DLoader mode="page-transition" compact progress={Math.round(progress * 100)} />
            <p className="mt-3 text-sm font-medium text-foreground">{destinationTitle}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
