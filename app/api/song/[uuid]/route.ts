import { NextRequest, NextResponse } from "next/server";
import { getSongMetadata } from "@core/soundcharts/song";
import { SoundchartsError } from "@core/soundcharts/errors";
import { isSoundchartsConfigured } from "@core/soundcharts/config";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{32,36}$/i;

/** GET /api/song/{uuid} — Soundcharts song metadata by UUID. */
export async function GET(_req: NextRequest, ctx: { params: { uuid: string } }) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const uuid = ctx.params.uuid;
  if (!UUID_RE.test(uuid)) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid song UUID." } }, { status: 400 });
  if (!isSoundchartsConfigured()) return NextResponse.json({ error: { code: "SOUNDCHARTS_NOT_CONFIGURED", message: "Soundcharts is not configured." } }, { status: 503 });
  try {
    const song = await getSongMetadata(uuid);
    if (!song) return NextResponse.json({ error: { code: "SOUNDCHARTS_NOT_FOUND", message: "Song not found." } }, { status: 404 });
    return NextResponse.json({ song });
  } catch (err) {
    const e = err instanceof SoundchartsError ? err : new SoundchartsError("INTERNAL_SERVER_ERROR", "Failed.");
    return NextResponse.json({ error: e.toSafeJSON() }, { status: e.httpStatus ?? 500 });
  }
}
