import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isValidAdminSession } from "@core/adminStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/session — the one call the client makes to know its own role. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  return NextResponse.json({ isAdmin: isValidAdminSession(token) });
}
