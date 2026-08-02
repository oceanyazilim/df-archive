import { NextResponse } from "next/server";
import { uuidMappingStatus } from "@core/uuidResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/uuid-mapping/status
 * Reports non-sensitive mapping health. Never returns the full UUID list.
 */
export async function GET() {
  const s = uuidMappingStatus();
  return NextResponse.json(s, { status: s.loaded ? 200 : 500 });
}
