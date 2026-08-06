"use client";

/**
 * Back / forward across the analyses of this session.
 *
 * Entries carry a full snapshot of the workspace state, so stepping back is
 * instant and costs no provider calls — re-running the query would be both
 * slower and, on a rate-limited account, occasionally different. The stack
 * lives in memory only: it is a navigation aid for the current session, while
 * `localHistory` is the durable 7-day record.
 */

import { useCallback, useRef, useState } from "react";

export type AnalysisSnapshot<S, A, P> = {
  input: string;
  label: string;
  session: S | null;
  artist: A | null;
  playlist: P | null;
};

const MAX_ENTRIES = 40;

export function useAnalysisNav<S, A, P>() {
  const [stack, setStack] = useState<AnalysisSnapshot<S, A, P>[]>([]);
  const [index, setIndex] = useState(-1);
  // Set while a restore is applying, so the restored state does not get
  // pushed back onto the stack as if it were a new analysis.
  const restoring = useRef(false);

  const push = useCallback((entry: AnalysisSnapshot<S, A, P>) => {
    if (restoring.current) return;
    setStack((prev) => {
      const upTo = index >= 0 ? prev.slice(0, index + 1) : [];
      // Re-analyzing what is already on screen should not create a duplicate
      // step; the user would have to press Back twice for one apparent move.
      if (upTo.length && upTo[upTo.length - 1].input === entry.input) {
        const replaced = [...upTo];
        replaced[replaced.length - 1] = entry;
        setIndex(replaced.length - 1);
        return replaced;
      }
      const next = [...upTo, entry].slice(-MAX_ENTRIES);
      setIndex(next.length - 1);
      return next;
    });
  }, [index]);

  const step = useCallback((delta: number, apply: (e: AnalysisSnapshot<S, A, P>) => void) => {
    const target = index + delta;
    const entry = stack[target];
    if (!entry) return;
    restoring.current = true;
    apply(entry);
    setIndex(target);
    // Release on the next tick: `apply` triggers state updates whose effects
    // run after this call returns.
    setTimeout(() => { restoring.current = false; }, 0);
  }, [index, stack]);

  return {
    push,
    step,
    canGoBack: index > 0,
    canGoForward: index >= 0 && index < stack.length - 1,
    backLabel: index > 0 ? stack[index - 1].label : null,
    forwardLabel: index >= 0 && index < stack.length - 1 ? stack[index + 1].label : null,
    isRestoring: restoring,
  };
}
