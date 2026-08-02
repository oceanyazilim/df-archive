import { NextResponse } from "next/server";
import { internalUsage, getOfficialQuota } from "@core/soundcharts/usage";
import { isSoundchartsConfigured } from "@core/soundcharts/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/usage — internal usage metrics + official quota (if exposed). No secrets. */
export async function GET() {
  const quota = await getOfficialQuota();
  return NextResponse.json({
    soundchartsConfigured: isSoundchartsConfigured(),
    internal: internalUsage(),
    officialQuota: quota, // null when the plan/route does not expose it
  });
}
