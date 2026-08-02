import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  verifyConnectorKey,
  rateLimit,
  isDuplicateEvent,
  completeLookupForTrack,
  connectorKeyFromHeaders,
} from "@core/connectorStore";
import { validateSanitizedPayload } from "@core/spotifyMetadata";
import { logger, maskSecret } from "@core/logger";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;

export async function OPTIONS() { return corsPreflight(); }

function connectorKey(req: NextRequest): string | null {
  return connectorKeyFromHeaders(req.headers);
}

/**
 * POST /api/connector/spotify-event
 * Receives ONE sanitized metadata payload from the paired extension, correlates
 * it to a pending lookup by Spotify track id, and resolves the distributor.
 * The connector key authorizes delivery to THIS panel — it is not a Spotify token.
 */
export async function POST(req: NextRequest) {
  const key = connectorKey(req);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  const keyHash = createHash("sha256").update(key).digest("hex");
  if (!rateLimit(keyHash)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many events." } }, { status: 429, headers: CONNECTOR_CORS });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Body too large." } }, { status: 413, headers: CONNECTOR_CORS });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400, headers: CONNECTOR_CORS });
  }

  const validated = validateSanitizedPayload(body);
  if (!validated.ok) {
    logger.warn({ event: "connector_event_rejected", errorCategory: validated.code });
    return NextResponse.json({ error: { code: validated.code, message: validated.message } }, { status: 400, headers: CONNECTOR_CORS });
  }
  const p = validated.value;

  // Replay protection must never starve a genuine pending lookup: asking about
  // the same track again is a new request, not a replay. Complete first, and
  // treat the event as a duplicate only when nothing was waiting for it — a
  // completed lookup is no longer "pending", so it cannot be satisfied twice.
  const lookup = completeLookupForTrack(p.spotifyTrackId, p.licensorUuid, {
    trackTitle: p.trackTitle, artists: p.artists, albumTitle: p.albumTitle,
    albumLabel: p.albumLabel, isrc: p.isrc, spotifyUri: p.spotifyUri,
    trackGid: p.trackGid, capturedAt: p.capturedAt,
  });

  logger.info({
    event: "connector_event",
    trackId: p.spotifyTrackId,
    licensorUuid: maskSecret(p.licensorUuid), // masked in general logs
    matchStatus: lookup ? lookup.result?.matchStatus ?? "captured" : "no_pending_lookup",
    requestStatus: "success",
  });

  if (!lookup) {
    // Sanitized capture arrived but there is no pending lookup to complete.
    const dedupKey = `${p.spotifyTrackId}:${p.trackGid ?? "-"}:${p.licensorUuid}`;
    if (isDuplicateEvent(dedupKey)) {
      return NextResponse.json({ accepted: true, duplicate: true, connectorStatus: "captured" }, { headers: CONNECTOR_CORS });
    }
    return NextResponse.json({ accepted: true, matched: false, connectorStatus: "captured", reason: "NO_PENDING_LOOKUP" }, { headers: CONNECTOR_CORS });
  }
  return NextResponse.json({
    accepted: true,
    matched: true,
    requestId: lookup.requestId,
    matchStatus: lookup.result?.matchStatus,
    connectorStatus: "captured",
  }, { headers: CONNECTOR_CORS });
}
