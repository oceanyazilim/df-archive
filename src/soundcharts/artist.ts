/**
 * Allow-listed Soundcharts ARTIST operations.
 *
 * Endpoint versions (verified live against the customer API):
 *   Artist by platform id : /api/v2/artist/by-platform/spotify/{id}
 *   Artist songs          : /api/v2.21/artist/{uuid}/songs   (paginated)
 *   Artist albums         : /api/v2.34/artist/{uuid}/albums  (paginated)
 *
 * The song list is the historical catalogue Soundcharts keeps for the artist —
 * it includes releases that are no longer visible on the artist's Spotify
 * profile, which is exactly what makes the "no longer on profile" comparison
 * possible.
 */

import { soundchartsRequest, unwrapObject, unwrapItems } from "./client";

const enc = encodeURIComponent;

export type SoundchartsArtist = { uuid?: string; name?: string; slug?: string; imageUrl?: string };
export type ArtistSong = {
  uuid?: string;
  name?: string;
  creditName?: string;
  imageUrl?: string;
  releaseDate?: string;
  isrc?: string;
};
export type ArtistAlbum = {
  uuid?: string;
  name?: string;
  creditName?: string;
  releaseDate?: string;
  type?: string;
};

export async function getArtistBySpotifyId(spotifyArtistId: string): Promise<SoundchartsArtist | null> {
  const body = await soundchartsRequest(`/api/v2/artist/by-platform/spotify/${enc(spotifyArtistId)}`);
  return unwrapObject<SoundchartsArtist>(body);
}

/** One page of the artist's songs, with the reported total for progress. */
export async function getArtistSongsPage(
  uuid: string,
  offset: number,
  limit: number
): Promise<{ items: ArtistSong[]; total: number }> {
  const body = await soundchartsRequest(`/api/v2.21/artist/${enc(uuid)}/songs?offset=${offset}&limit=${limit}`);
  const items = unwrapItems<ArtistSong>(body);
  const page = (body as { page?: { total?: number } } | null)?.page;
  return { items, total: typeof page?.total === "number" ? page.total : items.length };
}

/**
 * Every song Soundcharts knows for this artist, page by page.
 * `maxSongs` bounds the work so one huge catalogue cannot stall a request;
 * the caller is told when the list was truncated instead of it being silent.
 */
export async function getArtistSongs(
  uuid: string,
  maxSongs = 1000,
  pageSize = 100
): Promise<{ songs: ArtistSong[]; total: number; truncated: boolean }> {
  const first = await getArtistSongsPage(uuid, 0, pageSize);
  const songs = [...first.items];
  const total = first.total;
  let offset = songs.length;

  while (songs.length < Math.min(total, maxSongs) && first.items.length > 0) {
    const page = await getArtistSongsPage(uuid, offset, pageSize);
    if (!page.items.length) break;
    songs.push(...page.items);
    offset += page.items.length;
    if (page.items.length < pageSize) break;
  }
  return { songs: songs.slice(0, maxSongs), total, truncated: total > songs.length };
}

export async function getArtistAlbums(uuid: string, offset = 0, limit = 100): Promise<ArtistAlbum[]> {
  const body = await soundchartsRequest(`/api/v2.34/artist/${enc(uuid)}/albums?offset=${offset}&limit=${limit}`);
  return unwrapItems<ArtistAlbum>(body);
}
