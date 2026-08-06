import { NextRequest, NextResponse } from "next/server";
import { getSongIdentifiers, getSongAlbums, getSongPlaylists, getSongChartRanks, getSongBroadcastGroups } from "@core/soundcharts/song";
import { SoundchartsError } from "@core/soundcharts/errors";
import { isSoundchartsConfigured } from "@core/soundcharts/config";
import { requireLicense } from "@core/license/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{32,36}$/i;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * GET /api/song/{uuid}/analytics — documented secondary data: identifiers,
 * albums, playlists, chart ranks, radio airplay. Responses are trimmed to
 * small display-safe objects. Plan-restricted (403) or missing (404)
 * capabilities are reported per-capability, never as a whole-app failure.
 */
export async function GET(_req: NextRequest, ctx: { params: { uuid: string } }) {
  const unlicensed = requireLicense();
  if (unlicensed) return unlicensed;
  const uuid = ctx.params.uuid;
  if (!UUID_RE.test(uuid)) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid song UUID." } }, { status: 400 });
  if (!isSoundchartsConfigured()) return NextResponse.json({ error: { code: "SOUNDCHARTS_NOT_CONFIGURED", message: "Soundcharts is not configured." } }, { status: 503 });

  const capabilities: Record<string, "available" | "plan_restricted" | "unavailable" | "not_found"> = {};
  const data: Record<string, unknown> = {};

  async function load(key: string, fn: () => Promise<unknown>) {
    try { data[key] = await fn(); capabilities[key] = "available"; }
    catch (err) {
      const e = err instanceof SoundchartsError ? err : null;
      capabilities[key] = e?.code === "SOUNDCHARTS_PLAN_RESTRICTED" ? "plan_restricted" : e?.code === "SOUNDCHARTS_NOT_FOUND" ? "not_found" : "unavailable";
      data[key] = null;
    }
  }

  // Load sequentially through the shared limiter (avoids firing all at once).
  await load("identifiers", () => getSongIdentifiers(uuid));
  await load("albums", () => getSongAlbums(uuid));
  await load("playlists", async () => {
    const items = await getSongPlaylists(uuid, "spotify");
    return items.map((it) => {
      const pl = (it.playlist ?? {}) as Record<string, unknown>;
      return {
        name: str(pl.name), type: str(pl.type), countryCode: str(pl.countryCode),
        identifier: str(pl.identifier), imageUrl: str(pl.imageUrl),
        subscriberCount: num(pl.latestSubscriberCount),
        position: num(it.position), peakPosition: num(it.peakPosition),
        entryDate: str(it.entryDate),
      };
    }).sort((a, b) => (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0)).slice(0, 30);
  });
  await load("charts", async () => {
    const items = await getSongChartRanks(uuid, "spotify");
    return items.map((it) => {
      const ch = (it.chart ?? {}) as Record<string, unknown>;
      return {
        name: str(ch.name) ?? str(it.name), countryCode: str(ch.countryCode) ?? str(it.countryCode),
        position: num(it.position) ?? num(it.rank), oldPosition: num(it.oldPosition),
        date: str(it.rankDate) ?? str(it.date),
      };
    }).slice(0, 30);
  });
  await load("radio", async () => {
    const items = await getSongBroadcastGroups(uuid);
    return items.map((it) => {
      const r = (it.radio ?? {}) as Record<string, unknown>;
      return { name: str(r.name), city: str(r.cityName), country: str(r.countryName) ?? str(r.countryCode), playCount: num(it.playCount) };
    }).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 30);
  });

  return NextResponse.json({ uuid, capabilities, data, freshness: new Date().toISOString() });
}
