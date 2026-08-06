import { NextRequest, NextResponse } from "next/server";
import { activate } from "@/store";
import { clientIp, userAgent } from "@/request";
import { allow } from "@/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/activate — the desktop app exchanges a license key for a
 * device-bound token. Records the client IP and time in the audit trail.
 *
 * Body: { key, deviceId, deviceName?, appVersion? }
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allow(ip, 20)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait a minute and try again." } }, { status: 429 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const key = typeof body.key === "string" ? body.key : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : "";
  if (!key || !deviceId) {
    return NextResponse.json({ error: { code: "MALFORMED", message: "A key and a device id are required." } }, { status: 400 });
  }

  const out = activate({
    key,
    deviceId,
    deviceName: typeof body.deviceName === "string" ? body.deviceName : null,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
    ip,
    userAgent: userAgent(req),
  });

  if (!out.ok) {
    const status = out.outcome === "unknown_key" ? 404 : out.outcome === "malformed" ? 400 : 403;
    return NextResponse.json({ error: { code: out.outcome.toUpperCase(), message: out.message } }, { status });
  }
  return NextResponse.json({
    ok: true,
    token: out.token,
    license: {
      type: out.key.type,
      expiresAt: out.expiresAt ? new Date(out.expiresAt).toISOString() : null,
      note: out.key.note,
      deviceLimit: out.key.deviceLimit,
    },
  });
}
