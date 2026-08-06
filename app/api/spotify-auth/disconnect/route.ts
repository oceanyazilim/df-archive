import { NextResponse } from "next/server";
import { disconnectAccount } from "@core/spotifyAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/spotify-auth/disconnect — forget the linked account. The stored
 * tokens are deleted locally; the grant itself can also be revoked by the
 * user at spotify.com/account/apps.
 */
export async function POST() {
  return NextResponse.json({ ok: true, removed: disconnectAccount() });
}
