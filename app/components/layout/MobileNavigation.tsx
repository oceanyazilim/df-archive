"use client";

import { AnimatePresence, motion } from "framer-motion";
import { overlayFade } from "../../lib/motion";

/**
 * Backdrop scrim for the off-canvas sidebar on tablet/mobile (<1024px). The
 * sidebar itself (`AppSidebar`) already renders as the slide-in drawer content
 * on narrow viewports — this component only owns the dismiss-on-click overlay,
 * so nav data/markup lives in exactly one place.
 */
export function MobileNavigation({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          variants={overlayFade}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-30 bg-black/55 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
    </AnimatePresence>
  );
}
