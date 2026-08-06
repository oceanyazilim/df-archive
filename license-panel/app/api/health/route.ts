import { NextResponse } from "next/server";
import { isConfigured } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — Dokploy's health check. Never exposes configuration values. */
export async function GET() {
  const cfg = isConfigured();
  return NextResponse.json({ status: "ok", service: "virus-records-license-panel", configured: cfg.ok });
}
