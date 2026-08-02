/**
 * Shared artist-catalog data contract, mirroring `/api/artist/[artistId]/catalog`.
 * The presentation layer that used to live in this file (ArtistCatalogWorkspace)
 * has been superseded by `dashboard/ArtistWorkspace` + `releases/ReleaseCatalog`
 * (release-grouped table + drawer) — these types remain the single source of
 * truth consumed by the new dashboard, aggregation helpers, and release table.
 */

export type CatalogTrack = {
  key: string;
  spotifyTrackId: string | null;
  soundchartsSongUuid: string | null;
  title: string;
  artists: string[];
  albumTitle: string | null;
  spotifyAlbumId: string | null;
  albumType: string | null;
  releaseDate: string | null;
  durationMs: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  explicit: boolean | null;
  isrc: string | null;
  upc: string | null;
  onProfile: boolean;
  source: "spotify" | "soundcharts";
};

export type ArtistCatalogData = {
  spotifyArtistId: string;
  name: string | null;
  imageUrl: string | null;
  spotifyUrl: string;
  soundchartsArtistUuid: string | null;
  tracks: CatalogTrack[];
  counts: { total: number; onProfile: number; offProfile: number; albums: number; withIsrc: number };
  coverage: {
    spotifyAlbums: number; spotifyAlbumsTruncated: boolean;
    soundchartsTotal: number | null; soundchartsLoaded: number; soundchartsTruncated: boolean;
    soundchartsAvailable: boolean; note: string | null;
  };
};
