/**
 * Flagged-UUID review queue — server-side JSON file store, same pattern as
 * src/history/store.ts. Backs the "Add to UUID Database" / "Report Mapping"
 * actions shown when a distributor can't be resolved: real, working buttons
 * that write a reviewable record rather than doing nothing.
 */

import * as fs from "fs";
import * as path from "path";

const STORE_PATH = process.env.DISTRO_UUID_REVIEW_PATH ?? path.join(process.cwd(), ".data", "uuid-review-queue.json");
const MAX_ITEMS = 1000;

export type FlaggedUuidReason = "add" | "report";
export type FlaggedUuidStatus = "pending" | "resolved" | "dismissed";

export type FlaggedUuid = {
  id: string;
  at: string;
  reason: FlaggedUuidReason;
  status: FlaggedUuidStatus;
  licensorUuid: string | null;
  spotifyTrackId: string | null;
  spotifyAlbumId: string | null;
  trackTitle: string | null;
  releaseTitle: string | null;
  artists: string[];
  note: string | null;
};

function read(): FlaggedUuid[] {
  try { const arr = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function write(items: FlaggedUuid[]): void {
  try { fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); fs.writeFileSync(STORE_PATH, JSON.stringify(items, null, 2)); }
  catch { /* best effort — the UI still confirms locally even if disk write fails */ }
}

export function addFlaggedUuid(item: Omit<FlaggedUuid, "id" | "at" | "status">): FlaggedUuid {
  const entry: FlaggedUuid = {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    at: new Date().toISOString(),
    status: "pending",
    ...item,
  };
  const items = [entry, ...read()].slice(0, MAX_ITEMS);
  write(items);
  return entry;
}

export function listFlaggedUuids(limit = 100): FlaggedUuid[] { return read().slice(0, limit); }
