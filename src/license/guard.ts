/**
 * Route guard.
 *
 * The activation screen is a UI affordance; THIS is the enforcement. Every
 * analysis route calls it, so bypassing the interface (hitting the local API
 * directly) buys nothing without a valid key.
 *
 * Deliberately cheap: it reads cached state, never blocks on the network.
 * The periodic heartbeat is what turns a revoked key into a locked app.
 */

import { NextResponse } from "next/server";
import { licenseStatus } from "./client";

export function requireLicense(): NextResponse | null {
  const s = licenseStatus();
  if (s.licensed) return null;
  return NextResponse.json(
    {
      error: {
        code: s.state === "locked" ? "LICENSE_LOCKED" : "LICENSE_REQUIRED",
        message: s.message ?? "This copy is not activated. Enter a Virus Records key to unlock it.",
      },
    },
    { status: 402 } // Payment Required — unambiguous, and never used elsewhere.
  );
}
