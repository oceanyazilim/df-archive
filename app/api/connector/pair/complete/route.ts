import { NextRequest, NextResponse } from "next/server";
import { completePairing } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

/** POST /api/connector/pair/complete — exchange a pairing code for a connector key. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400, headers: CONNECTOR_CORS });
  }
  const out = completePairing(body.code);
  if (!out.ok) {
    return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: 400, headers: CONNECTOR_CORS });
  }
  // The connector key is returned exactly once, to the companion only.
  return NextResponse.json({ connectorKey: out.connectorKey }, { headers: CONNECTOR_CORS });
}
