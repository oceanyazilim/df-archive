import { NextRequest, NextResponse } from "next/server";
import { recoverRemovedTrack } from "@core/artist/recover";
import { SoundchartsError } from "@core/soundcharts/errors";
import { PoolUnavailableError } from "@core/credentialPool";
import { ADMIN_COOKIE_NAME, isValidAdminSession } from "@core/adminStore";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Soundcharts song uuids are dashed hex, e.g. 11e84091-06bb-26fc-a391-aa1c026db3d8.
const SONG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * GET /api/artist/recover-track?songUuid=…&spotifyTrackId=…&isrc=… — recover
 * ISRC/UPC/Spotify id for a removed track. Artist-catalogue rows come in with
 * a Soundcharts uuid, playlist rows with the (delisted) Spotify id; at least
 * one is required. Same admin gate as the catalogues this data belongs to.
 */
export async function GET(req: NextRequest) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!isValidAdminSession(token)) {
    return NextResponse.json({ error: { code: "ADMIN_ONLY", message: "Artist analysis is only available to the site admin." } }, { status: 403 });
  }
  const rawUuid = req.nextUrl.searchParams.get("songUuid") ?? "";
  const songUuid = SONG_UUID_RE.test(rawUuid) ? rawUuid.toLowerCase() : null;
  const rawSpotifyId = req.nextUrl.searchParams.get("spotifyTrackId") ?? "";
  const spotifyTrackId = SPOTIFY_ID_RE.test(rawSpotifyId) ? rawSpotifyId : null;
  if (!songUuid && !spotifyTrackId) {
    return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "A valid analytics song id or Spotify track id is required." } }, { status: 400 });
  }
  // Optional ISRC the catalogue already knows — a fallback input, validated strictly.
  const rawIsrc = req.nextUrl.searchParams.get("isrc") ?? "";
  const knownIsrc = /^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/.test(rawIsrc) ? rawIsrc.toUpperCase() : null;
  try {
    const track = await recoverRemovedTrack(songUuid, knownIsrc, spotifyTrackId);
    return NextResponse.json({ kind: "recovered_track", track, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof PoolUnavailableError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus });
    }
    const e = err instanceof SoundchartsError ? err : null;
    const message = e?.message ?? (err instanceof Error ? err.message : "The removed track could not be recovered.");
    return NextResponse.json({ error: { code: e?.code ?? "TRACK_RECOVERY_FAILED", message } }, { status: e?.httpStatus ?? 500 });
  }
}
