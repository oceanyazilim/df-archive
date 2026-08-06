import { NextRequest, NextResponse } from "next/server";
import { buildPlaylistCatalog } from "@core/playlist/catalog";
import { SoundchartsError } from "@core/soundcharts/errors";
import { PoolUnavailableError } from "@core/credentialPool";
import { ADMIN_COOKIE_NAME, isValidAdminSession } from "@core/adminStore";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * GET /api/playlist/{playlistId}/catalog — the playlist's tracklist with
 * removed (unplayable/withdrawn) entries flagged, in the same data contract
 * as the artist catalogue. Admin-only, like artist analysis: it exposes the
 * removed history and drives many provider calls.
 */
export async function GET(req: NextRequest, ctx: { params: { playlistId: string } }) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!isValidAdminSession(token)) {
    return NextResponse.json({ error: { code: "ADMIN_ONLY", message: "Playlist analysis is only available to the site admin. Sign in from the user menu." } }, { status: 403 });
  }
  const playlistId = ctx.params.playlistId;
  if (!ID_RE.test(playlistId)) {
    return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid Spotify playlist id." } }, { status: 400 });
  }
  try {
    const catalog = await buildPlaylistCatalog(playlistId);
    return NextResponse.json({ kind: "playlist_catalog", catalog, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof PoolUnavailableError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus });
    }
    const e = err instanceof SoundchartsError ? err : null;
    const message = e?.message ?? (err instanceof Error ? err.message : "Playlist catalogue could not be built.");
    return NextResponse.json({ error: { code: e?.code ?? "PLAYLIST_CATALOG_FAILED", message } }, { status: e?.httpStatus ?? 500 });
  }
}
