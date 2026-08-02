/**
 * Unified track lookup orchestrator. Each provider has a STRICT responsibility
 * and they never cross:
 *   - Spotify (official API): public metadata — title/artists/album/artwork/
 *     duration/releaseDate/explicit/ISRC/album id.
 *   - Soundcharts: ANALYTICS ONLY (song UUID for analytics lookups, cross-platform
 *     identifiers, streams/playlists/charts/radio). NEVER the distributor.
 *   - Connector + json/uuid's.json: the ONLY distributor source — a real licensor
 *     UUID exact-matched against the canonical mapping.
 * A failure in one source never discards valid data from another. The distributor
 * comes from the Spotify track's OWN licensor UUID (via the local track catalog),
 * exact-matched against the canonical mapping — never from Soundcharts/label.
 */

import { parseMusicLookupInput } from "../validation/musicInput";
import { getSongBySpotifyId, getSongByIsrc, getSongMetadata, getSongIdentifiers } from "../soundcharts/song";
import { SoundchartsSong } from "../soundcharts/types";
import { SoundchartsError } from "../soundcharts/errors";
import { isSoundchartsConfigured, isSpotifyFallbackConfigured } from "../soundcharts/config";
import { resolveDistributor, DistributorResolution } from "../distributor/resolver";
import { loadTrackCatalog, findUuidForTrack } from "../trackMapping";
import { getSpotifyTrack, extractSpotifyMetadata, extractIsrc, extractSpotifyAlbumIdFromTrack, extractLicensorUuidFromSpotifyMetadata } from "../spotify";
import { defaultResolverConfig } from "../config";
import { uuidMappingStatus } from "../uuidResolver";

const TRACE = process.env.NODE_ENV !== "production" || process.env.DISTRO_TRACE === "1";

export type SourceState = "operational" | "not_configured" | "failed" | "not_found" | "plan_restricted" | "not_applicable";

export type Workspace = {
  success: boolean;
  requestId: string;
  input: { original: string; type: string; normalized: string };
  identity: {
    spotifyTrackId: string | null;
    spotifyTrackGid: string | null;
    spotifyAlbumId: string | null;
    spotifyAlbumGid: string | null;
    soundchartsSongUuid: string | null;
    licensorUuid: string | null;
    distributorUuid: string | null;
    originalAudioUuid: string | null;
    isrc: string | null;
    upc: string | null;
  };
  metadata: {
    trackTitle: string | null; artists: string[]; albumTitle: string | null; artworkUrl: string | null;
    releaseDate: string | null; durationMs: number | null; explicit: boolean | null; genres: string[]; label: string | null;
    popularity: number | null;
  };
  distributor: DistributorResolution;
  analytics: Record<string, unknown>;
  sourceStatus: { spotify: SourceState; soundcharts: SourceState; uuidMapping: "loaded" | "not_loaded" };
  soundchartsUrl: string | null;
  spotifyUrl: string | null;
  freshness: string;
  errors: Array<{ code: string; message: string }>;
};

function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }

type SpotifyMeta = { title: string | null; artist: string | null; album: string | null; artwork: string | null; isrc: string | null; albumId: string | null; licensorUuid: string | null; trackLicensorPresent: boolean; albumLicensorPresent: boolean; popularity: number | null; releaseDate: string | null; durationMs: number | null; explicit: boolean | null };

async function fetchSpotify(spotifyTrackId: string): Promise<SpotifyMeta | null> {
  const res = await getSpotifyTrack(spotifyTrackId, defaultResolverConfig());
  const m = extractSpotifyMetadata(res.body);
  // Read the licensor UUID straight from the Spotify metadata response (track-level
  // preferred, album-level fallback). The public Web API does not include it, so
  // this is typically null — the local track catalog supplies it downstream.
  const body = (res.body ?? {}) as Record<string, unknown>;
  const trackLicensorPresent = !!(body.licensor as Record<string, unknown> | undefined)?.uuid;
  const albumLicensorPresent = !!((body.album as Record<string, unknown> | undefined)?.licensor as Record<string, unknown> | undefined)?.uuid;
  const album = (body.album ?? {}) as Record<string, unknown>;
  return {
    title: m.title, artist: m.artist, album: m.releaseTitle, artwork: m.artworkUrl,
    isrc: extractIsrc(res.body), albumId: extractSpotifyAlbumIdFromTrack(res.body),
    licensorUuid: extractLicensorUuidFromSpotifyMetadata(res.body),
    trackLicensorPresent, albumLicensorPresent,
    popularity: typeof body.popularity === "number" && Number.isFinite(body.popularity) ? body.popularity : null,
    releaseDate: str(album.release_date),
    durationMs: typeof body.duration_ms === "number" && Number.isFinite(body.duration_ms) ? body.duration_ms : null,
    explicit: typeof body.explicit === "boolean" ? body.explicit : null,
  };
}

