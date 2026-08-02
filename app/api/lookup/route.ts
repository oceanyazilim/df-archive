import { NextRequest, NextResponse } from "next/server";
import { resolveTrack } from "@core/lookup/service";
import { resolveAlbum } from "@core/album/service";
import { addHistory } from "@core/history/store";
import { normalizeLicensorUuid } from "@core/spotifyMetadata";
import { getLookupConfig } from "@core/soundcharts/config";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { findAlbumIdByUpc } from "@core/spotify";
import { SoundchartsError } from "@core/soundcharts/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4 * 1024;

/**
 * POST /api/lookup { input, connector? }
 * Returns a discriminated result:
 *   - { kind: "album", release }  for a Spotify album/EP link
 *   - { kind: "track", ...workspace } for a single track / ISRC / Soundcharts UUID
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Request body too large." } }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid JSON." } }, { status: 400 }); }

  const input = typeof body.input === "string" ? body.input : "";
  if (!input.trim()) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Provide an 'input' value." } }, { status: 400 });

  const parsed = parseMusicLookupInput(input);

  // ---- Artist: the panel switches to the catalogue view ----
  if (parsed.type === "spotify_artist") {
    return NextResponse.json({ kind: "artist", spotifyArtistId: parsed.normalizedValue });
  }

  // ---- UPC: resolve the barcode to its Spotify release, then treat as album ----
  if (parsed.type === "upc") {
    const albumId = await findAlbumIdByUpc(parsed.normalizedValue).catch(() => null);
    if (!albumId) {
      return NextResponse.json({ error: { code: "UPC_NOT_FOUND", message: "No Spotify release was found for this UPC." } }, { status: 404 });
    }
    try {
      const release = await resolveAlbum(albumId);
      return NextResponse.json({ kind: "album", release });
    } catch (err) {
      const e = err instanceof SoundchartsError ? err : new SoundchartsError("INTERNAL_SERVER_ERROR", "Album lookup failed.");
      return NextResponse.json({ error: e.toSafeJSON() }, { status: e.httpStatus ?? 500 });
    }
  }

  // ---- Album/EP/multi-track release ----
  if (parsed.type === "spotify_album") {
    try {
      const release = await resolveAlbum(parsed.normalizedValue);
      return NextResponse.json({ kind: "album", release });
    } catch (err) {
      const e = err instanceof SoundchartsError ? err : new SoundchartsError("INTERNAL_SERVER_ERROR", "Album lookup failed.");
      return NextResponse.json({ error: e.toSafeJSON() }, { status: e.httpStatus ?? (e.code === "SPOTIFY_NOT_CONFIGURED" ? 503 : 500) });
    }
  }

  // ---- Single track / ISRC / Soundcharts UUID ----
  const c = body.connector as { licensorUuid?: unknown; name?: unknown } | undefined;
  const connector = c ? { licensorUuid: normalizeLicensorUuid(c.licensorUuid), name: typeof c.name === "string" ? c.name : null } : undefined;

  const started = Date.now();
  const { requestTimeoutMs } = getLookupConfig();
  const ws = await Promise.race([
    resolveTrack(input, connector),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), requestTimeoutMs)),
  ]).catch((e) => ((e as Error).message === "timeout" ? null : Promise.reject(e)));

  if (!ws) return NextResponse.json({ error: { code: "SOUNDCHARTS_TIMEOUT", message: "The lookup timed out." } }, { status: 504 });

  const durationMs = Date.now() - started;
  addHistory({
    input: ws.input.normalized || input.slice(0, 200),
    inputType: ws.input.type,
    soundchartsSongUuid: ws.identity.soundchartsSongUuid,
    trackTitle: ws.metadata.trackTitle,
    artists: ws.metadata.artists,
    isrc: ws.identity.isrc,
    distributor: ws.distributor.name,
    resolutionStatus: ws.distributor.status,
    durationMs,
    artworkUrl: ws.metadata.artworkUrl,
    albumTitle: ws.metadata.albumTitle,
    spotifyTrackId: ws.identity.spotifyTrackId,
    spotifyAlbumId: ws.identity.spotifyAlbumId,
    label: ws.metadata.label,
    releaseDate: ws.metadata.releaseDate,
  });

  return NextResponse.json({ kind: "track", ...ws, durationMs, timing: { totalMs: durationMs } });
}
