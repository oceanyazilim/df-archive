"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runConnectorLookup } from "../connector";
import type { ArtistCatalogData, CatalogTrack } from "../../components/ArtistCatalog";

/** Per-track resolution state, filled progressively from the Spotify connector. */
export type Resolved = { status: "idle" | "running" | "done" | "failed"; distributor: string | null; licensorUuid: string | null; isrc: string | null; state?: string };

export interface ReleaseRow {
  albumId: string;
  title: string;
  artists: string[];
  releaseType: string | null;
  releaseDate: string | null;
  trackCount: number;
  upc: string | null;
  onProfileCount: number;
  offProfileCount: number;
  tracks: CatalogTrack[];
  /** Distinct resolved distributor names among this release's tracks — >1 is a real conflict signal. */
  distributors: string[];
  metadataStatus: "healthy" | "warning" | "conflict" | "missing" | "unresolved";
}

const PARALLEL = 3;

function computeMetadataStatus(tracks: CatalogTrack[], distributors: string[]): ReleaseRow["metadataStatus"] {
  if (distributors.length > 1) return "conflict";
  const missingIsrc = tracks.some((t) => !t.isrc);
  const missingUpc = !tracks.some((t) => t.upc);
  if (missingUpc || missingIsrc) return "missing";
  if (distributors.length === 0) return "unresolved";
  return "healthy";
}

/**
 * Extracted from the original ArtistCatalog.tsx bulk-resolution flow (kept
 * byte-for-byte behaviorally identical) plus a new release-level grouping so
 * both the catalog dashboard and the release table can share one resolution
 * state instead of re-resolving independently.
 */
export function useArtistCatalog(data: ArtistCatalogData) {
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const resolvedRef = useRef<Record<string, Resolved>>({});
  resolvedRef.current = resolved;

  const resolvable = useMemo(() => data.tracks.filter((t) => !!t.spotifyTrackId), [data.tracks]);
  const doneCount = useMemo(() => Object.values(resolved).filter((r) => r.status === "done" || r.status === "failed").length, [resolved]);

  useEffect(() => () => { cancelRef.current = true; }, []);

  const resolveAll = useCallback(async (only?: CatalogTrack[]) => {
    const queue = (only ?? resolvable).filter((t) => t.spotifyTrackId && !resolvedRef.current[t.key]);
    if (!queue.length) return;
    cancelRef.current = false;
    setRunning(true);

    let index = 0;
    const worker = async () => {
      while (!cancelRef.current) {
        const current = queue[index++];
        if (!current) return;
        const id = current.spotifyTrackId!;
        setResolved((p) => ({ ...p, [current.key]: { status: "running", distributor: null, licensorUuid: null, isrc: current.isrc } }));
        let next: Resolved;
        try {
          const r = await runConnectorLookup(id);
          const terminal = r.stage === "matched" || r.stage === "unresolved" || r.stage === "conflict";
          next = { status: terminal ? "done" : "failed", distributor: r.distributor, licensorUuid: r.licensorUuid, isrc: r.isrc ?? current.isrc, state: r.stage };
        } catch {
          next = { status: "failed", distributor: null, licensorUuid: null, isrc: current.isrc, state: "failed" };
        }
        setResolved((p) => ({ ...p, [current.key]: next }));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, () => worker().catch(() => {})));
    setRunning(false);
  }, [resolvable]);

  const stop = useCallback(() => { cancelRef.current = true; setRunning(false); }, []);

  const releaseRows = useMemo<ReleaseRow[]>(() => {
    const byAlbum = new Map<string, CatalogTrack[]>();
    for (const t of data.tracks) {
      const id = t.spotifyAlbumId ?? `__no-album-${t.key}`;
      if (!byAlbum.has(id)) byAlbum.set(id, []);
      byAlbum.get(id)!.push(t);
    }
    return Array.from(byAlbum.entries()).map(([albumId, tracks]) => {
      const first = tracks[0];
      const distributors = Array.from(new Set(
        tracks.map((t) => resolved[t.key]?.distributor).filter((d): d is string => !!d)
      ));
      return {
        albumId,
        title: first.albumTitle ?? first.title,
        artists: first.artists,
        releaseType: first.albumType,
        releaseDate: tracks.map((t) => t.releaseDate).filter(Boolean).sort()[0] ?? first.releaseDate,
        trackCount: tracks.length,
        upc: tracks.find((t) => t.upc)?.upc ?? null,
        onProfileCount: tracks.filter((t) => t.onProfile).length,
        offProfileCount: tracks.filter((t) => !t.onProfile).length,
        tracks,
        distributors,
        metadataStatus: computeMetadataStatus(tracks, distributors),
      };
    }).sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  }, [data.tracks, resolved]);

  return { resolved, running, resolvable, doneCount, resolveAll, stop, releaseRows };
}

export type UseArtistCatalogResult = ReturnType<typeof useArtistCatalog>;
