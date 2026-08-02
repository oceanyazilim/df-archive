import { NextResponse } from "next/server";
import { connectorStatus } from "@core/connectorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connector/status — safe connection status only (no keys). */
export async function GET() {
  const s = connectorStatus();
  return NextResponse.json({
    paired: s.paired,
    connected: s.connected,
    activeConnectors: s.activeConnectors,
    lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
    lastHeartbeatAt: s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toISOString() : null,
    heartbeatFresh: s.heartbeatFresh,
    bridge: {
      desktopAlive: s.bridge.desktopAlive,
      spotifyRunning: s.bridge.spotifyRunning,
      debuggable: s.bridge.debuggable,
      reportedAt: s.bridge.reportedAt ? new Date(s.bridge.reportedAt).toISOString() : null,
    },
  });
}
