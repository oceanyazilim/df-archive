import { ExternalLink } from "lucide-react";
import type { AnalyzerResult } from "@core/analyzer/service";
import { ArtworkThumb } from "../shared/ArtworkThumb";
import { Panel } from "../shared/Card";
import { StatusBadge } from "../shared/StatusBadge";
import { dur, fmtDate, NA } from "../../lib/types";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value}</div>
    </div>
  );
}

export function MetadataOverview({ result }: { result: AnalyzerResult }) {
  let title = "Untitled";
  let sub = "";
  let artwork: string | null = null;
  let facts: { label: string; value: string }[] = [];

  if (result.kind === "track") {
    title = result.title ?? "Untitled track";
    sub = result.artists.map((a) => a.name).join(", ");
    artwork = result.artworkUrl;
    facts = [
      { label: "Album", value: result.albumTitle ?? NA },
      { label: "Duration", value: dur(result.durationMs) ?? NA },
      { label: "Release date", value: fmtDate(result.releaseDate) },
      { label: "Explicit", value: result.explicit === null ? NA : result.explicit ? "Yes" : "No" },
      { label: "Popularity", value: result.popularity === null ? NA : `${result.popularity}/100` },
      { label: "Available markets", value: result.availableMarkets === null ? NA : `${result.availableMarkets}` },
    ];
  } else if (result.kind === "album") {
    title = result.title ?? "Untitled release";
    sub = result.artists.map((a) => a.name).join(", ");
    artwork = result.artworkUrl;
    facts = [
      { label: "Type", value: result.releaseType ?? NA },
      { label: "Tracks", value: `${result.totalTracks}` },
      { label: "Duration", value: dur(result.totalDurationMs) ?? NA },
      { label: "Release date", value: fmtDate(result.releaseDate) },
      { label: "Label", value: result.label ?? NA },
      { label: "Popularity", value: result.popularity === null ? NA : `${result.popularity}/100` },
    ];
  } else if (result.kind === "artist") {
    title = result.name ?? "Unknown artist";
    sub = result.genres.slice(0, 3).join(", ");
    artwork = result.imageUrl;
    facts = [
      { label: "Followers", value: result.restricted.profileStats ? NA : result.followers?.toLocaleString() ?? NA },
      { label: "Popularity", value: result.restricted.profileStats ? NA : result.popularity === null ? NA : `${result.popularity}/100` },
      { label: "Releases", value: `${result.releases.length}` },
      { label: "Top tracks", value: result.restricted.topTracks ? "Not available" : `${result.topTracks.length}` },
    ];
  } else {
    title = result.name ?? "Untitled playlist";
    sub = result.owner ? `By ${result.owner}` : "";
    artwork = result.artworkUrl;
    facts = [
      { label: "Tracks", value: `${result.totalTracks}` },
      { label: "Duration", value: dur(result.totalDurationMs) ?? NA },
      { label: "Visibility", value: result.isPublic === null ? NA : result.isPublic ? "Public" : "Private" },
      { label: "Followers", value: result.followers?.toLocaleString() ?? NA },
    ];
  }

  return (
    <Panel>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ArtworkThumb src={artwork} alt={title} size={96} rounded="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <StatusBadge tone="neutral" dot={false} className="mb-1.5 uppercase">{result.kind}</StatusBadge>
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h2>
              {sub && <p className="mt-0.5 truncate text-sm text-foreground-secondary">{sub}</p>}
            </div>
            <a href={result.spotifyUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              Open on Spotify <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {facts.map((f) => <Fact key={f.label} {...f} />)}
          </div>
        </div>
      </div>
    </Panel>
  );
}
