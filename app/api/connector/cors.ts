import { NextResponse } from "next/server";

/**
 * CORS headers for endpoints called by the Spicetify companion, which runs in
 * the Spotify desktop client's renderer (origin https://xpui.app.spotify.com)
 * and reaches this app over loopback fetch. Open origin is acceptable: every
 * data-bearing endpoint still requires the connector key, no cookies are used,
 * and responses expose nothing sensitive. The key travels in the Authorization
 * or X-Connector-Key header, so both must be preflight-allowed.
 */
export const CONNECTOR_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Connector-Key",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CONNECTOR_CORS });
}
