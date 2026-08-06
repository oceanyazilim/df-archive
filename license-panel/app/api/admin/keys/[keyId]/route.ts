import { NextRequest, NextResponse } from "next/server";
import { deleteKey, getKey, keyStatus, listEvents, releaseDevice, revokeKey, setDeviceBlocked, sharingSignal } from "@/store";
import { requireAdmin } from "@/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — one key in full: bound devices, their IP history, Spotify identities,
 *  and this key's slice of the audit trail. */
export async function GET(req: NextRequest, ctx: { params: { keyId: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const k = getKey(ctx.params.keyId);
  if (!k) return NextResponse.json({ error: { code: "NOT_FOUND", message: "No such key." } }, { status: 404 });

  return NextResponse.json({
    key: {
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
      signal: sharingSignal(k),
      devices: k.devices.map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        appVersion: d.appVersion,
        blocked: d.blocked,
        firstSeenAt: new Date(d.firstSeenAt).toISOString(),
        lastSeenAt: new Date(d.lastSeenAt).toISOString(),
        lastIp: d.lastIp,
        ips: d.ips.map((e) => ({ ip: e.ip, at: new Date(e.at).toISOString() })).sort((a, b) => b.at.localeCompare(a.at)),
        spotify: d.spotify ? { ...d.spotify, linkedAt: new Date(d.spotify.linkedAt).toISOString() } : null,
      })),
    },
    events: listEvents({ keyId: k.id, limit: 300 }).map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
  });
}

/**
 * PATCH — key-level and device-level actions:
 *   { revoked: boolean }                     revoke / restore the key
 *   { deviceId, blocked: boolean }           block / unblock one device
 *   { deviceId, release: true }              free the device slot
 */
export async function PATCH(req: NextRequest, ctx: { params: { keyId: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }

  if (typeof body.deviceId === "string") {
    if (body.release === true) {
      const ok = releaseDevice(ctx.params.keyId, body.deviceId);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "No such device." } }, { status: 404 });
    }
    if (typeof body.blocked === "boolean") {
      const ok = setDeviceBlocked(ctx.params.keyId, body.deviceId, body.blocked);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "No such device." } }, { status: 404 });
    }
  }
  if (typeof body.revoked === "boolean") {
    const k = revokeKey(ctx.params.keyId, body.revoked);
    return k ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { code: "NOT_FOUND", message: "No such key." } }, { status: 404 });
  }
  return NextResponse.json({ error: { code: "MALFORMED", message: "Nothing to change." } }, { status: 400 });
}

/** DELETE — remove the key entirely. The audit trail keeps its history. */
export async function DELETE(req: NextRequest, ctx: { params: { keyId: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return deleteKey(ctx.params.keyId)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: { code: "NOT_FOUND", message: "No such key." } }, { status: 404 });
}
