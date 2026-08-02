"use client";

import { useEffect, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Search, Loader2, Building2 } from "lucide-react";
import { cn } from "../../lib/cn";

interface MappingHit {
  uuid: string;
  distributor: string;
}

/**
 * Compact global search — distinct from the main Spotify URL analyzer.
 * Searches the local licensor-UUID/distributor mapping (`/api/distributors/search`,
 * the same bounded lookup the Distributor Database page uses) by name or UUID.
 */
export function GlobalSearch({ onOpenDistributors }: { onOpenDistributors: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MappingHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/distributors/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((d) => setResults(Array.isArray(d.results) ? d.results.slice(0, 8) : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex h-9 w-full max-w-[360px] items-center gap-2 rounded-sm border border-border-strong bg-input px-3 text-left text-[13px] text-foreground-muted transition-colors hover:border-accent/40"
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Search distributors, UUID…</span>
          <kbd className="hidden shrink-0 rounded border border-border-strong bg-card-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted sm:inline">
            Ctrl K
          </kbd>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={8}
          className={cn(
            "z-dropdown w-[360px] rounded-md border border-border-strong bg-card-elevated p-1.5 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        >
          <div className="flex items-center gap-2 border-b border-border-subtle px-2 pb-2">
            <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Distributor name or licensor UUID…"
              className="w-full bg-transparent py-1.5 text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
              autoFocus
            />
            {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" aria-hidden />}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {!query.trim() && (
              <p className="px-2.5 py-3 text-xs text-foreground-muted">Type to search the distributor / licensor UUID mapping.</p>
            )}
            {query.trim() && !loading && results.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-foreground-muted">No matches for &ldquo;{query}&rdquo;.</p>
            )}
            {results.map((r) => (
              <button
                key={r.uuid}
                onClick={() => { setOpen(false); onOpenDistributors(); }}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] text-foreground-secondary hover:bg-card-hover hover:text-foreground"
              >
                <Building2 className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{r.distributor || "Unknown distributor"}</span>
                <span className="shrink-0 truncate font-mono text-[10.5px] text-foreground-muted">{r.uuid.slice(0, 8)}…</span>
              </button>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
