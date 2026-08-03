import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, createAdminSession, verifyAdminPassword } from "@core/adminStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/login — password in, httpOnly session cookie out. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = body && typeof body.password === "string" ? body.password : "";
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: { code: "INVALID_PASSWORD", message: "Incorrect password." } }, { status: 401 });
  }
  const session = createAdminSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, session, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
