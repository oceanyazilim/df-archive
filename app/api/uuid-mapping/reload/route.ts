import { NextResponse } from "next/server";
import { reloadUuidMapping, uuidMappingStatus } from "@core/uuidResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/uuid-mapping/reload
 * Safely reloads json/uuid's.json from disk without restarting the app.
 */
export async function POST() {
  try {
    reloadUuidMapping();
    return NextResponse.json({ reloaded: true, ...uuidMappingStatus() });
  } catch (err) {
    return NextResponse.json(
      { reloaded: false, error: { code: "RELOAD_FAILED", message: (err as Error).message } },
      { status: 500 }
    );
  }
}
