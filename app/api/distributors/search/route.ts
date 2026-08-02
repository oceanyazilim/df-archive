import { NextRequest, NextResponse } from "next/server";
import { searchLocalMapping } from "@core/distributor/localMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/distributors/search?q=&conflicts=1 — bounded local-mapping search. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 128);
  const conflictsOnly = req.nextUrl.searchParams.get("conflicts") === "1";
  const out = searchLocalMapping(q, conflictsOnly);
  return NextResponse.json(out);
}
