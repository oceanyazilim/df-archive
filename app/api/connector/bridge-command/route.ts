import { NextRequest, NextResponse } from "next/server";
import {
  verifyConnectorKey,
  connectorKeyFromHeaders,
  requestBridgeCommand,
  takeBridgeCommand,
  completeBridgeCommand,
  bridgeCommandState,
} from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/connector/bridge-command — the panel queues a command for the
 * desktop shell ({ action: "reconnect" }). Unauthenticated by design, like
 * pair/start: the server only listens on 127.0.0.1 and the only possible
 * effect is relaunching Spotify with the app link enabled.
 *
 * The desktop shell polls with ?take=1 (connector-authorized) to claim the
 * pending command, and reports the outcome with { completeId, ok, message }.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* fall through to validation */ }

  // Desktop shell reporting a finished command (authorized).
  if (typeof body.completeId === "string") {
    const key = connectorKeyFromHeaders(req.headers);
    if (!key || !verifyConnectorKey(key)) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
    }
    completeBridgeCommand(body.completeId, body.ok, body.message);
    return NextResponse.json({ ok: true }, { headers: CONNECTOR_CORS });
  }

  const out = requestBridgeCommand(body.action);
  if (!out.ok) {
    return NextResponse.json({ error: { code: out.code, message: "Unsupported bridge command." } }, { status: 400, headers: CONNECTOR_CORS });
  }
  return NextResponse.json({ ok: true, id: out.id }, { headers: CONNECTOR_CORS });
}

/** GET — panel polls state; the desktop shell claims with ?take=1. */
export async function GET(req: NextRequest) {
  const take = req.nextUrl.searchParams.get("take") === "1";
  if (take) {
    const key = connectorKeyFromHeaders(req.headers);
    if (!key || !verifyConnectorKey(key)) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
    }
    return NextResponse.json({ command: takeBridgeCommand() }, { headers: CONNECTOR_CORS });
  }
  return NextResponse.json(bridgeCommandState(), { headers: CONNECTOR_CORS });
}
