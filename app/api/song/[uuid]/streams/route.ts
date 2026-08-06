import { NextRequest, NextResponse } from "next/server";
import { getSongStreams } from "@core/soundcharts/analytics";
import { SoundchartsError } from "@core/soundcharts/errors";
import { isSoundchartsConfigured } from "@core/soundcharts/config";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{32,36}$/i;

/**
 * GET /api/song/{uuid}/streams?days=90&platform=spotify
 * Returns real Soundcharts streaming data, or an honest state:
 *   available | empty | plan_restricted | unavailable | not_configured
 * Never returns fabricated stream counts.
 */
export async function GET(req: NextRequest, ctx: { params: { uuid: string } }) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const uuid = ctx.params.uuid;
  if (!UUID_RE.test(uuid)) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid song UUID." } }, { status: 400 });
  if (!isSoundchartsConfigured()) return NextResponse.json({ state: "not_configured", points: [] });

  const days = Math.min(365, Math.max(7, Number.parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10) || 90));
  const platform = (req.nextUrl.searchParams.get("platform") ?? "spotify").replace(/[^a-z_-]/gi, "").slice(0, 24) || "spotify";

  try {
    const points = await getSongStreams(uuid, platform, days);
    return NextResponse.json({ state: points.length ? "available" : "empty", platform, days, source: "soundcharts", points, updatedAt: new Date().toISOString() });
  } catch (err) {
    const e = err instanceof SoundchartsError ? err : null;
    const state = e?.code === "SOUNDCHARTS_PLAN_RESTRICTED" ? "plan_restricted" : e?.code === "SOUNDCHARTS_NOT_FOUND" ? "empty" : "unavailable";
    return NextResponse.json({ state, platform, days, points: [], code: e?.code ?? "INTERNAL_SERVER_ERROR" });
  }
}
