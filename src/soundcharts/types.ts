/**
 * Loose Soundcharts shapes; fields are read defensively (docs may evolve).
 * ANALYTICS + public metadata ONLY. A distributor is NEVER read from Soundcharts
 * — the distributor comes solely from a captured licensor UUID (see
 * src/distributor). Do not add a `distributor` field to this type.
 */
export type SoundchartsSong = Record<string, unknown> & {
  uuid?: string;
  name?: string;
  isrc?: string;
  creditName?: string;
  releaseDate?: string;
  duration?: number;
  explicit?: boolean;
  label?: string; // release label — display metadata only, NEVER a distributor
  imageUrl?: string;
  genres?: Array<{ root?: string; sub?: string } | string>;
  artists?: Array<{ uuid?: string; name?: string; slug?: string }>;
};

export type SongIdentifier = { platformName?: string; platformCode?: string; identifier?: string; url?: string };
export type SongAlbum = { uuid?: string; name?: string; label?: string; releaseDate?: string; type?: string; upc?: string };
