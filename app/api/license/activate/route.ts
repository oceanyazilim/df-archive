import { NextRequest, NextResponse } from "next/server";
import { activateLicense, deactivateLicense, licenseStatus } from "@core/license/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/license/activate { key } — activate this installation. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated in the client */ }
  const out = await activateLicense(body.key);
  if (!out.ok) {
    const status = out.code === "SERVER_UNREACHABLE" ? 503 : out.code === "MALFORMED" ? 400 : 403;
    return NextResponse.json({ error: { code: out.code, message: out.message } }, { status });
  }
  return NextResponse.json({ ok: true, status: out.status });
}

/** DELETE /api/license/activate — forget the license on this computer. */
export async function DELETE() {
  deactivateLicense();
  return NextResponse.json({ ok: true, status: licenseStatus() });
}
