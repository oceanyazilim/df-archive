import { NextRequest, NextResponse } from "next/server";
import { listHistory, clearHistoryStore, historyStats } from "@core/history/store";
import { ADMIN_COOKIE_NAME, isValidAdminSession } from "@core/adminStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (isValidAdminSession(token)) return null;
  return NextResponse.json({ error: { code: "ADMIN_ONLY", message: "Lookup history is only visible to the site admin." } }, { status: 403 });
}

/** GET /api/history?stats=1 — every past query across the tool, admin-only. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (req.nextUrl.searchParams.get("stats") === "1") return NextResponse.json(historyStats());
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100));
  return NextResponse.json({ items: listHistory(limit) });
}

/** DELETE /api/history — admin-only, destructive. */
export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  clearHistoryStore();
  return NextResponse.json({ cleared: true });
}
