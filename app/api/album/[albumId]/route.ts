import { NextRequest, NextResponse } from "next/server";
import { resolveAlbum } from "@core/album/service";
import { SoundchartsError } from "@core/soundcharts/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALBUM_RE = /^[A-Za-z0-9]{22}$/;

/** GET /api/album/{albumId} — release metadata + ordered tracklist (no per-track analysis). */
export async function GET(_req: NextRequest, ctx: { params: { albumId: string } }) {
  const albumId = ctx.params.albumId;
  if (!ALBUM_RE.test(albumId)) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid Spotify album id." } }, { status: 400 });
  try {
    const release = await resolveAlbum(albumId);
    return NextResponse.json({ kind: "album", release });
  } catch (err) {
    const e = err instanceof SoundchartsError ? err : new SoundchartsError("INTERNAL_SERVER_ERROR", "Album lookup failed.");
    return NextResponse.json({ error: e.toSafeJSON() }, { status: e.httpStatus ?? (e.code === "SPOTIFY_NOT_CONFIGURED" ? 503 : 500) });
  }
}
