import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey, recordHeartbeat, connectorKeyFromHeaders } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

function connectorKey(req: NextRequest): string | null {
  return connectorKeyFromHeaders(req.headers);
}

/** POST /api/connector/heartbeat — authorized liveness ping from the extension. */
export async function POST(req: NextRequest) {
  const key = connectorKey(req);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  let extensionId: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.extensionId === "string") extensionId = body.extensionId;
  } catch { /* body optional */ }
  recordHeartbeat(extensionId);
  return NextResponse.json({ ok: true }, { headers: CONNECTOR_CORS });
}
