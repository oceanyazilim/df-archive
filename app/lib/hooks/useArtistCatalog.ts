"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runConnectorLookup } from "../connector";
import { jget } from "../types";
import type { ArtistCatalogData, CatalogTrack } from "../../components/ArtistCatalog";

/** Per-track resolution state, filled progressively from the Spotify connector. */
export type Resolved = {
  status: "idle" | "running" | "done" | "failed";
  distributor: string | null;
  licensorUuid: string | null;
  isrc: string | null;
  /** Recovered for removed tracks (Soundcharts albums / Spotify album read). */
  upc?: string | null;
  /** Spotify id recovered for a removed track — makes it distributor-resolvable. */
  spotifyTrackId?: string | null;
  albumTitle?: string | null;
  state?: string;
};

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

type RecoveredTrackPayload = {
  track?: {
    spotifyTrackId: string | null;
    isrc: string | null;
    upc: string | null;
    albumTitle: string | null;
    releaseDate: string | null;
  };
  error?: { message?: string };
};

/**
 * Extracted from the original ArtistCatalog.tsx bulk-resolution flow, plus a
 * release-level grouping so the catalog dashboard and the release table share
 * one resolution state.
 *
 * Removed tracks (off-profile, no Spotify id) are part of the same queue: they
 * first go through /api/artist/recover-track (Soundcharts identifiers/albums +
 * Spotify ISRC search) to get their ISRC/UPC back — and when that recovers a
 * Spotify id, the normal connector lookup resolves their distributor too.
 */
export function useArtistCatalog(data: ArtistCatalogData) {
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const resolvedRef = useRef<Record<string, Resolved>>({});
  resolvedRef.current = resolved;

  // Everything the pipeline can work on: live tracks by Spotify id, removed
  // tracks by their Soundcharts uuid (recovery first, then the connector).
  const resolvable = useMemo(
    () => data.tracks.filter((t) => !!t.spotifyTrackId || !!t.soundchartsSongUuid),
    [data.tracks]
  );
  const doneCount = useMemo(() => Object.values(resolved).filter((r) => r.status === "done" || r.status === "failed").length, [resolved]);

  useEffect(() => () => { cancelRef.current = true; }, []);

  const resolveAll = useCallback(async (only?: CatalogTrack[]) => {
    const queue = (only ?? resolvable).filter(
      (t) => (t.spotifyTrackId || t.soundchartsSongUuid) && !resolvedRef.current[t.key]
    );
    if (!queue.length) return;
    cancelRef.current = false;
    setRunning(true);

    let index = 0;
    const worker = async () => {
      while (!cancelRef.current) {
        const current = queue[index++];
        if (!current) return;
        setResolved((p) => ({ ...p, [current.key]: { status: "running", distributor: null, licensorUuid: null, isrc: current.isrc } }));

        // Removed track: recover identifiers before (maybe) resolving. Artist
        // rows arrive with a Soundcharts uuid and no Spotify id; playlist rows
        // arrive removed WITH their (delisted) Spotify id — both recover.
        let spotifyId = current.spotifyTrackId;
        let recovered: RecoveredTrackPayload["track"] | null = null;
        const needsRecovery =
          (!spotifyId && !!current.soundchartsSongUuid) ||
          (!current.onProfile && (!current.isrc || !current.upc) && (!!current.soundchartsSongUuid || !!spotifyId));
        if (needsRecovery) {
          try {
            const q = new URLSearchParams();
            if (current.soundchartsSongUuid) q.set("songUuid", current.soundchartsSongUuid);
            if (spotifyId) q.set("spotifyTrackId", spotifyId);
            if (current.isrc) q.set("isrc", current.isrc);
            const r = await jget<RecoveredTrackPayload>(`/api/artist/recover-track?${q.toString()}`);
            recovered = r.track ?? null;
            spotifyId = spotifyId ?? recovered?.spotifyTrackId ?? null;
          } catch { /* recovery is best-effort; reported below */ }
        }

        const base: Resolved = {
          status: "failed",
          distributor: null,
          licensorUuid: null,
          isrc: recovered?.isrc ?? current.isrc,
          upc: recovered?.upc ?? current.upc,
          spotifyTrackId: spotifyId,
          albumTitle: recovered?.albumTitle ?? null,
        };

        let next: Resolved;
        if (!spotifyId) {
          // Nothing on Spotify anymore — the recovered ISRC/UPC still count as
          // a result: "done" when we got identifiers back, "failed" otherwise.
          const gotSomething = !!(recovered && (recovered.isrc || recovered.upc));
          next = { ...base, status: gotSomething ? "done" : "failed", state: gotSomething ? "recovered_no_spotify" : "unrecoverable" };
        } else {
          try {
            const r = await runConnectorLookup(spotifyId);
            const terminal = r.stage === "matched" || r.stage === "unresolved" || r.stage === "conflict";
            next = { ...base, status: terminal ? "done" : "failed", distributor: r.distributor, licensorUuid: r.licensorUuid, isrc: r.isrc ?? base.isrc ?? null, state: r.stage };
          } catch {
            next = { ...base, status: "failed", state: "failed" };
          }
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
      // Effective identifiers: catalogue data plus whatever recovery filled in.
      const effIsrc = (t: CatalogTrack) => t.isrc ?? resolved[t.key]?.isrc ?? null;
      const effUpc = (t: CatalogTrack) => t.upc ?? resolved[t.key]?.upc ?? null;
      const allRemoved = tracks.every((t) => !t.onProfile);

      const missingIsrc = tracks.some((t) => !effIsrc(t));
      const missingUpc = !tracks.some((t) => effUpc(t));
      const metadataStatus: ReleaseRow["metadataStatus"] =
        distributors.length > 1 ? "conflict"
        : missingUpc || missingIsrc ? "missing"
        : distributors.length === 0 ? "unresolved"
        : "healthy";

      return {
        albumId,
        title: first.albumTitle ?? resolved[first.key]?.albumTitle ?? first.title,
        artists: first.artists,
        // A release whose every track is gone from the profile IS the removed
        // category — surfaced as its own type, not a footnote count.
        releaseType: allRemoved ? "removed" : first.albumType,
        releaseDate: tracks.map((t) => t.releaseDate).filter(Boolean).sort()[0] ?? first.releaseDate,
        trackCount: tracks.length,
        upc: tracks.map(effUpc).find(Boolean) ?? null,
        onProfileCount: tracks.filter((t) => t.onProfile).length,
        offProfileCount: tracks.filter((t) => !t.onProfile).length,
        tracks,
        distributors,
        metadataStatus,
      };
    }).sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  }, [data.tracks, resolved]);

  return { resolved, running, resolvable, doneCount, resolveAll, stop, releaseRows };
}

export type UseArtistCatalogResult = ReturnType<typeof useArtistCatalog>;
