import { Music2 } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ArtworkThumbProps {
  src?: string | null;
  alt: string;
  size?: number;
  rounded?: "sm" | "md" | "lg" | "full";
  className?: string;
}

const roundedMap = { sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", full: "rounded-full" } as const;

/** Release/artist artwork with a graceful fallback glyph when no image is available. */
export function ArtworkThumb({ src, alt, size = 44, rounded = "md", className }: ArtworkThumbProps) {
  const style = { width: size, height: size };
  if (!src) {
    return (
      <div
        style={style}
        className={cn("flex shrink-0 items-center justify-center border border-border-strong bg-card-elevated text-foreground-muted", roundedMap[rounded], className)}
      >
        <Music2 className="size-[40%]" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary allow-listed CDN hosts, not local/static assets.
    <img
      src={src}
      alt={alt}
      style={style}
      className={cn("shrink-0 border border-border-strong object-cover", roundedMap[rounded], className)}
    />
  );
}
