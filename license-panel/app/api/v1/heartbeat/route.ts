import { NextRequest, NextResponse } from "next/server";
import { heartbeat } from "@/store";
import { clientIp, userAgent } from "@/request";
import { allow } from "@/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/heartbeat — periodic validity check from an activated
 * installation. Answers whether the license still holds and refreshes the
 * device's last-seen IP and time.
 *
 * Body: { token, deviceId, appVersion? }
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allow(ip, 120)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const out = heartbeat({
    token: typeof body.token === "string" ? body.token : "",
    deviceId: typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : "",
    appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
    ip,
    userAgent: userAgent(req),
  });

  if (!out.ok) {
    return NextResponse.json({ valid: false, code: out.outcome.toUpperCase(), message: out.message }, { status: 403 });
  }
  return NextResponse.json({
    valid: true,
    expiresAt: out.expiresAt ? new Date(out.expiresAt).toISOString() : null,
    type: out.keyType,
    note: out.note,
  });
}
