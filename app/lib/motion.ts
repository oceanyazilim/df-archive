import type { Transition, Variants } from "framer-motion";

/**
 * Shared Framer Motion presets so every animated surface in the app moves with
 * the same rhythm. Import these instead of hand-writing one-off variants.
 */

export const EASE_OUT = [0.22, 0.8, 0.36, 1] as const;
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

export const DURATION = { fast: 0.12, base: 0.18, slow: 0.28 };

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

/** Wrap a list of children in this container to stagger their entrance via `staggerItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION.fast, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_OUT } },
};

/** Right-side drawer / side-sheet slide-in. */
export const drawerSlide: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
  exit: { x: "100%", transition: { duration: DURATION.base, ease: EASE_OUT } },
};

export const overlayFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base } },
  exit: { opacity: 0, transition: { duration: DURATION.base } },
};

/** Dropdown/popover scale+fade, anchored near its trigger. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: 0.1 } },
};

export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 34 };

/** Returns instant, no-motion variants — spread over a base preset when reduced motion is requested. */
export function withoutMotion(variants: Variants): Variants {
  const result: Variants = {};
  for (const key of Object.keys(variants)) {
    const v = variants[key];
    result[key] = typeof v === "object" && v !== null ? { ...v, transition: { duration: 0 } } : v;
  }
  return result;
}
