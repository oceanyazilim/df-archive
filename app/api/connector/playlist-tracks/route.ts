import { NextRequest, NextResponse } from "next/server";
import { verifyConnectorKey, connectorKeyFromHeaders, completePlaylistFetch } from "@core/connectorStore";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/connector/playlist-tracks — the desktop shell delivers the track
 * items it read from the user's own Spotify client for a queued playlist
 * fetch: { requestId, items, total, playlistName } or { requestId, error }.
 */
export async function POST(req: NextRequest) {
  const key = connectorKeyFromHeaders(req.headers);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const ok = completePlaylistFetch(body.requestId, {
    items: body.items,
    total: body.total,
    playlistName: body.playlistName,
    viaPlatform: body.viaPlatform,
    error: body.error,
  });
  if (!ok) {
    return NextResponse.json({ error: { code: "UNKNOWN_REQUEST", message: "No pending playlist fetch with this id." } }, { status: 404, headers: CONNECTOR_CORS });
  }
  return NextResponse.json({ ok: true }, { headers: CONNECTOR_CORS });
}
