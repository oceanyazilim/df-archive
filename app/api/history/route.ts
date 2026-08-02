import { NextRequest, NextResponse } from "next/server";
import { listHistory, clearHistoryStore, historyStats } from "@core/history/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/history?stats=1 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("stats") === "1") return NextResponse.json(historyStats());
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100));
  return NextResponse.json({ items: listHistory(limit) });
}

/** DELETE /api/history */
export async function DELETE() {
  clearHistoryStore();
  return NextResponse.json({ cleared: true });
}
