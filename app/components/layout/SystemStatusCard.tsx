"use client";

import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import type { Health } from "../../lib/types";
import { queryConnectorState } from "../../lib/connector";

type Dot = "ok" | "warn" | "err" | "muted";

const DOT_CLASS: Record<Dot, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  err: "bg-danger",
  muted: "bg-foreground-muted",
};

function StatusLine({ label, dot, value }: { label: string; dot: Dot; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <span className="flex items-center gap-1.5 text-foreground-secondary">
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[dot])} aria-hidden />
        {label}
      </span>
      <span className="text-foreground-muted">{value}</span>
    </div>
  );
}

function timeAgo(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

/** Compact real-status card at the bottom of the sidebar — no fabricated metrics. */
export function SystemStatusCard({ health, lastHealthAt, collapsed }: { health: Health | null; lastHealthAt: number | null; collapsed: boolean }) {
  const [conn, setConn] = useState<{ dot: Dot; label: string }>({ dot: "muted", label: "Checking…" });
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      queryConnectorState()
        .then((c) => {
          if (cancelled) return;
          setConn(
            c.connected || c.bridge.debuggable
              ? { dot: "ok", label: "Connected" }
              : c.bridge.desktopAlive
              ? { dot: "warn", label: c.bridge.spotifyRunning ? "Link inactive" : "Spotify closed" }
              : c.paired
              ? { dot: "warn", label: "Offline" }
              : { dot: "muted", label: "Not paired" }
          );
        })
        .catch(() => { if (!cancelled) setConn({ dot: "muted", label: "Not detected" }); });
    tick();
    const t = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Re-render every 15s purely so "last sync" relative time stays fresh.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  if (collapsed) return null;

  const metadataDot: Dot = health ? (health.primaryLookupReady ? "ok" : "warn") : "muted";
  const uuidDot: Dot = health ? (health.uuidMappingCount > 0 ? "ok" : "err") : "muted";

  return (
    <div className="mx-3 mb-2 space-y-2 rounded-lg border border-border-subtle bg-card/60 p-3">
      <StatusLine label="Spotify connection" dot={conn.dot} value={conn.label} />
      <StatusLine label="Metadata service" dot={metadataDot} value={health ? (health.primaryLookupReady ? "Ready" : "Degraded") : "—"} />
      <StatusLine label="UUID database" dot={uuidDot} value={health ? `${health.uuidMappingCount.toLocaleString()} records` : "—"} />
      <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-[10.5px] text-foreground-muted">
        <span>Last sync</span>
        <span>{timeAgo(lastHealthAt)}</span>
      </div>
    </div>
  );
}