function scErrorState(err: unknown): SourceState {
  const e = err instanceof SoundchartsError ? err : null;
  if (e?.code === "SOUNDCHARTS_PLAN_RESTRICTED") return "plan_restricted";
  if (e?.code === "SOUNDCHARTS_NOT_FOUND") return "not_found";
  return "failed";
}

export async function resolveTrack(rawInput: string, connector?: { licensorUuid?: string | null; name?: string | null }): Promise<Workspace> {
  const parsed = parseMusicLookupInput(rawInput);
  const uuidLoaded = (() => { const s = uuidMappingStatus(); return s.loaded && s.validMappings > 0; })();
  const spotifyOn = isSpotifyFallbackConfigured();
  const soundchartsOn = isSoundchartsConfigured();

  const ws: Workspace = {
    success: false,
    requestId: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    input: { original: parsed.originalValue, type: parsed.type, normalized: parsed.normalizedValue },
    identity: { spotifyTrackId: null, spotifyTrackGid: null, spotifyAlbumId: null, spotifyAlbumGid: null, soundchartsSongUuid: null, licensorUuid: connector?.licensorUuid ?? null, distributorUuid: null, originalAudioUuid: null, isrc: null, upc: null },
    metadata: { trackTitle: null, artists: [], albumTitle: null, artworkUrl: null, releaseDate: null, durationMs: null, explicit: null, genres: [], label: null, popularity: null },
    distributor: { name: null, uuid: null, status: "uuid_unavailable" },
    analytics: {},
    sourceStatus: { spotify: spotifyOn ? "operational" : "not_configured", soundcharts: soundchartsOn ? "operational" : "not_configured", uuidMapping: uuidLoaded ? "loaded" : "not_loaded" },
    soundchartsUrl: null,
    spotifyUrl: null,
    freshness: new Date().toISOString(),
    errors: [],
  };

  if (parsed.type === "invalid") {
    ws.sourceStatus.spotify = "not_applicable"; ws.sourceStatus.soundcharts = "not_applicable";
    ws.errors.push({ code: "INVALID_LOOKUP_INPUT", message: parsed.reason ?? "Invalid input." });
    return ws;
  }

  let spotifyMeta: SpotifyMeta | null = null;
  let scSong: SoundchartsSong | null = null;

  // ---------- SPOTIFY-TRACK INPUT ----------
  if (parsed.type === "spotify_track") {
    ws.identity.spotifyTrackId = parsed.normalizedValue;
    ws.spotifyUrl = `https://open.spotify.com/track/${parsed.normalizedValue}`;

    if (spotifyOn) {
      try { spotifyMeta = await fetchSpotify(parsed.normalizedValue); ws.sourceStatus.spotify = "operational"; }
      catch { ws.sourceStatus.spotify = "failed"; ws.errors.push({ code: "SPOTIFY_NOT_FOUND", message: "Official Spotify metadata could not be retrieved." }); }
    }
    ws.identity.isrc = spotifyMeta?.isrc ?? null;

    if (soundchartsOn) {
      try {
        scSong = await getSongBySpotifyId(parsed.normalizedValue);
        if (!scSong && ws.identity.isrc) scSong = await getSongByIsrc(ws.identity.isrc); // ISRC fallback
        ws.sourceStatus.soundcharts = scSong ? "operational" : "not_found";
      } catch (err) {
        ws.sourceStatus.soundcharts = scErrorState(err);
        const e = err instanceof SoundchartsError ? err : null;
        if (e) ws.errors.push({ code: e.code, message: e.message });
      }
    }
  }

  // ---------- ISRC INPUT ----------
  else if (parsed.type === "isrc") {
    ws.identity.isrc = parsed.normalizedValue;
    if (soundchartsOn) {
      try { scSong = await getSongByIsrc(parsed.normalizedValue); ws.sourceStatus.soundcharts = scSong ? "operational" : "not_found"; }
      catch (err) { ws.sourceStatus.soundcharts = scErrorState(err); const e = err instanceof SoundchartsError ? err : null; if (e) ws.errors.push({ code: e.code, message: e.message }); }
    }
    // Discover a Spotify id from Soundcharts identifiers, then enrich via Spotify.
    const spId = scSong?.uuid ? await spotifyIdFromSoundcharts(str(scSong.uuid)!) : null;
    if (spId) { ws.identity.spotifyTrackId = spId; ws.spotifyUrl = `https://open.spotify.com/track/${spId}`; }
    if (spotifyOn && ws.identity.spotifyTrackId && needsSpotifyEnrichment(scSong)) {
      try { spotifyMeta = await fetchSpotify(ws.identity.spotifyTrackId); ws.sourceStatus.spotify = "operational"; }
      catch { ws.sourceStatus.spotify = "failed"; }
    } else if (spotifyOn && !ws.identity.spotifyTrackId) { ws.sourceStatus.spotify = "not_applicable"; }
  }

  // ---------- SOUNDCHARTS UUID INPUT ----------
  else if (parsed.type === "soundcharts_song_uuid") {
    ws.identity.soundchartsSongUuid = parsed.normalizedValue;
    if (soundchartsOn) {
      try { scSong = await getSongMetadata(parsed.normalizedValue); ws.sourceStatus.soundcharts = scSong ? "operational" : "not_found"; }
      catch (err) { ws.sourceStatus.soundcharts = scErrorState(err); const e = err instanceof SoundchartsError ? err : null; if (e) ws.errors.push({ code: e.code, message: e.message }); }
    }
    const spId = scSong?.uuid ? await spotifyIdFromSoundcharts(str(scSong.uuid)!) : null;
    if (spId) { ws.identity.spotifyTrackId = spId; ws.spotifyUrl = `https://open.spotify.com/track/${spId}`; }
    if (spotifyOn && ws.identity.spotifyTrackId && needsSpotifyEnrichment(scSong)) {
      try { spotifyMeta = await fetchSpotify(ws.identity.spotifyTrackId); ws.sourceStatus.spotify = "operational"; }
      catch { ws.sourceStatus.spotify = "failed"; }
    } else { ws.sourceStatus.spotify = spotifyOn ? "not_applicable" : "not_configured"; }
  }

  // ---------- MERGE (Spotify authoritative for public fields; Soundcharts for uuid/label) ----------
  if (scSong) {
    const uuid = str(scSong.uuid);
    if (uuid) { ws.identity.soundchartsSongUuid = uuid; ws.soundchartsUrl = `https://app.soundcharts.com/app/song/${uuid}/overview`; }
    ws.metadata.label = str(scSong.label);
    ws.metadata.genres = Array.isArray(scSong.genres) ? scSong.genres.map((g) => (typeof g === "string" ? g : str((g as { sub?: string; root?: string })?.sub) ?? str((g as { root?: string })?.root))).filter((x): x is string => !!x) : [];
    const scArtists = Array.isArray(scSong.artists) ? scSong.artists.map((a) => str(a?.name)).filter((x): x is string => !!x) : [];
    ws.metadata.trackTitle = str(scSong.name);
    ws.metadata.artists = scArtists;
    ws.metadata.albumTitle = null;
    ws.metadata.releaseDate = str(scSong.releaseDate);
    // Soundcharts reports duration in SECONDS — normalize to ms.
    ws.metadata.durationMs = typeof scSong.duration === "number" ? scSong.duration * 1000 : null;
    ws.metadata.explicit = typeof scSong.explicit === "boolean" ? scSong.explicit : null;
    ws.metadata.artworkUrl = str(scSong.imageUrl);
    ws.identity.isrc = ws.identity.isrc ?? str(scSong.isrc);
  }
  if (spotifyMeta) {
    // Spotify is authoritative for these public-display fields.
    ws.metadata.trackTitle = spotifyMeta.title ?? ws.metadata.trackTitle;
    if (spotifyMeta.artist) ws.metadata.artists = spotifyMeta.artist.split(", ");
    ws.metadata.albumTitle = spotifyMeta.album ?? ws.metadata.albumTitle;
    ws.metadata.artworkUrl = spotifyMeta.artwork ?? ws.metadata.artworkUrl;
    ws.identity.isrc = ws.identity.isrc ?? spotifyMeta.isrc;
    ws.identity.spotifyAlbumId = ws.identity.spotifyAlbumId ?? spotifyMeta.albumId;
    ws.metadata.popularity = spotifyMeta.popularity;
    ws.metadata.releaseDate = ws.metadata.releaseDate ?? spotifyMeta.releaseDate;
    // Spotify's duration_ms is authoritative (exact ms); Soundcharts is a fallback.
    ws.metadata.durationMs = spotifyMeta.durationMs ?? ws.metadata.durationMs;
    ws.metadata.explicit = ws.metadata.explicit ?? spotifyMeta.explicit;
  }

  // ---------- DISTRIBUTOR ----------
  // The selected track exposes its OWN licensor UUID via the Spotify system, in
  // priority order (Soundcharts / label / ISRC / UPC are NEVER used here):
  //   1. the Spotify metadata response's own licensor UUID (track- then album-level)
  //   2. the local track catalog (json/tracks.json): this exact track id or ISRC
  //   3. a connector-supplied licensor UUID, when present
  const spotifyLicensor = spotifyMeta?.licensorUuid ?? null;
  let licensorSource: "spotify_metadata" | "track_catalog" | "connector" | "none" = spotifyLicensor ? "spotify_metadata" : "none";
  let licensorUuid: string | null = spotifyLicensor;
  if (!licensorUuid) {
    const catalog = loadTrackCatalog();
    const match = findUuidForTrack(catalog, ws.identity.spotifyTrackId, ws.identity.isrc);
    if (match?.licensorUuid) { licensorUuid = match.licensorUuid; licensorSource = "track_catalog"; }
  }
  if (!licensorUuid && connector?.licensorUuid) { licensorUuid = connector.licensorUuid; licensorSource = "connector"; }
  ws.identity.licensorUuid = licensorUuid ?? ws.identity.licensorUuid;
  // Distributor resolution runs NOW, independently of Soundcharts analytics.
  ws.distributor = resolveDistributor({ licensorUuid });

  // Development-only trace: safe structural fields ONLY (never tokens / cookies /
  // headers / full private responses). Pinpoints where the licensor UUID is/isn't.
  // Gated on non-production (or DISTRO_TRACE=1); never runs in production.
  if (TRACE) {
    // eslint-disable-next-line no-console
    console.info("[distributor-trace]", JSON.stringify({
      requestId: ws.requestId,
      spotifyTrackId: ws.identity.spotifyTrackId,
      spotifyMetadataReceived: !!spotifyMeta,
      trackLicensorPresent: spotifyMeta?.trackLicensorPresent ?? false,
      albumLicensorPresent: spotifyMeta?.albumLicensorPresent ?? false,
      extractedLicensorUuidPresent: !!licensorUuid,
      licensorSource,
      resolverInvoked: true,
      distributorStatus: ws.distributor.status,
    }));
  }

  ws.success = Boolean(scSong || spotifyMeta);
  if (!soundchartsOn && !spotifyOn) ws.errors.push({ code: "SOUNDCHARTS_NOT_CONFIGURED", message: "No resolution source is configured. Run scripts/setup-env.ps1." });
  return ws;
}

function needsSpotifyEnrichment(scSong: SoundchartsSong | null): boolean {
  // Avoid unnecessary Spotify calls: only enrich when artwork or title is missing.
  return !scSong || !str(scSong.imageUrl) || !str(scSong.name);
}

async function spotifyIdFromSoundcharts(uuid: string): Promise<string | null> {
  try {
    const ids = await getSongIdentifiers(uuid);
    const sp = ids.find((i) => (i.platformCode ?? "").toLowerCase() === "spotify" || (i.platformName ?? "").toLowerCase() === "spotify");
    const id = sp?.identifier ?? null;
    return id && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
  } catch { return null; }
}
