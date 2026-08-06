import { Disc3, ListMusic, Music2, Users, Hash, Barcode, Fingerprint, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MusicInputType } from "@core/validation/musicInput";
import { cn } from "../../lib/cn";

const META: Record<MusicInputType, { label: string; icon: LucideIcon; tone: string }> = {
  spotify_track: { label: "Track", icon: Music2, tone: "text-accent bg-accent/10 border-accent/25" },
  spotify_album: { label: "Album", icon: Disc3, tone: "text-purple bg-purple/10 border-purple/25" },
  spotify_artist: { label: "Artist", icon: Users, tone: "text-accent-secondary bg-accent-secondary/10 border-accent-secondary/25" },
  spotify_playlist: { label: "Playlist", icon: ListMusic, tone: "text-accent-secondary bg-accent-secondary/10 border-accent-secondary/25" },
  isrc: { label: "ISRC", icon: Hash, tone: "text-success bg-success/10 border-success/25" },
  upc: { label: "UPC", icon: Barcode, tone: "text-success bg-success/10 border-success/25" },
  soundcharts_song_uuid: { label: "Song UUID", icon: Fingerprint, tone: "text-warning bg-warning/10 border-warning/25" },
  invalid: { label: "Unrecognized", icon: AlertCircle, tone: "text-danger bg-danger/10 border-danger/25" },
};

export function UrlTypeBadge({ type, className }: { type: MusicInputType; className?: string }) {
  const m = META[type];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none whitespace-nowrap", m.tone, className)}>
      <Icon className="size-3" aria-hidden />
      {m.label}
    </span>
  );
}
