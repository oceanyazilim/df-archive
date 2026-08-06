import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./auth";

/** Guard for every /api/admin route. Returns a 401 response, or null when signed in. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in first." } }, { status: 401 });
}
