import { NextRequest, NextResponse } from "next/server";
import { stats } from "@/store";
import { requireAdmin } from "@/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/stats — dashboard counters. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(stats());
}
