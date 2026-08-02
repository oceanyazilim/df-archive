import { NextRequest, NextResponse } from "next/server";
import { addFlaggedUuid, listFlaggedUuids } from "@core/uuidReview/store";
import { normalizeLicensorUuid } from "@core/spotifyMetadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9]{22}$/;
const MAX_NOTE = 500;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;
}

/** GET /api/uuid-mapping/flag?limit= — this workspace's own flagged-for-review queue. */
export async function GET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100));
  return NextResponse.json({ items: listFlaggedUuids(limit) });
}

/**
 * POST /api/uuid-mapping/flag — backs "Add to UUID Database" / "Report Mapping"
 * on the Distributor-Not-Found state. No mapping data is written or trusted
 * automatically; this only records a reviewable request.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "INVALID_BODY", message: "Request body must be JSON." } }, { status: 400 }); }

  const reason = body.reason === "report" ? "report" : "add";
  const licensorUuid = normalizeLicensorUuid(typeof body.licensorUuid === "string" ? body.licensorUuid : null);
  const spotifyTrackId = typeof body.spotifyTrackId === "string" && ID_RE.test(body.spotifyTrackId) ? body.spotifyTrackId : null;
  const spotifyAlbumId = typeof body.spotifyAlbumId === "string" && ID_RE.test(body.spotifyAlbumId) ? body.spotifyAlbumId : null;
  const artists = Array.isArray(body.artists) ? body.artists.filter((a): a is string => typeof a === "string").slice(0, 10) : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : null;

  if (!licensorUuid && !spotifyTrackId && !spotifyAlbumId) {
    return NextResponse.json({ error: { code: "MISSING_SUBJECT", message: "At least a licensor UUID, track, or album must be provided." } }, { status: 400 });
  }

  const item = addFlaggedUuid({
    reason,
    licensorUuid,
    spotifyTrackId,
    spotifyAlbumId,
    trackTitle: str(body.trackTitle),
    releaseTitle: str(body.releaseTitle),
    artists,
    note,
  });
  return NextResponse.json({ ok: true, item });
}
