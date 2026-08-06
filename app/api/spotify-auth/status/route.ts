import { NextResponse } from "next/server";
import { accountStatus } from "@core/spotifyAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spotify-auth/status — safe link status only. Never includes tokens. */
export async function GET() {
  return NextResponse.json(accountStatus());
}
