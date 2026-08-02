"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, HelpCircle } from "lucide-react";
import { NA } from "../../lib/types";
import { Button } from "../shared/Button";
import { scaleIn } from "../../lib/motion";
import { submitUuidFlag } from "../../lib/reviewQueue";

export interface DistributorNotFoundStateProps {
  licensorUuid: string | null;
  spotifyTrackId?: string | null;
  spotifyAlbumId?: string | null;
  trackTitle?: string | null;
  releaseTitle?: string | null;
  artists?: string[];
  className?: string;
}

/**
 * Non-failure state — a missing distributor match never makes the surrounding
 * analysis look broken. Real, working actions submit into the local review
 * queue rather than doing nothing.
 */
export function DistributorNotFoundState({ licensorUuid, spotifyTrackId, spotifyAlbumId, trackTitle, releaseTitle, artists, className }: DistributorNotFoundStateProps) {
  const [busy, setBusy] = useState<"add" | "report" | null>(null);
  const [done, setDone] = useState<"add" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(reason: "add" | "report") {
    setBusy(reason); setError(null);
    const res = await submitUuidFlag({ reason, licensorUuid, spotifyTrackId, spotifyAlbumId, trackTitle, releaseTitle, artists });
    setBusy(null);
    if (res.ok) setDone(reason); else setError(res.error ?? "Could not submit.");
  }

  return (
    <div className={className}>
      <div className="flex items-start gap-3 rounded-md border border-border-strong bg-card-elevated p-4">
        <HelpCircle className="mt-0.5 size-5 shrink-0 text-foreground-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Unknown Distributor</p>
          <p className="mt-1 text-xs text-foreground-secondary">
            {licensorUuid
              ? "A licensor UUID was captured but has no entry in the canonical mapping yet."
              : "No licensor UUID has been captured for this track yet — the public Spotify API doesn't expose it."}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted">
            <span>Licensor UUID:</span>
            <code className="font-mono text-[11px]">{licensorUuid ?? NA}</code>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AnimatePresence mode="wait" initial={false}>
              {done === "add" ? (
                <Confirmed key="add-done" label="Submitted — Add to UUID Database" />
              ) : (
                <motion.div key="add-btn" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
                  <Button variant="secondary" size="sm" loading={busy === "add"} disabled={busy !== null} onClick={() => submit("add")}>
                    Add to UUID Database
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              {done === "report" ? (
                <Confirmed key="report-done" label="Submitted — Report Mapping" />
              ) : (
                <motion.div key="report-btn" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
                  <Button variant="ghost" size="sm" loading={busy === "report"} disabled={busy !== null} onClick={() => submit("report")}>
                    Report Mapping
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function Confirmed({ label }: { label: string }) {
  return (
    <motion.span variants={scaleIn} initial="hidden" animate="visible" className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <Check className="size-3.5" aria-hidden /> {label}
    </motion.span>
  );
}
