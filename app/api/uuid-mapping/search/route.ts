import { NextRequest, NextResponse } from "next/server";
import { searchLocalMapping } from "@core/distributor/localMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/uuid-mapping/search?q=&conflicts=1 — protected, capped search. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 128);
  const conflictsOnly = req.nextUrl.searchParams.get("conflicts") === "1";
  if (!q && !conflictsOnly) {
    // Do not dump the whole mapping; require a query or conflict filter.
    return NextResponse.json({ results: [], conflicts: [], truncated: false, hint: "Provide q= or conflicts=1" });
  }
  return NextResponse.json(searchLocalMapping(q, conflictsOnly));
}
