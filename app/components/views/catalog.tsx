"use client";

/**
 * Catalog views (Artists / Albums / Tracks), built ONLY from real local data:
 * the lookup history. Nothing here is fabricated — these views grow as
 * tracks are analyzed. (Distributors moved to distributor/DistributorDatabasePage.)
 */

import { useEffect, useMemo, useState } from "react";
import { Disc3, Music2, Search, Users } from "lucide-react";
import { PageHead } from "../shared/PageHead";
import { EmptyState } from "../shared/EmptyState";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Skeleton } from "../shared/Skeleton";
import { Button } from "../shared/Button";
import type { HistoryItem } from "../../lib/types";
import { jget, fmtDate } from "../../lib/types";

function useHistory(): HistoryItem[] | null {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => { jget<{ items: HistoryItem[] }>("/api/history?limit=200").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);
  return items;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex h-9 max-w-sm items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
      <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted" />
    </div>
  );
}

// ---------------- Artists ----------------
export function ArtistsView() {
  const items = useHistory();
  const [q, setQ] = useState("");
  const artists = useMemo(() => {
    const map = new Map<string, { name: string; tracks: Set<string>; analyses: number; distributors: Set<string>; artwork: string | null; lastSeen: string }>();
    for (const h of items ?? []) {
      for (const a of h.artists ?? []) {
        const e = map.get(a) ?? { name: a, tracks: new Set<string>(), analyses: 0, distributors: new Set<string>(), artwork: null, lastSeen: h.at };
        e.analyses++;
        if (h.trackTitle) e.tracks.add(h.trackTitle);
        if (h.distributor) e.distributors.add(h.distributor);
        if (!e.artwork && h.artworkUrl) e.artwork = h.artworkUrl;
        if (h.at > e.lastSeen) e.lastSeen = h.at;
        map.set(a, e);
      }
    }
    return [...map.values()].sort((a, b) => b.analyses - a.analyses);
  }, [items]);

  const filtered = q.trim() ? artists.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())) : artists;

  return (
    <div>
      <PageHead title="Artists" description="Every artist observed in your analyses, with their tracks and resolved distributors." />
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search artists…" /></div>
      {!items ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="size-5" aria-hidden />} title={q ? "No matches" : "No artists yet"} description={q ? undefined : "Artists appear here as you analyze tracks."} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-strong">
          <table className="w-full text-[13px]">
            <thead className="bg-card-elevated">
              <tr className="border-b border-border-subtle text-left text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                <th className="w-12 px-3 py-2.5" />
                <th className="px-3 py-2.5">Artist</th>
                <th className="px-3 py-2.5">Analyzed tracks</th>
                <th className="px-3 py-2.5">Analyses</th>
                <th className="px-3 py-2.5">Distributors</th>
                <th className="px-3 py-2.5">Last analyzed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.name} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                  <td className="px-3 py-2"><ArtworkThumb src={a.artwork} alt={a.name} size={32} rounded="full" /></td>
                  <td className="px-3 py-2 font-medium text-foreground">{a.name}</td>
                  <td className="px-3 py-2 tabular-nums text-foreground-secondary">{a.tracks.size}</td>
                  <td className="px-3 py-2 tabular-nums text-foreground-secondary">{a.analyses}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{[...a.distributors].join(", ") || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground-muted">{fmtDate(a.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Albums ----------------
export function AlbumsView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const items = useHistory();
  const albums = useMemo(() => {
    const map = new Map<string, { key: string; title: string; artist: string; artwork: string | null; releaseDate: string | null; albumId: string | null; distributors: Set<string>; tracks: Set<string>; lastSeen: string }>();
    for (const h of items ?? []) {
      if (!h.albumTitle) continue;
      const key = h.spotifyAlbumId ?? `${h.albumTitle}::${(h.artists ?? [])[0] ?? ""}`;
      const e = map.get(key) ?? { key, title: h.albumTitle, artist: (h.artists ?? [])[0] ?? "—", artwork: null, releaseDate: h.releaseDate ?? null, albumId: h.spotifyAlbumId ?? null, distributors: new Set<string>(), tracks: new Set<string>(), lastSeen: h.at };
      if (!e.artwork && h.artworkUrl) e.artwork = h.artworkUrl;
      if (h.distributor) e.distributors.add(h.distributor);
      if (h.trackTitle) e.tracks.add(h.trackTitle);
      if (h.at > e.lastSeen) e.lastSeen = h.at;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }, [items]);

  return (
    <div>
      <PageHead title="Releases" description="Releases observed in your analyses. Open one to load its full tracklist." />
      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}</div>
      ) : albums.length === 0 ? (
        <EmptyState icon={<Disc3 className="size-5" aria-hidden />} title="No releases yet" description="Releases appear here as you analyze tracks. Older history entries (before the catalog upgrade) don't carry album data." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {albums.map((a) => (
            <button
              key={a.key}
              disabled={!a.albumId}
              onClick={() => a.albumId && onAnalyze(`https://open.spotify.com/album/${a.albumId}`)}
              title={a.albumId ? "Open release workspace" : undefined}
              className="group rounded-md border border-border-strong bg-card p-2.5 text-left transition-[transform,border-color] duration-base hover:-translate-y-0.5 hover:border-accent/30 disabled:cursor-default disabled:hover:translate-y-0"
            >
              <ArtworkThumb src={a.artwork} alt={a.title} size={148} rounded="md" className="w-full" />
              <div className="mt-2 truncate text-[12.5px] font-medium text-foreground">{a.title}</div>
              <div className="truncate text-[11.5px] text-foreground-muted">{a.artist}</div>
              <div className="mt-1 text-[10.5px] text-foreground-muted">
                {a.releaseDate ? new Date(a.releaseDate).getFullYear() : ""}{a.tracks.size ? ` · ${a.tracks.size} analyzed` : ""}
              </div>
              {a.distributors.size > 0 && <div className="mt-0.5 truncate text-[10.5px] text-accent">{[...a.distributors].join(", ")}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Tracks ----------------
export function TracksView({ onAnalyze }: { onAnalyze: (input: string) => void }) {
  const items = useHistory();
  const [q, setQ] = useState("");
  const tracks = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const h of items ?? []) {
      const key = h.spotifyTrackId ?? h.isrc ?? `${h.trackTitle}::${(h.artists ?? []).join(",")}`;
      if (!key || key.startsWith("null")) continue;
      if (!map.has(key)) map.set(key, h);
    }
    return [...map.values()];
  }, [items]);

  const filtered = q.trim()
    ? tracks.filter((t) => (t.trackTitle ?? "").toLowerCase().includes(q.trim().toLowerCase()) || (t.artists ?? []).join(" ").toLowerCase().includes(q.trim().toLowerCase()) || (t.isrc ?? "").toLowerCase().includes(q.trim().toLowerCase()))
    : tracks;

  return (
    <div>
      <PageHead title="Tracks" description="Every distinct track you've analyzed — latest result per track." />
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search title, artist, ISRC…" /></div>
      {!items ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Music2 className="size-5" aria-hidden />} title={q ? "No matches" : "No tracks yet"} description={q ? undefined : "Analyzed tracks appear here."} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-strong">
          <table className="w-full text-[13px]">
            <thead className="bg-card-elevated">
              <tr className="border-b border-border-subtle text-left text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
                <th className="w-12 px-3 py-2.5" />
                <th className="px-3 py-2.5">Track</th>
                <th className="px-3 py-2.5">Artist</th>
                <th className="px-3 py-2.5">ISRC</th>
                <th className="px-3 py-2.5">Distributor</th>
                <th className="px-3 py-2.5">Released</th>
                <th className="px-3 py-2.5">Analyzed</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id ?? i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                  <td className="px-3 py-2"><ArtworkThumb src={t.artworkUrl} alt={t.trackTitle ?? "artwork"} size={32} /></td>
                  <td className="px-3 py-2 font-medium text-foreground">{t.trackTitle ?? t.input.slice(0, 24)}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{(t.artists ?? []).join(", ") || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-foreground-muted">{t.isrc ?? "—"}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{t.distributor ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground-muted">{t.releaseDate ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground-muted">{fmtDate(t.at)}</td>
                  <td className="px-3 py-2"><Button variant="secondary" size="sm" onClick={() => onAnalyze(t.spotifyTrackId ?? t.input)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
