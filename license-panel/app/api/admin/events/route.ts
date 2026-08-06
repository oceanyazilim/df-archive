import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/store";
import { requireAdmin } from "@/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/events?limit=&outcome= — the full activity trail, newest first. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const limit = Math.min(1000, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "300", 10) || 300));
  const outcome = req.nextUrl.searchParams.get("outcome") ?? undefined;
  const events = listEvents({ limit, outcome: outcome && outcome !== "all" ? outcome : undefined })
    .map((e) => ({ ...e, at: new Date(e.at).toISOString() }));
  return NextResponse.json({ events });
}
