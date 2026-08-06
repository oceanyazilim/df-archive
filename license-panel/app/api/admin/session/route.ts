import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, isConfigured, isValidSession, verifyPassword } from "@/auth";
import { clientIp } from "@/request";
import { allow } from "@/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — is this browser signed in? Also reports missing configuration so a
 *  fresh deployment explains itself instead of failing mysteriously. */
export async function GET(req: NextRequest) {
  const cfg = isConfigured();
  return NextResponse.json({
    signedIn: cfg.ok && isValidSession(req.cookies.get(SESSION_COOKIE)?.value),
    configured: cfg.ok,
    missing: cfg.missing,
  });
}

/** POST { password } — sign in. */
export async function POST(req: NextRequest) {
  if (!allow(clientIp(req), 10)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait a minute." } }, { status: 429 });
  }
  const cfg = isConfigured();
  if (!cfg.ok) {
    return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: `Set ${cfg.missing.join(" and ")} on the server first.` } }, { status: 503 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }
  if (!verifyPassword(body.password)) {
    return NextResponse.json({ error: { code: "BAD_PASSWORD", message: "Wrong password." } }, { status: 401 });
  }
  const session = createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

/** DELETE — sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
