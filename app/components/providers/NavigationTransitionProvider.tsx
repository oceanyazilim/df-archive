"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { PageTransitionLoader } from "../loaders/PageTransitionLoader";

interface NavigationTransitionContextValue {
  /** Call when navigation to a new view starts. */
  beginTransition: (destinationTitle: string) => void;
  /** Call once the new view has painted — hides the loader (respecting the flash-guard/min-visible timers). */
  markReady: () => void;
}

const NavigationTransitionContext = createContext<NavigationTransitionContextValue | null>(null);

export function useNavigationTransition(): NavigationTransitionContextValue {
  const ctx = useContext(NavigationTransitionContext);
  if (!ctx) throw new Error("useNavigationTransition must be used within NavigationTransitionProvider");
  return ctx;
}

const SHOW_DELAY_MS = 220; // don't flash the loader for transitions faster than this
const MIN_VISIBLE_MS = 420; // once shown, stay up at least this long to avoid a flicker
const SAFETY_TIMEOUT_MS = 2500; // hide unconditionally if a view never signals ready

/**
 * Adapts the spec's "page transition loader" to how this app actually
 * navigates — a single client-side `view` state switch in page.tsx, not real
 * Next.js routes (confirmed: there are no /analyze, /artists/[id], etc.
 * route segments for a route-level loading.tsx to attach to). go(view) calls
 * beginTransition(); PageContainer calls markReady() on its own first paint.
 */
export function NavigationTransitionProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("");
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const safetyTimer = useRef<ReturnType<typeof setTimeout>>();
  const shownAt = useRef<number | null>(null);
  const readyCalled = useRef(false);

  const clearTimers = useCallback(() => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    clearTimeout(safetyTimer.current);
  }, []);

  const beginTransition = useCallback((destinationTitle: string) => {
    clearTimers();
    readyCalled.current = false;
    setTitle(destinationTitle);
    showTimer.current = setTimeout(() => {
      setVisible(true);
      shownAt.current = Date.now();
    }, SHOW_DELAY_MS);
    safetyTimer.current = setTimeout(() => setVisible(false), SAFETY_TIMEOUT_MS);
  }, [clearTimers]);

  const markReady = useCallback(() => {
    if (readyCalled.current) return;
    readyCalled.current = true;
    // Not yet visible (fast transition) — just cancel the pending show, no flash at all.
    if (!shownAt.current) { clearTimeout(showTimer.current); return; }
    const elapsed = Date.now() - shownAt.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    hideTimer.current = setTimeout(() => { setVisible(false); shownAt.current = null; }, remaining);
  }, []);

  const value = useMemo(() => ({ beginTransition, markReady }), [beginTransition, markReady]);

  return (
    <NavigationTransitionContext.Provider value={value}>
      {children}
      <PageTransitionLoader visible={visible} destinationTitle={title} />
    </NavigationTransitionContext.Provider>
  );
}
