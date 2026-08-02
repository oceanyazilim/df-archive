"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../../lib/cn";
import { scaleIn } from "../../lib/motion";

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

/** Copies `value` to the clipboard; icon briefly swaps to a check mark on success. */
export function CopyButton({ value, label = "Copy", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, permissions) — silently no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted transition-colors duration-fast hover:bg-card-hover hover:text-accent",
        className
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span key="check" variants={scaleIn} initial="hidden" animate="visible" exit="exit" className="inline-flex items-center gap-1 text-success">
            <Check className="size-3" aria-hidden /> Copied
          </motion.span>
        ) : (
          <motion.span key="copy" variants={scaleIn} initial="hidden" animate="visible" exit="exit" className="inline-flex items-center gap-1">
            <Copy className="size-3" aria-hidden /> {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
