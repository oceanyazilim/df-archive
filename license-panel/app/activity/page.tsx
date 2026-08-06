"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "../shell";
import { Badge, Panel, api, fmt } from "../ui";

type EventRow = {
  at: string; action: string; outcome: string; keyId: string | null; keyLabel: string | null;
  deviceId: string | null; ip: string | null; userAgent: string | null; detail: string | null;
};

const OUTCOMES = ["all", "ok", "unknown_key", "revoked", "expired", "device_limit", "invalid_token", "device_blocked"];

export default function ActivityPage() {
  return (
    <Shell active="/activity">
      <Activity />
    </Shell>
  );
}

function Activity() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [outcome, setOutcome] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    api<{ events: EventRow[] }>(`/api/admin/events?limit=500&outcome=${encodeURIComponent(outcome)}`)
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, [outcome]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const q = query.trim().toLowerCase();
  const shown = (events ?? []).filter((e) =>
    !q || [e.keyLabel, e.ip, e.deviceId, e.detail].some((v) => v?.toLowerCase().includes(q))
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Activity</h1>
        <p className="mt-0.5 text-[12.5px] text-foreground-muted">
          Every request the desktop app made, with the IP address it came from and the exact time.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by key, IP or device…"
          className="h-9 max-w-[300px]"
        />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-9 max-w-[200px]">
          {OUTCOMES.map((o) => <option key={o} value={o}>{o === "all" ? "All results" : o}</option>)}
        </select>
        <span className="text-[12px] text-foreground-muted">{shown.length} record{shown.length === 1 ? "" : "s"}</span>
      </div>

      <Panel>
        {events === null ? (
          <p className="py-6 text-center text-[12.5px] text-foreground-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-foreground-muted">Nothing matches.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">IP</th>
                  <th className="py-2 pr-3 font-medium">Device</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-secondary">{fmt(e.at)}</td>
                    <td className="py-2 pr-3 text-foreground-secondary">{e.action}</td>
                    <td className="py-2 pr-3 font-mono text-[11.5px]">
                      {e.keyId ? <a href={`/keys/${e.keyId}`} className="text-foreground-muted hover:text-accent hover:underline">{e.keyLabel}</a> : <span className="text-foreground-muted">—</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                    <td className="max-w-[150px] truncate py-2 pr-3 font-mono text-[11px] text-foreground-muted" title={e.deviceId ?? ""}>{e.deviceId ?? "—"}</td>
                    <td className="py-2 pr-3"><Badge tone={e.outcome === "ok" ? "success" : "danger"}>{e.outcome}</Badge></td>
                    <td className="max-w-[200px] truncate py-2 text-foreground-muted" title={e.detail ?? ""}>{e.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
