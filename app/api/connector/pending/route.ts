import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey, pendingTrackIds, connectorKeyFromHeaders } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

function connectorKey(req: NextRequest): string | null {
  return connectorKeyFromHeaders(req.headers);
}

/**
 * GET /api/connector/pending — authenticated. Returns ONLY the Spotify track ids
 * of currently-pending lookups so the extension can decide whether to forward a
 * capture. No other data is exposed.
 */
export async function GET(req: NextRequest) {
  const key = connectorKey(req);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  return NextResponse.json({ pendingTrackIds: pendingTrackIds() }, { headers: CONNECTOR_CORS });
}
