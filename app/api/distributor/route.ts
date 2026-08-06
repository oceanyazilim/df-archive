import { NextRequest, NextResponse } from "next/server";
import { resolveDistributorByLicensorUuid } from "@core/distributor/resolver";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/distributor  { licensorUuid, spotifyTrackId? }
 *
 * The ONLY job of this endpoint: turn a licensor UUID (captured by the Spicetify
 * client from the Spotify desktop app's own authenticated metadata response) into
 * a distributor via the canonical local mapping. Exact match only. Never uses
 * label / ISRC / UPC / Soundcharts. Returns one of the distinct states:
 *   verified | uuid_not_mapped | uuid_unavailable | invalid_uuid | conflict
 *
 * CORS is open because the response is non-sensitive (a single UUID -> one
 * distributor name; the mapping cannot be enumerated) and it is called from the
 * Spotify desktop client renderer origin.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Connector headers allowed so the companion can reuse one request helper;
  // this endpoint itself never requires them.
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Connector-Key",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400, headers: CORS });
  }

  // The resolver normalizes + validates the UUID itself and returns a distinct
  // status; it never throws. A missing UUID yields "uuid_unavailable".
  const result = resolveDistributorByLicensorUuid(body.licensorUuid ?? null);

  const spotifyTrackId = typeof body.spotifyTrackId === "string" && /^[A-Za-z0-9]{22}$/.test(body.spotifyTrackId)
    ? body.spotifyTrackId : null;

  return NextResponse.json({
    spotifyTrackId,
    distributor: result.name,      // exact stored name, or null
    licensorUuid: result.uuid,     // normalized 32-hex, or null
    status: result.status,         // verified | uuid_not_mapped | uuid_unavailable | invalid_uuid | conflict
  }, { headers: CORS });
}
