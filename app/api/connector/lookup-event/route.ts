import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey, setLookupStage, LookupStage, connectorKeyFromHeaders } from "@core/connectorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectorKey(req: NextRequest): string | null {
  return connectorKeyFromHeaders(req.headers);
}

const ALLOWED: LookupStage[] = ["opening_spotify", "waiting_for_metadata", "login_required", "cancelled"];

/**
 * POST /api/connector/lookup-event — authorized. The extension reports a stage
 * transition (opening/waiting/login_required/cancelled) for a pending lookup so
 * the panel can show a specific state instead of an infinite spinner.
 */
export async function POST(req: NextRequest) {
  const key = connectorKey(req);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400 });
  }
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const event = body.event as LookupStage;
  if (!requestId || !ALLOWED.includes(event)) {
    return NextResponse.json({ error: { code: "INVALID_EVENT", message: "Unknown event or requestId." } }, { status: 400 });
  }
  const lookup = setLookupStage(requestId, event);
  if (!lookup) return NextResponse.json({ error: { code: "LOOKUP_NOT_FOUND", message: "Unknown lookup." } }, { status: 404 });
  return NextResponse.json({ ok: true, stage: lookup.stage, status: lookup.status });
}
