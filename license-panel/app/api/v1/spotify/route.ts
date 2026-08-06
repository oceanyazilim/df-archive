import { NextRequest, NextResponse } from "next/server";
import { attachSpotify } from "@/store";
import { clientIp, userAgent } from "@/request";
import { allow } from "@/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/spotify — the app reports the Spotify account the user
 * consented to link, so the panel can tell one licensee from another.
 *
 * Identity fields only: id, display name, avatar, country, account type,
 * follower count, e-mail. Never tokens, never listening history — the app's
 * consent screen lists exactly this set before anything is sent, and posting
 * a null profile means the user unlinked and the stored identity is deleted.
 *
 * Body: { token, deviceId, profile: {...} | null }
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allow(ip, 60)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const out = attachSpotify({
    token: typeof body.token === "string" ? body.token : "",
    deviceId: typeof body.deviceId === "string" ? body.deviceId.slice(0, 100) : "",
    ip,
    userAgent: userAgent(req),
    profile: (body.profile ?? null) as never,
  });

  if (!out.ok) {
    return NextResponse.json({ error: { code: "INVALID_TOKEN", message: out.message ?? "Not activated." } }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
