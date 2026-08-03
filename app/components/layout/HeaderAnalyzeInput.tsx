"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock } from "lucide-react";
import { parseMusicLookupInput } from "@core/validation/musicInput";
import { SpotifyUrlInput } from "../analyzer/SpotifyUrlInput";
import { useIsAdmin } from "../providers/AdminProvider";

/**
 * The always-available analyze input in the top-center header — reachable
 * from every view, for admins and regular users alike, so a second lookup
 * never requires navigating back to the dashboard hero. The only restriction:
 * raw Soundcharts-UUID queries are an admin capability, so a non-admin
 * submitting one gets a short notice instead of a lookup.
 */
export function HeaderAnalyzeInput({ onAnalyze, running }: { onAnalyze: (input: string) => void; running: boolean }) {
  const isAdmin = useIsAdmin();
  const [blocked, setBlocked] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  function handleAnalyze(value: string) {
    if (!isAdmin && parseMusicLookupInput(value.trim()).type === "soundcharts_song_uuid") {
      setBlocked(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setBlocked(false), 3000);
      return;
    }
    setBlocked(false);
    onAnalyze(value);
  }

  return (
    <div className="relative w-full max-w-md">
      <SpotifyUrlInput variant="compact" running={running} onAnalyze={handleAnalyze} />
      <AnimatePresence>
        {blocked && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-0 top-full z-dropdown mt-1.5 flex items-center gap-1.5 rounded-sm border border-warning/30 bg-card-elevated px-2.5 py-1.5 text-[11.5px] text-warning shadow-lg"
            role="status"
          >
            <Lock className="size-3 shrink-0" aria-hidden /> This is only for admins.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
