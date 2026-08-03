"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardPaste, Loader2, Search, Sparkles, X } from "lucide-react";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { cn } from "../../lib/cn";
import { UrlTypeBadge } from "./UrlTypeBadge";

const RECENT_KEY = "ocean:recent-analyzed";
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(value: string) {
  try {
    const next = [value, ...readRecent().filter((v) => v !== value)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export interface SpotifyUrlInputProps {
  variant?: "hero" | "compact";
  onAnalyze: (input: string) => void;
  running: boolean;
  className?: string;
}

/**
 * The primary URL analyzer — hero variant on the dashboard, compact variant
 * everywhere else (top nav / quick-analyze popover). Auto-detects the input
 * type, validates before submit, and remembers recently analyzed URLs.
 */
export function SpotifyUrlInput({ variant = "hero", onAnalyze, running, className }: SpotifyUrlInputProps) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRecent(readRecent()), []);

  const parsed = useMemo(() => (value.trim() ? parseMusicLookupInput(value.trim()) : null), [value]);
  const showInvalid = touched && !!parsed && parsed.type === "invalid";

  function submit(raw?: string) {
    const v = (raw ?? value).trim();
    if (!v || running) return;
    onAnalyze(v);
    pushRecent(v);
    setRecent(readRecent());
    // Value is intentionally kept (not cleared) so a failed analysis leaves the
    // original URL visible and ready to retry, per the error-state requirement
    // that the original input is always preserved.
    setTouched(false);
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setValue(text); setTouched(true); inputRef.current?.focus(); }
    } catch { /* clipboard permission denied — user can paste manually */ }
  }

  const isHero = variant === "hero";

  return (
    <div className={className}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const text = e.dataTransfer.getData("text/plain");
          if (text) { setValue(text); setTouched(true); }
        }}
        className={cn(
          "group flex items-center gap-2 rounded-lg border bg-input transition-colors duration-fast",
          isHero ? "h-14 px-4" : "h-10 px-3",
          dragOver ? "border-accent" : showInvalid ? "border-danger/50" : "border-border-strong focus-within:border-accent/60",
          running && "opacity-80"
        )}
      >
        <Search className={cn("shrink-0 text-foreground-muted", isHero ? "size-5" : "size-4")} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={running}
          onChange={(e) => { setValue(e.target.value); setTouched(false); }}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={isHero ? "Type something… artist, track, album, or UUID" : "Paste a Spotify artist, album, or track URL…"}
          aria-label="Spotify URL to analyze"
          aria-invalid={showInvalid || undefined}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-foreground-muted disabled:cursor-not-allowed",
            isHero ? "text-[15px]" : "text-[13px]"
          )}
        />
        {parsed && parsed.type !== "invalid" && <UrlTypeBadge type={parsed.type} className={isHero ? undefined : "hidden sm:inline-flex"} />}
        {value && !running && (
          <button type="button" onClick={() => { setValue(""); setTouched(false); inputRef.current?.focus(); }} aria-label="Clear input" className="flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-card-hover hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        )}
        {!value && (
          <button type="button" onClick={handlePaste} aria-label="Paste from clipboard" className="flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-card-hover hover:text-foreground">
            <ClipboardPaste className="size-3.5" aria-hidden />
          </button>
        )}
        <motion.button
          type="button"
          onClick={() => submit()}
          disabled={running || !value.trim()}
          whileTap={{ scale: 0.97 }}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md font-medium text-[var(--on-accent)] transition-opacity disabled:opacity-40",
            "bg-[linear-gradient(135deg,#39BDF8,#1578FF)] hover:brightness-110",
            isHero ? "h-10 px-4 text-sm" : "h-7 px-3 text-xs"
          )}
        >
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className={isHero ? "size-4" : "size-3.5"} aria-hidden />}
          Analyze URL
        </motion.button>
      </div>

      {showInvalid && parsed?.reason && (
        <p className="mt-1.5 text-xs text-danger">{parsed.reason}</p>
      )}

      {isHero && recent.length > 0 && !value && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-foreground-muted">Recent:</span>
          {recent.map((r) => (
            <button
              key={r}
              onClick={() => submit(r)}
              disabled={running}
              className="max-w-[220px] truncate rounded-full border border-border-strong bg-card px-2.5 py-1 text-[11px] text-foreground-secondary transition-colors hover:border-accent/40 hover:text-foreground disabled:opacity-50"
              title={r}
            >
              {r.replace(/^https?:\/\/(open\.)?spotify\.com\//, "")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
