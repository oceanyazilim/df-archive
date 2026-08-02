import { NextResponse } from "next/server";
import { createPairingCode } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

/** POST /api/connector/pair/start — panel generates a short-lived pairing code. */
export async function POST() {
  const { code, expiresAt } = createPairingCode();
  return NextResponse.json({ pairingCode: code, expiresAt, ttlSeconds: Math.round((expiresAt - Date.now()) / 1000) }, { headers: CONNECTOR_CORS });
}
