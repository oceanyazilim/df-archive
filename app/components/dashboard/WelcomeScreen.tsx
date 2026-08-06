"use client";

/**
 * First screen a customer sees: a greeting and one input, nothing else.
 *
 * The full workspace (sidebar, menus, panels) only appears once they have
 * something to look at — an empty dashboard behind a wall of navigation is
 * noise on the first run. Analyzing anything, or choosing "Skip", opens it.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Disc3, ListMusic, Music2, Sparkles, Users } from "lucide-react";
import { BrandLogo } from "../BrandLogo";
import { Button } from "../shared/Button";

const EXAMPLES: { icon: typeof Music2; label: string; hint: string }[] = [
  { icon: Music2, label: "Track link", hint: "open.spotify.com/track/…" },
  { icon: Disc3, label: "Album link", hint: "open.spotify.com/album/…" },
  { icon: ListMusic, label: "Playlist link", hint: "open.spotify.com/playlist/…" },
  { icon: Users, label: "ISRC or UPC", hint: "GBARL9300135 · 0859381157694" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function WelcomeScreen({ onAnalyze, onSkip, running }: {
  onAnalyze: (input: string) => void;
  onSkip: () => void;
  running: boolean;
}) {
  const [value, setValue] = useState("");
  const [hello, setHello] = useState("Welcome");

  // Time-of-day greeting is computed after mount: rendering it on the server
  // would hydrate with the server's clock and flicker.
  useEffect(() => setHello(greeting()), []);

  const submit = () => {
    const v = value.trim();
    if (!v || running) return;
    onAnalyze(v);
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(58% 42% at 50% 0%, var(--accent-dim), transparent 72%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 0.8, 0.36, 1] }}
        className="relative w-full max-w-[640px] pb-16"
      >
        <div className="mb-7 flex justify-center">
          <BrandLogo variant="emptyState" height={58} />
        </div>

        <h1 className="text-center text-[26px] font-semibold tracking-tight text-foreground">
          {hello}
        </h1>
        <p className="mx-auto mt-2 max-w-[440px] text-center text-[13.5px] leading-relaxed text-foreground-secondary">
          Paste a Spotify link and I will tell you who distributes it — with the metadata,
          identifiers and streaming history behind it.
        </p>

        <div className="mt-7">
          <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-card p-2 shadow transition-colors focus-within:border-accent/60">
            <Sparkles className="ml-2 size-4 shrink-0 text-accent" aria-hidden />
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Paste a track, album, artist or playlist link…"
              aria-label="Analyze a Spotify link"
              className="h-10 w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-foreground-muted"
            />
            <Button
              variant="primary"
              size="md"
              className="shrink-0"
              loading={running}
              disabled={!value.trim()}
              onClick={submit}
              icon={running ? undefined : <ArrowRight className="size-4" aria-hidden />}
            >
              {running ? "Analyzing" : "Analyze"}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXAMPLES.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.label} className="rounded-md border border-border-subtle bg-card/60 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground-secondary">
                    <Icon className="size-3.5 text-foreground-muted" aria-hidden /> {e.label}
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] text-foreground-muted" title={e.hint}>{e.hint}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-7 text-center">
          <button
            onClick={onSkip}
            className="text-[12.5px] text-foreground-muted underline-offset-4 transition-colors hover:text-foreground-secondary hover:underline"
          >
            Skip and open the workspace
          </button>
        </div>
      </motion.div>
    </div>
  );
}
