/**
 * Album/EP/multi-track release service. Builds a normalized RELEASE model with
 * an ordered tracklist. Release-level data (title, artwork, UPC, label, date)
 * is kept strictly separate from per-track data — each track is analyzed
 * independently later via the per-track lookup.
 */

import { getSpotifyAlbum } from "../spotify";
import { defaultResolverConfig } from "../config";
import { isSpotifyFallbackConfigured } from "../soundcharts/config";
import { SoundchartsError } from "../soundcharts/errors";

/** Per-track summary (release view). Analysis fields are filled on demand. */
export type AlbumTrack = {
  spotifyTrackId: string;
  title: string;
  artists: string[];
  trackNumber: number;
  discNumber: number;
  durationMs: number;
  explicit: boolean;
  spotifyUrl: string;
  isrc: string | null;
  analysisStatus: "not_loaded";
};

/** Release-level metadata only (never track-level). */
export type AlbumRelease = {
  spotifyAlbumId: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  releaseType: string;
  releaseDate: string | null;
  upc: string | null;
  label: string | null;
  totalTracks: number;
  discCount: number;
  tracks: AlbumTrack[];
};

function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown, d = 0): number { return typeof v === "number" && Number.isFinite(v) ? v : d; }

export async function resolveAlbum(albumId: string): Promise<AlbumRelease> {
  if (!isSpotifyFallbackConfigured()) {
    throw new SoundchartsError("SPOTIFY_NOT_CONFIGURED", "Spotify is not configured; album lookup requires the Spotify Web API.");
  }
  const { body, tracks } = await getSpotifyAlbum(albumId, defaultResolverConfig());
  return buildAlbumRelease(albumId, body as Record<string, unknown>, tracks);
}

/** Pure release builder (network-free) — testable with mock Spotify data. */
export function buildAlbumRelease(albumId: string, a: Record<string, unknown>, tracks: Record<string, unknown>[]): AlbumRelease {
  const images = Array.isArray(a.images) ? (a.images as Record<string, unknown>[]) : [];
  const albumArtists = Array.isArray(a.artists) ? (a.artists as Record<string, unknown>[]).map((x) => str(x.name)).filter((x): x is string => !!x) : [];
  const upc = str((a.external_ids as Record<string, unknown> | undefined)?.upc);

  const mapped: AlbumTrack[] = tracks
    .map((t): AlbumTrack | null => {
      const tt = t as Record<string, unknown>;
      const id = str(tt.id);
      if (!id) return null;
      const artists = Array.isArray(tt.artists) ? (tt.artists as Record<string, unknown>[]).map((x) => str(x.name)).filter((x): x is string => !!x) : [];
      return {
        spotifyTrackId: id,
        title: str(tt.name) ?? "Untitled",
        artists,
        trackNumber: num(tt.track_number, 0),
        discNumber: num(tt.disc_number, 1),
        durationMs: num(tt.duration_ms, 0),
        explicit: tt.explicit === true,
        spotifyUrl: `https://open.spotify.com/track/${id}`,
        isrc: null, // per-track ISRC is resolved during that track's analysis
        analysisStatus: "not_loaded" as const,
      };
    })
    .filter((x): x is AlbumTrack => x !== null)
    // Preserve Spotify disc + track ordering.
    .sort((x, y) => (x.discNumber - y.discNumber) || (x.trackNumber - y.trackNumber));

  const discCount = mapped.reduce((m, t) => Math.max(m, t.discNumber), 1);

  return {
    spotifyAlbumId: albumId,
    title: str(a.name) ?? "Release",
    artists: albumArtists,
    artworkUrl: images.length ? str(images[0].url) : null,
    releaseType: str(a.album_type) ?? "album",
    releaseDate: str(a.release_date),
    upc,
    label: str(a.label),
    totalTracks: num(a.total_tracks, mapped.length),
    discCount,
    tracks: mapped,
  };
}
