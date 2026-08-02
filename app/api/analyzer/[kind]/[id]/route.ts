import { NextRequest, NextResponse } from "next/server";
import { analyze, AnalyzerError, AnalyzerKind } from "@core/analyzer/service";
import { SoundchartsError } from "@core/soundcharts/errors";
import { normalizeLicensorUuid } from "@core/spotifyMetadata";
import { CONNECTOR_CORS, corsPreflight } from "../../../connector/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AnalyzerKind[] = ["track", "album", "artist", "playlist"];
const ID_RE = /^[A-Za-z0-9]{22}$/;

export async function OPTIONS() { return corsPreflight(); }

/**
 * GET /api/analyzer/{track|album|artist|playlist}/{id}?licensorUuid=&days=
 *
 * Serves the in-Spotify Ocean Analyzer modal (and anything else that wants a
 * single consolidated view). Only real data is returned; sections without
 * upstream data carry an explicit availability state instead of placeholders.
 *
 * `licensorUuid` is optional and only meaningful for tracks: it is the value
 * the extension captured from the user's OWN Spotify session, since the public
 * Web API never exposes it. It is validated as 32-hex before use and matched
 * exactly against the canonical mapping — never inferred from label or ISRC.
 *
 * CORS is open because responses are non-sensitive public metadata plus this
 * user's own analytics; no credentials or cookies are involved.
 */
export async function GET(req: NextRequest, ctx: { params: { kind: string; id: string } }) {
  const kind = ctx.params.kind as AnalyzerKind;
  const id = ctx.params.id;

  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: { code: "INVALID_KIND", message: "Unsupported analyzer target." } }, { status: 400, headers: CONNECTOR_CORS });
  }
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid Spotify id." } }, { status: 400, headers: CONNECTOR_CORS });
  }

  const licensorUuid = normalizeLicensorUuid(req.nextUrl.searchParams.get("licensorUuid"));
  const daysRaw = Number.parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(7, daysRaw)) : 30;

  try {
    const data = await analyze(kind, id, { licensorUuid, days });
    return NextResponse.json({ kind, data, fetchedAt: new Date().toISOString() }, { headers: CONNECTOR_CORS });
  } catch (err) {
    // Analyzer + Soundcharts errors already carry a safe, user-facing message;
    // anything else is reported generically so internals never leak.
    if (err instanceof AnalyzerError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.httpStatus, headers: CONNECTOR_CORS });
    }
    const e = err instanceof SoundchartsError ? err : null;
    return NextResponse.json(
      { error: { code: e?.code ?? "ANALYZER_FAILED", message: e?.message ?? "Analysis failed." } },
      { status: e?.httpStatus ?? 500, headers: CONNECTOR_CORS }
    );
  }
}
