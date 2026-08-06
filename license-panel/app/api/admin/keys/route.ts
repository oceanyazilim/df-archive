import { NextRequest, NextResponse } from "next/server";
import { createKeys, keyStatus, listKeys, sharingSignal, type KeyType } from "@/store";
import { requireAdmin } from "@/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: KeyType[] = ["single", "duration", "unlimited"];

/** GET — every key with its status, device count and sharing signal. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const keys = listKeys().map((k) => ({
    id: k.id,
    key: k.key,
    type: k.type,
    durationDays: k.durationDays,
    deviceLimit: k.deviceLimit,
    note: k.note,
    createdAt: new Date(k.createdAt).toISOString(),
    firstActivatedAt: k.firstActivatedAt ? new Date(k.firstActivatedAt).toISOString() : null,
    expiresAt: k.expiresAt ? new Date(k.expiresAt).toISOString() : null,
    revokedAt: k.revokedAt ? new Date(k.revokedAt).toISOString() : null,
    status: keyStatus(k),
    devices: k.devices.length,
    lastSeenAt: k.devices.length ? new Date(Math.max(...k.devices.map((d) => d.lastSeenAt))).toISOString() : null,
    spotifyAccounts: k.devices.filter((d) => d.spotify).map((d) => d.spotify!.displayName ?? d.spotify!.id),
    signal: sharingSignal(k),
  }));
  return NextResponse.json({ keys });
}

/** POST { type, durationDays?, deviceLimit?, note?, count? } — issue keys. */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const type = TYPES.includes(body.type as KeyType) ? (body.type as KeyType) : null;
  if (!type) {
    return NextResponse.json({ error: { code: "MALFORMED", message: "type must be single, duration or unlimited." } }, { status: 400 });
  }
  const made = createKeys({
    type,
    durationDays: typeof body.durationDays === "number" ? body.durationDays : 30,
    deviceLimit: typeof body.deviceLimit === "number" ? body.deviceLimit : 1,
    note: typeof body.note === "string" ? body.note : null,
    count: typeof body.count === "number" ? body.count : 1,
  });
  return NextResponse.json({ ok: true, keys: made.map((k) => ({ id: k.id, key: k.key, type: k.type })) });
}
