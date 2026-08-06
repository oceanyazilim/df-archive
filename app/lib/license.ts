"use client";

/** Client-side view of the license state. The token never reaches the browser —
 *  this is exactly what /api/license/status returns. */

import { useCallback, useEffect, useRef, useState } from "react";

export type LicenseState = {
  licensed: boolean;
  state: "unlicensed" | "active" | "locked" | "grace";
  type: "single" | "duration" | "unlimited" | null;
  keyMasked: string | null;
  note: string | null;
  expiresAt: string | null;
  lastCheckAt: string | null;
  message: string | null;
  deviceId: string;
  server: string;
};

/**
 * Polls the local license status. The interval is deliberately slow: the
 * server-side heartbeat is what talks to the panel, and this only mirrors its
 * verdict so a revoked key takes the UI down within a couple of minutes.
 */
export function useLicense() {
  const [status, setStatus] = useState<LicenseState | null>(null);
  const [checking, setChecking] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/license/status${force ? "?check=1" : ""}`, { cache: "no-store" });
      const json = (await res.json()) as LicenseState;
      if (mounted.current) setStatus(json);
    } catch {
      // A local fetch failure means the app server itself is starting; keep
      // the previous verdict rather than flashing the activation screen.
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh(true);
    const t = setInterval(() => refresh(false), 120_000);
    return () => { mounted.current = false; clearInterval(t); };
  }, [refresh]);

  return { status, checking, refresh };
}
