import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  verifyConnectorKey,
  rateLimit,
  isDuplicateEvent,
  completeLookupForTrack,
  connectorKeyFromHeaders,
} from "@core/connectorStore";
import { decodeTrackMetadata } from "@core/spotifyProtobuf";
import { extractSpotifyTrackId, normalizeLicensorUuid } from "@core/spotifyMetadata";
import { logger, maskSecret } from "@core/logger";
import { CONNECTOR_CORS, corsPreflight } from "../cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_B64 = 512 * 1024; // metadata responses are ~1KB; this is a generous cap

export async function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/connector/spotify-metadata  { spotifyTrackId, metadataBase64 }
 *
 * Accepts the RAW protobuf body of the Spotify client's own
 * `metadata/4/track/{gid}` response, captured by the desktop bridge, and
 * decodes it here so the wire-format knowledge lives in one tested place.
 * The licensor UUID is read only from the track-level licensor field (album
 * fallback) — never from original_audio, any gid, or the ISRC.
 *
 * No Spotify token, cookie or header is accepted or stored; the connector key
 * only authorizes delivery to THIS panel.
 */
export async function POST(req: NextRequest) {
  const key = connectorKeyFromHeaders(req.headers);
  if (!key || !verifyConnectorKey(key)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid connector key." } }, { status: 401, headers: CONNECTOR_CORS });
  }
  if (!rateLimit(createHash("sha256").update(key).digest("hex"))) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many events." } }, { status: 429, headers: CONNECTOR_CORS });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid JSON." } }, { status: 400, headers: CONNECTOR_CORS }); }

  const trackId = extractSpotifyTrackId(body.spotifyTrackId);
  const b64 = typeof body.metadataBase64 === "string" ? body.metadataBase64 : "";
  if (!trackId) {
    return NextResponse.json({ error: { code: "INVALID_TRACK_ID", message: "Invalid spotifyTrackId." } }, { status: 400, headers: CONNECTOR_CORS });
  }
  if (!b64 || b64.length > MAX_B64) {
    return NextResponse.json({ error: { code: "INVALID_PAYLOAD", message: "Missing or oversized metadata payload." } }, { status: 400, headers: CONNECTOR_CORS });
  }

  const decoded = decodeTrackMetadata(new Uint8Array(Buffer.from(b64, "base64")));
  if (!decoded) {
    logger.warn({ event: "connector_metadata_rejected", errorCategory: "UNDECODABLE" });
    return NextResponse.json({ error: { code: "UNDECODABLE", message: "Metadata could not be decoded." } }, { status: 400, headers: CONNECTOR_CORS });
  }

  const licensorUuid = normalizeLicensorUuid(decoded.licensorUuid);
  if (!licensorUuid) {
    // Honest outcome: the client's response carried no licensor UUID.
    return NextResponse.json({ accepted: true, matched: false, reason: "NO_LICENSOR_UUID" }, { headers: CONNECTOR_CORS });
  }

  // Replay protection must never starve a genuine pending lookup: a track the
  // user asks about again (e.g. while resolving a whole artist catalogue) is a
  // new request, not a replay. So complete first, and only treat the event as
  // a duplicate when there was nothing waiting for it. A completed lookup is
  // no longer "pending", so the same event can never satisfy it twice.
  const lookup = completeLookupForTrack(trackId, licensorUuid, {
    trackTitle: decoded.trackTitle,
    artists: decoded.artists,
    albumTitle: decoded.albumTitle,
    albumLabel: null, // the protobuf response carries no label field
    isrc: decoded.isrc,
    spotifyUri: `spotify:track:${trackId}`,
    trackGid: decoded.trackGid,
    capturedAt: new Date().toISOString(),
  });

  logger.info({
    event: "connector_metadata",
    trackId,
    licensorUuid: maskSecret(licensorUuid),
    matchStatus: lookup ? lookup.result?.matchStatus ?? "captured" : "no_pending_lookup",
    requestStatus: "success",
  });

  if (!lookup) {
    const dedupKey = `${trackId}:${decoded.trackGid ?? "-"}:${licensorUuid}`;
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
