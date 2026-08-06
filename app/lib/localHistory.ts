"use client";

/**
 * The customer's own analysis history — stored in this browser only.
 *
 * Deliberately NOT the server's `/api/history`: that one records every query
 * across the tool and is admin-only. A customer sees their own work and
 * nobody else's, so it lives client-side, and it is purged after
 * RETENTION_DAYS on every read and write — "deleted after 7 days" has to be
 * true even if the app is never opened again in between.
 */

import { useCallback, useEffect, useState } from "react";

const KEY = "vr:recent-analyses";
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export type RecentKind = "track" | "album" | "artist" | "playlist" | "unknown";

export type RecentAnalysis = {
  id: string;
  at: number;
  /** Exactly what was typed — re-running an entry replays this. */
  input: string;
  kind: RecentKind;
  title: string | null;
  subtitle: string | null;
  artworkUrl: string | null;
  distributor: string | null;
  ok: boolean;
};

export const RETENTION_LABEL = `${RETENTION_DAYS} days`;

function read(): RecentAnalysis[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentAnalysis[];
    if (!Array.isArray(list)) return [];
    const cutoff = Date.now() - RETENTION_MS;
    const kept = list.filter((e) => e && typeof e.at === "number" && e.at >= cutoff);
    // Purge on read too: an entry must not survive its window just because
    // nothing new was written.
    if (kept.length !== list.length) write(kept);
    return kept;
  } catch {
    return [];
  }
}

function write(list: RecentAnalysis[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* private mode / quota — history is a convenience, never a hard failure */
  }
}

export function recordAnalysis(entry: Omit<RecentAnalysis, "id" | "at">): void {
  const list = read();
  // Same input analyzed again moves to the top instead of duplicating.
  const deduped = list.filter((e) => e.input !== entry.input);
  deduped.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() });
  write(deduped);
  window.dispatchEvent(new Event("vr:recent-updated"));
}

export function clearRecent(): void {
  write([]);
  window.dispatchEvent(new Event("vr:recent-updated"));
}

export function removeRecent(id: string): void {
  write(read().filter((e) => e.id !== id));
  window.dispatchEvent(new Event("vr:recent-updated"));
}

/** Live list; updates whenever an analysis is recorded anywhere in the app. */
export function useRecentAnalyses(): { items: RecentAnalysis[]; clear: () => void; remove: (id: string) => void } {
  const [items, setItems] = useState<RecentAnalysis[]>([]);

  const refresh = useCallback(() => setItems(read()), []);
  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener("vr:recent-updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    // Entries age out while the app sits open — re-read on a slow timer so the
    // list cannot show something that should already be gone.
    const t = setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("vr:recent-updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
      clearInterval(t);
    };
  }, [refresh]);

  return { items, clear: clearRecent, remove: removeRecent };
}
