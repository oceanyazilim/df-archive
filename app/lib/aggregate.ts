/**
 * Pure, client-side derivations over `ArtistCatalogData.tracks` for the dashboard
 * charts. No network calls, no new backend fields — every value here is computed
 * from data the catalog endpoint already returns. Where the spec asks for a
 * metric this app has no data for (e.g. label mismatches — there is no `label`
 * field on a catalog track), the function says so explicitly rather than
 * inventing a number.
 */

import type { CatalogTrack } from "../components/ArtistCatalog";

export interface MonthBucket {
  key: string; // "2025-03"
  label: string; // "Mar 2025"
  releases: number;
  tracks: number;
}

/** Distinct releases (by album id) per calendar month, plus track counts. */
export function groupTracksByMonth(tracks: CatalogTrack[]): MonthBucket[] {
  const seenAlbumByMonth = new Map<string, Set<string>>();
  const trackCountByMonth = new Map<string, number>();

  for (const t of tracks) {
    if (!t.releaseDate) continue;
    const d = new Date(t.releaseDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    trackCountByMonth.set(key, (trackCountByMonth.get(key) ?? 0) + 1);
    if (t.spotifyAlbumId) {
      if (!seenAlbumByMonth.has(key)) seenAlbumByMonth.set(key, new Set());
      seenAlbumByMonth.get(key)!.add(t.spotifyAlbumId);
    }
  }

  const keys = Array.from(new Set([...seenAlbumByMonth.keys(), ...trackCountByMonth.keys()])).sort();
  return keys.map((key) => {
    const [y, m] = key.split("-").map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    return { key, label, releases: seenAlbumByMonth.get(key)?.size ?? 0, tracks: trackCountByMonth.get(key) ?? 0 };
  });
}

export interface ReleaseTypeCount {
  type: string;
  label: string;
  count: number;
}

const TYPE_LABEL: Record<string, string> = {
  album: "Albums",
  single: "Singles",
  compilation: "Compilations",
  appears_on: "Appears On",
};

/** Distinct releases bucketed by Spotify's album_type (whatever values are actually present). */
export function releaseTypeCounts(tracks: CatalogTrack[]): ReleaseTypeCount[] {
  const albumType = new Map<string, string>(); // albumId -> type
  for (const t of tracks) {
    if (!t.spotifyAlbumId) continue;
    if (!albumType.has(t.spotifyAlbumId)) albumType.set(t.spotifyAlbumId, t.albumType ?? "unknown");
  }
  const counts = new Map<string, number>();
  for (const type of albumType.values()) counts.set(type, (counts.get(type) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, label: TYPE_LABEL[type] ?? (type === "unknown" ? "Unknown" : type), count }))
    .sort((a, b) => b.count - a.count);
}

export interface MetadataHealthCategory {
  key: string;
  label: string;
  /** null = cannot be computed from data this page has access to (shown as "—", never faked). */
  count: number | null;
  severity: "info" | "warning" | "danger";
  note?: string;
}

export function metadataCompleteness(tracks: CatalogTrack[]): { healthyPct: number; categories: MetadataHealthCategory[] } {
  const missingIsrc = tracks.filter((t) => !t.isrc).length;

  const albumsSeen = new Map<string, boolean>(); // albumId -> hasUpc
  for (const t of tracks) {
    if (!t.spotifyAlbumId) continue;
    const hasUpc = !!t.upc;
    albumsSeen.set(t.spotifyAlbumId, albumsSeen.get(t.spotifyAlbumId) || hasUpc);
  }
  const missingUpc = Array.from(albumsSeen.values()).filter((has) => !has).length;

  // Duplicate / inconsistent titles: group by ISRC, flag ISRCs with >1 distinct title.
  const titlesByIsrc = new Map<string, Set<string>>();
  const entriesByIsrc = new Map<string, number>();
  for (const t of tracks) {
    if (!t.isrc) continue;
    entriesByIsrc.set(t.isrc, (entriesByIsrc.get(t.isrc) ?? 0) + 1);
    if (!titlesByIsrc.has(t.isrc)) titlesByIsrc.set(t.isrc, new Set());
    titlesByIsrc.get(t.isrc)!.add(t.title.trim().toLowerCase());
  }
  const duplicateIsrcs = Array.from(entriesByIsrc.values()).filter((n) => n > 1).length;
  const titleInconsistencies = Array.from(titlesByIsrc.values()).filter((set) => set.size > 1).length;

  const categories: MetadataHealthCategory[] = [
    { key: "missing-isrc", label: "Missing ISRC", count: missingIsrc, severity: missingIsrc > 0 ? "warning" : "info" },
    { key: "missing-upc", label: "Missing UPC", count: missingUpc, severity: missingUpc > 0 ? "warning" : "info" },
    { key: "label-mismatch", label: "Label mismatch", count: null, severity: "info", note: "No label field on catalog data" },
    { key: "distributor-mismatch", label: "Distributor mismatch", count: null, severity: "info", note: "Run distributor resolution first" },
    { key: "duplicate-metadata", label: "Duplicate metadata", count: duplicateIsrcs, severity: duplicateIsrcs > 0 ? "danger" : "info" },
    { key: "unknown-uuid", label: "Unknown licensor UUID", count: null, severity: "info", note: "Run distributor resolution first" },
    { key: "title-inconsistency", label: "Release title inconsistency", count: titleInconsistencies, severity: titleInconsistencies > 0 ? "warning" : "info" },
  ];

  const computed = categories.filter((c) => c.count !== null);
  const totalIssues = computed.reduce((sum, c) => sum + (c.count ?? 0), 0);
  const healthyPct = tracks.length ? Math.max(0, Math.round(100 - (totalIssues / tracks.length) * 100)) : 100;

  return { healthyPct, categories };
}

export interface TimelineEntry {
  date: string;
  label: string;
  sub: string;
  kind: "first" | "release" | "latest";
}

/** Chronological release milestones — first release through most recent, capped for readability. */
export function catalogTimeline(tracks: CatalogTrack[], max = 8): TimelineEntry[] {
  const byAlbum = new Map<string, { title: string; date: string }>();
  for (const t of tracks) {
    if (!t.spotifyAlbumId || !t.releaseDate) continue;
    if (!byAlbum.has(t.spotifyAlbumId)) byAlbum.set(t.spotifyAlbumId, { title: t.albumTitle ?? t.title, date: t.releaseDate });
  }
  const sorted = Array.from(byAlbum.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (!sorted.length) return [];

  const pick: typeof sorted = [];
  if (sorted.length <= max) pick.push(...sorted);
  else {
    const step = (sorted.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) pick.push(sorted[Math.round(i * step)]);
  }
  return pick.map((r, i) => ({
    date: r.date,
    label: r.title,
    sub: new Date(r.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    kind: i === 0 ? "first" : i === pick.length - 1 ? "latest" : "release",
  }));
}

export function catalogDateRange(tracks: CatalogTrack[]): { first: string | null; last: string | null } {
  const dates = tracks.map((t) => t.releaseDate).filter((d): d is string => !!d).sort();
  return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}
