import { NextRequest, NextResponse } from "next/server";
import { getLookup } from "@core/connectorStore";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/lookup/{requestId} — current status + result (safe fields only). */
export async function GET(_req: NextRequest, ctx: { params: { requestId: string } }) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const lookup = getLookup(ctx.params.requestId);
  if (!lookup) {
    return NextResponse.json({ error: { code: "LOOKUP_NOT_FOUND", message: "Unknown or expired request id." } }, { status: 404 });
  }

  const m = lookup.metadata;
  const r = lookup.result;
  return NextResponse.json({
    success: lookup.status === "completed" && r?.matchStatus === "matched",
    requestId: lookup.requestId,
    spotifyTrackId: lookup.spotifyTrackId,
    spotifyUri: `spotify:track:${lookup.spotifyTrackId}`,
    status: lookup.status,
    stage: lookup.stage,
    connectorStatus: lookup.connectorStatus,
    trackTitle: m?.trackTitle ?? null,
    artists: m?.artists ?? [],
    albumTitle: m?.albumTitle ?? null,
    albumLabel: m?.albumLabel ?? null,
    isrc: m?.isrc ?? null,
    trackGid: m?.trackGid ?? null,
    capturedAt: m?.capturedAt ?? null,
    licensorUuid: r?.licensorUuid ?? null,
    distributor: r?.distributor ?? null,
    matchStatus: r?.matchStatus ?? null,
    error: r?.error ?? null,
  });
}
