import { NextRequest, NextResponse } from "next/server";
import { extractSpotifyTrackId } from "@core/spotifyMetadata";
import { createLookup } from "@core/connectorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lookup/start
 * Body: { "input": "https://open.spotify.com/track/..." } (url/uri/id)
 * Creates a short-lived pending lookup keyed by the public Spotify track id.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400 });
  }
  const trackId = extractSpotifyTrackId(body.input ?? body.url ?? body.uri ?? body.trackId);
  if (!trackId) {
    return NextResponse.json(
      { error: { code: "INVALID_SPOTIFY_INPUT", message: "Provide a Spotify track URL, URI, or ID (albums/artists/playlists are rejected)." } },
      { status: 400 }
    );
  }
  const lookup = createLookup(trackId);
  return NextResponse.json({
    requestId: lookup.requestId,
    spotifyTrackId: lookup.spotifyTrackId,
    spotifyUrl: `https://open.spotify.com/track/${lookup.spotifyTrackId}`,
    status: lookup.status,
    expiresAt: new Date(lookup.expiresAt).toISOString(),
    timeoutSeconds: Math.round((lookup.expiresAt - Date.now()) / 1000),
  });
}
