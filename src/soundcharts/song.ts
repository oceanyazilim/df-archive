/**
 * Allow-listed Soundcharts song service functions. The browser never passes a
 * raw Soundcharts path — it calls these fixed operations only.
 *
 * Endpoint versions (documented, overridable via env):
 *   Get Song by Platform ID : /api/v2.25/song/by-platform/{platform}/{id}
 *   Get Song by ISRC        : /api/v2.25/song/by-isrc/{isrc}
 *   Get Song metadata       : /api/v2.25/song/{uuid}
 *   Get Song identifiers    : /api/v2/song/{uuid}/identifiers
 *   Get Song albums         : /api/v2/song/{uuid}/albums
 */

import { getSoundchartsConfig } from "./config";
import { soundchartsRequest, unwrapObject, unwrapItems } from "./client";
import { SoundchartsSong, SongIdentifier, SongAlbum } from "./types";

const enc = encodeURIComponent;

export async function getSongBySpotifyId(spotifyTrackId: string): Promise<SoundchartsSong | null> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.songApiVersion}/song/by-platform/${enc(c.spotifyPlatform)}/${enc(spotifyTrackId)}`);
  return unwrapObject<SoundchartsSong>(body);
}

export async function getSongByIsrc(isrc: string): Promise<SoundchartsSong | null> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.songApiVersion}/song/by-isrc/${enc(isrc)}`);
  return unwrapObject<SoundchartsSong>(body);
}

export async function getSongMetadata(uuid: string): Promise<SoundchartsSong | null> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.songApiVersion}/song/${enc(uuid)}`);
  return unwrapObject<SoundchartsSong>(body);
}

export async function getSongIdentifiers(uuid: string): Promise<SongIdentifier[]> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.idApiVersion}/song/${enc(uuid)}/identifiers`);
  return unwrapItems<SongIdentifier>(body);
}

export async function getSongAlbums(uuid: string): Promise<SongAlbum[]> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.idApiVersion}/song/${enc(uuid)}/albums`);
  return unwrapItems<SongAlbum>(body);
}

/** Current playlist placements on a platform (v2.20 documented path). */
export async function getSongPlaylists(uuid: string, platform = "spotify"): Promise<Record<string, unknown>[]> {
  const body = await soundchartsRequest(`/api/v2.20/song/${enc(uuid)}/playlist/current/${enc(platform)}`);
  return unwrapItems<Record<string, unknown>>(body);
}

/** Current chart ranks on a platform: /charts/ranks/{platform}. */
export async function getSongChartRanks(uuid: string, platform = "spotify"): Promise<Record<string, unknown>[]> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.idApiVersion}/song/${enc(uuid)}/charts/ranks/${enc(platform)}`);
  return unwrapItems<Record<string, unknown>>(body);
}

/** Radio airplay grouped by station: /broadcast-groups → { playCount, radio }. */
export async function getSongBroadcastGroups(uuid: string): Promise<Record<string, unknown>[]> {
  const c = getSoundchartsConfig();
  const body = await soundchartsRequest(`/api/${c.idApiVersion}/song/${enc(uuid)}/broadcast-groups`);
  return unwrapItems<Record<string, unknown>>(body);
}
