import { NextRequest, NextResponse } from "next/server";
import { revokeConnectorKey, connectorKeyFromHeaders } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

function connectorKey(req: NextRequest): string | null {
  return connectorKeyFromHeaders(req.headers);
}

/** POST /api/connector/disconnect — revoke the caller's connector key. */
export async function POST(req: NextRequest) {
  const key = connectorKey(req);
  if (!key) return NextResponse.json({ error: { code: "NO_KEY", message: "Missing connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  const revoked = revokeConnectorKey(key);
  return NextResponse.json({ revoked }, { headers: CONNECTOR_CORS });
}
