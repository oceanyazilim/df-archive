"use client";

import { useMemo, useState } from "react";
import { Search, WrapText } from "lucide-react";
import { cn } from "../../lib/cn";
import { CopyButton } from "../shared/CopyButton";

/** Minimal JSON syntax highlighter — no extra dependency, dark-theme tuned. */
function highlight(json: string, query: string): string {
  let out = json
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (match) => {
      let cls = "text-accent-secondary"; // number
      if (/^"/.test(match)) cls = /:$/.test(match) ? "text-foreground-secondary" : "text-success";
      else if (/true|false/.test(match)) cls = "text-purple";
      else if (/null/.test(match)) cls = "text-danger";
      return `<span class="${cls}">${match}</span>`;
    });
  if (query.trim()) {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(${esc})`, "gi"), '<mark class="bg-accent/30 text-foreground rounded-sm">$1</mark>');
  }
  return out;
}

export function RawDataViewer({ data }: { data: unknown }) {
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const topKeys = useMemo(() => (data && typeof data === "object" ? Object.keys(data as object) : []), [data]);

  const visibleJson = useMemo(() => {
    if (collapsedKeys.size === 0 || !data || typeof data !== "object") return json;
    const clone: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    for (const k of collapsedKeys) if (k in clone) clone[k] = "[collapsed]";
    return JSON.stringify(clone, null, 2);
  }, [json, collapsedKeys, data]);

  function toggleKey(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="rounded-md border border-border-strong bg-card-elevated">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex min-w-[160px] flex-1 items-center gap-1.5 rounded-sm border border-border-strong bg-input px-2 py-1">
          <Search className="size-3 shrink-0 text-foreground-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search raw data…"
            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground-muted"
          />
        </div>
        {topKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {topKeys.map((k) => (
              <button
                key={k}
                onClick={() => toggleKey(k)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                  collapsedKeys.has(k) ? "border-border-strong bg-card text-foreground-muted" : "border-accent/30 bg-accent/10 text-accent"
                )}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setWrap((w) => !w)}
          className={cn("flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium", wrap ? "text-accent" : "text-foreground-muted")}
          aria-pressed={wrap}
        >
          <WrapText className="size-3.5" aria-hidden /> Wrap
        </button>
        <CopyButton value={json} label="Copy JSON" />
      </div>
      <pre
        className={cn("max-h-[480px] overflow-auto p-3 font-mono text-[12px] leading-relaxed text-foreground-secondary", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}
        dangerouslySetInnerHTML={{ __html: highlight(visibleJson, query) }}
      />
    </div>
  );
}
