/**
 * Protected, capped server-side search over the local UUID mapping. The full
 * mapping is never returned to the browser — only bounded search results.
 */

import { loadUuidMapping } from "../uuidMapping";
import { normalizeUuid } from "../normalizeUuid";
import { getAppConfig } from "../soundcharts/config";

const MAX_RESULTS = 50;

export type MappingSearchResult = { uuid: string; distributor: string };

export function searchLocalMapping(query: string, conflictsOnly = false): { results: MappingSearchResult[]; conflicts: { uuid: string; distributors: string[] }[]; truncated: boolean } {
  const mapping = loadUuidMapping(getAppConfig().uuidMappingPath);
  const conflicts = mapping.conflicts.map((c) => ({ uuid: c.uuid, distributors: c.distributors }));

  if (conflictsOnly) return { results: [], conflicts, truncated: false };

  const q = (query ?? "").trim().toLowerCase();
  const normQ = normalizeUuid(q);
  const out: MappingSearchResult[] = [];

  for (const [uuid, distributor] of mapping.distributorByUuid) {
    if (out.length >= MAX_RESULTS + 1) break;
    if (!q) { out.push({ uuid, distributor }); continue; }
    if ((normQ && uuid === normQ) || uuid.includes(q) || distributor.toLowerCase().includes(q)) {
      out.push({ uuid, distributor });
    }
  }
  const truncated = out.length > MAX_RESULTS;
  return { results: out.slice(0, MAX_RESULTS), conflicts, truncated };
}
