"use client";

import dynamic from "next/dynamic";

/**
 * The Three.js/R3F dependency chain is sizable — it must never be part of the
 * initial page bundle (only used when an analysis or fullscreen loader is
 * actually active). Every consumer imports this lazy wrapper, not
 * Ocean3DLoader directly, so there's exactly one dynamic-import chunk shared
 * across the app rather than one per call site.
 */
export const LazyOcean3DLoader = dynamic(() => import("./Ocean3DLoader").then((m) => m.Ocean3DLoader), {
  ssr: false,
  loading: () => <div className="mx-auto h-[150px] w-[150px] animate-pulse rounded-full bg-card-elevated/40" aria-hidden />,
});
