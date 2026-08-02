import { NextRequest, NextResponse } from "next/server";
import { buildArtistCatalog } from "@core/artist/catalog";
import { SoundchartsError } from "@core/soundcharts/errors";
import { PoolUnavailableError } from "@core/credentialPool";
import { CONNECTOR_CORS, corsPreflight } from "../../../connector/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARTIST_RE = /^[A-Za-z0-9]{22}$/;

export async function OPTIONS() { return corsPreflight(); }

/**
 * GET /api/artist/{artistId}/catalog?maxAlbums=&maxSongs=
 *
 * The artist's full track catalogue: everything currently on their Spotify
 * profile, plus everything the analytics catalogue still lists for them but
 * that is no longer on the profile (`onProfile: false`). Distributors are not
 * included — those need a licensor UUID from the user's own Spotify client and
 * are filled in progressively by the panel.
 */
export async function GET(req: NextRequest, ctx: { params: { artistId: string } }) {
  const artistId = ctx.params.artistId;
  if (!ARTIST_RE.test(artistId)) {
    return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid Spotify artist id." } }, { status: 400, headers: CONNECTOR_CORS });
  }
  const int = (name: string, dflt: number, max: number) => {
    const raw = Number.parseInt(req.nextUrl.searchParams.get(name) ?? "", 10);
    return Number.isFinite(raw) ? Math.min(max, Math.max(1, raw)) : dflt;
  };

  try {
    const catalog = await buildArtistCatalog(artistId, {
      maxAlbums: int("maxAlbums", 120, 300),
      maxSongs: int("maxSongs", 1000, 2000),
    });
    return NextResponse.json({ kind: "artist_catalog", catalog, fetchedAt: new Date().toISOString() }, { headers: CONNECTOR_CORS });
  } catch (err) {
    if (err instanceof PoolUnavailableError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus, headers: CONNECTOR_CORS });
    }
    const e = err instanceof SoundchartsError ? err : null;
    const message = e?.message ?? (err instanceof Error ? err.message : "Artist catalogue could not be built.");
    return NextResponse.json(
      { error: { code: e?.code ?? "ARTIST_CATALOG_FAILED", message } },
      { status: e?.httpStatus ?? 500, headers: CONNECTOR_CORS }
    );
  }
}
