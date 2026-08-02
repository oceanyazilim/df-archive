/**
 * Lookup history — server-side JSON file store (no external DB dependency).
 * Stores only non-sensitive fields. Never stores tokens, secrets, headers,
 * cookies, or raw private API responses.
 */

import * as fs from "fs";
import * as path from "path";
import { getAppConfig } from "../soundcharts/config";

const HISTORY_PATH = process.env.DISTRO_HISTORY_PATH ?? path.join(process.cwd(), ".data", "history.json");

export type HistoryItem = {
  id: string;
  at: string;
  input: string;
  inputType: string;
  soundchartsSongUuid: string | null;
  trackTitle: string | null;
  artists: string[];
  isrc: string | null;
  distributor: string | null;
  resolutionStatus: string;
  durationMs: number;
  // Catalog fields (optional — older entries may not have them).
  artworkUrl?: string | null;
  albumTitle?: string | null;
  spotifyTrackId?: string | null;
  spotifyAlbumId?: string | null;
  label?: string | null;
  releaseDate?: string | null;
};

function read(): HistoryItem[] {
  try { const arr = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function write(items: HistoryItem[]): void {
  try { fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true }); fs.writeFileSync(HISTORY_PATH, JSON.stringify(items, null, 2)); }
  catch { /* best effort */ }
}

export function addHistory(item: Omit<HistoryItem, "id" | "at">): HistoryItem {
  const cfg = getAppConfig();
  const entry: HistoryItem = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), at: new Date().toISOString(), ...item };
  if (!cfg.historyEnabled) return entry;
  const items = [entry, ...read()].slice(0, cfg.historyMax);
  write(items);
  return entry;
}

export function listHistory(limit = 100): HistoryItem[] { return read().slice(0, limit); }
export function clearHistoryStore(): void { write([]); }

export function historyStats() {
  const items = read();
  const today = new Date().toISOString().slice(0, 10);
  const todays = items.filter((i) => i.at.slice(0, 10) === today);
  const distributorCounts: Record<string, number> = {};
  for (const i of items) if (i.distributor) distributorCounts[i.distributor] = (distributorCounts[i.distributor] ?? 0) + 1;
  const topDistributors = Object.entries(distributorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  return {
    total: items.length,
    searchesToday: todays.length,
    successful: items.filter((i) => i.resolutionStatus !== "unresolved" && i.soundchartsSongUuid).length,
    soundchartsMatches: items.filter((i) => i.soundchartsSongUuid).length,
    distributorMatches: items.filter((i) => i.distributor).length,
    unresolved: items.filter((i) => !i.soundchartsSongUuid).length,
    topDistributors,
    recent: items.slice(0, 8),
  };
}
