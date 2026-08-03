import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, revokeAdminSession } from "@core/adminStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/logout — revoke the session and clear the cookie. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  revokeAdminSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
