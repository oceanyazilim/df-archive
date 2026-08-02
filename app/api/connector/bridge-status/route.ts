import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey, connectorKeyFromHeaders, recordBridgeStatus } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/connector/bridge-status — the desktop shell reports whether the
 * Spotify client is running and reachable over CDP. Lets the panel show an
 * honest three-state connection status instead of a bare "not connected".
 */
export async function POST(req: NextRequest) {
  const key = connectorKeyFromHeaders(req.headers);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is a valid "alive" ping */ }
  recordBridgeStatus({ spotifyRunning: body.spotifyRunning, debuggable: body.debuggable });
  return NextResponse.json({ ok: true }, { headers: CONNECTOR_CORS });
}
