import type { ReleaseRow } from "../../lib/hooks/useArtistCatalog";

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ported from the original ArtistCatalog.tsx CSV export, generalized to release rows. */
export function exportReleasesCsv(rows: ReleaseRow[], artistName: string) {
  const head = ["title", "artists", "releaseType", "releaseDate", "trackCount", "upc", "distributor", "metadataStatus", "onProfileCount", "offProfileCount"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      r.title, r.artists.join("; "), r.releaseType, r.releaseDate, r.trackCount, r.upc,
      r.distributors.join("; "), r.metadataStatus, r.onProfileCount, r.offProfileCount,
    ].map(escapeCsv).join(","));
  }
  const safeName = artistName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  download(`${safeName}-releases.csv`, lines.join("\n"), "text/csv");
}

export function exportReleaseJson(release: unknown, albumId: string) {
  download(`release-${albumId}.json`, JSON.stringify(release, null, 2), "application/json");
}
