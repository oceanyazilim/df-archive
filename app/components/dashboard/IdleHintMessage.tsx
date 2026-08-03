"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const MESSAGES: [string, string][] = [
  ["Nothing is sent anywhere until you submit a query.", "Analysis runs the moment you press Analyze — not before."],
  ["Results come straight from Spotify and Soundcharts.", "Nothing here is cached, guessed, or estimated."],
  ["Distributor matches are exact licensor-UUID matches.", "Never inferred from a label name or track title."],
  ["Missing a field just means it isn't public yet.", "It's shown honestly as unavailable, never made up."],
];

/**
 * Idle-state reassurance copy under the hero input — rotates through a small,
 * honest set of 2-line messages while nothing is running. Replaces the old
 * status-card row for a calmer, ChatGPT-style empty state.
 */
export function IdleHintMessage({ className }: { className?: string }) {
  const [i, setI] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % MESSAGES.length), 4000);
    return () => clearInterval(t);
  }, []);

  const [line1, line2] = MESSAGES[i];

  return (
    <div className={className} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={i}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.5, ease: [0.22, 0.8, 0.36, 1] }}
          className="text-center text-[12.5px] leading-relaxed text-foreground-muted"
        >
          {line1}
          <br />
          {line2}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
