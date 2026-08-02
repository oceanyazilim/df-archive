/**
 * Song analytics (streaming time-series). Real Soundcharts data only — never
 * fabricated. Plan-restricted (403) and empty responses are surfaced honestly.
 */

import { getSoundchartsConfig } from "./config";
import { soundchartsRequest, unwrapItems } from "./client";

export type StreamPoint = { date: string; value: number };

/** Days -> ISO date (UTC) offset from now. Pure-ish (uses the server clock). */
function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fetch streaming time-series for a Soundcharts song on a platform.
 * @throws {SoundchartsError} (403 plan-restricted, etc.) — handled by the route.
 */
export async function getSongStreams(uuid: string, platform = "spotify", days = 90): Promise<StreamPoint[]> {
  const c = getSoundchartsConfig();
  // Song streaming lives on the *audience* endpoint
  // (/song/{uuid}/audience/{platform} → items[{ date, plots: [{identifier, value}] }]);
  // the dedicated /stream paths 404 on this plan. Values are cumulative all-time
  // stream totals, so the daily series is the day-over-day delta — fetch one
  // extra day as the baseline for the first day of the window.
  const startDate = isoDaysAgo(days + 1);
  const endDate = isoDaysAgo(0);
  const path = `/api/${c.idApiVersion}/song/${encodeURIComponent(uuid)}/audience/${encodeURIComponent(platform)}`;
  const body = await soundchartsRequest(path, { query: { startDate, endDate }, cacheTtlMs: 15 * 60 * 1000 });

  const items = unwrapItems<Record<string, unknown>>(body);
  const totals: StreamPoint[] = [];
  for (const it of items) {
    const date = typeof it.date === "string" ? it.date.slice(0, 10) : null;
    let value = typeof it.value === "number" ? it.value
      : typeof it.plotValue === "number" ? it.plotValue
      : null;
    if (value === null && Array.isArray((it as { plots?: unknown }).plots)) {
      const plot = ((it as { plots: { value?: unknown }[] }).plots).find((p) => typeof p.value === "number");
      value = plot ? (plot.value as number) : null;
    }
    if (date && value !== null && Number.isFinite(value)) totals.push({ date, value });
  }
  totals.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Deltas clamped at 0 — Soundcharts occasionally revises totals downward.
  const points: StreamPoint[] = [];
  for (let i = 1; i < totals.length; i++) {
    points.push({ date: totals[i].date, value: Math.max(0, totals[i].value - totals[i - 1].value) });
  }
  return points;
}
