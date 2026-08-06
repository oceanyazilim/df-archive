import { NextRequest, NextResponse } from "next/server";
import { beginAuth } from "@core/spotifyAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify-auth/login — start the user-consent flow. Redirects the
 * browser to Spotify's official authorization page (Authorization Code +
 * PKCE). Unauthenticated by design, like pair/start: the server listens on
 * 127.0.0.1 only, and the flow cannot complete without the user consenting on
 * accounts.spotify.com in their own browser.
 */
export async function GET(req: NextRequest) {
  // Build the origin from the Host header, not nextUrl.origin — Next can
  // normalize the loopback IP to "localhost", and Spotify only accepts the
  // literal 127.0.0.1 form for loopback redirect URIs.
  const host = (req.headers.get("host") || "127.0.0.1:3000").replace(/^localhost(?=[:/]|$)/i, "127.0.0.1");
  const out = beginAuth(`http://${host}`);
  if (!out.ok) {
    return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: 503 });
  }
  return NextResponse.redirect(out.url, 302);
}
