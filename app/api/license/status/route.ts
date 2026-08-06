import { NextRequest, NextResponse } from "next/server";
import { heartbeatLicense, licenseStatus } from "@core/license/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/license/status — is this installation activated? Local only; the
 * token itself is never included. `?check=1` forces a panel round-trip
 * (used at app start and by the desktop shell's periodic check).
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("check") === "1") {
    return NextResponse.json(await heartbeatLicense(true));
  }
  // A non-forced call still refreshes when the interval has elapsed.
  return NextResponse.json(await heartbeatLicense(false));
}
