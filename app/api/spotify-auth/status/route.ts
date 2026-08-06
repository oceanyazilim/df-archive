import { NextRequest, NextResponse } from "next/server";
import { accountStatus, oauthClientId } from "@core/spotifyAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify-auth/status — safe link status only. Never includes tokens.
 *
 * It also reports the exact redirect URI this installation will send and
 * whether a client id is configured at all: "authorization failed" is almost
 * always one of those two, and guessing which wastes everyone's time.
 */
export async function GET(req: NextRequest) {
  const host = (req.headers.get("host") || "127.0.0.1:3000").replace(/^localhost(?=[:/]|$)/i, "127.0.0.1");
  const clientId = oauthClientId();
  return NextResponse.json({
    ...accountStatus(),
    setup: {
      configured: !!clientId,
      // Head/tail only — enough to match against the dashboard, never enough to reuse.
      clientIdHint: clientId ? `${clientId.slice(0, 4)}…${clientId.slice(-4)}` : null,
      redirectUri: process.env.SPOTIFY_OAUTH_REDIRECT_URI || `http://${host}/api/spotify-auth/callback`,
    },
  });
}
