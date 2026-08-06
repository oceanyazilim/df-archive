"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon, Download, Search } from "lucide-react";
import { Shell } from "../shell";
import { ACTION_LABEL, Button, EmptyState, OutcomeBadge, PageHead, Panel, Skeleton, Table, api, fmt } from "../ui";

type EventRow = {
  at: string; action: string; outcome: string; keyId: string | null; keyLabel: string | null;
  deviceId: string | null; ip: string | null; userAgent: string | null; detail: string | null;
};

const OUTCOMES = [
  { value: "all", label: "All results" },
  { value: "ok", label: "Accepted" },
  { value: "unknown_key", label: "Unknown key" },
  { value: "revoked", label: "Revoked" },
  { value: "expired", label: "Expired" },
  { value: "device_limit", label: "Device limit" },
  { value: "invalid_token", label: "Not activated" },
  { value: "device_blocked", label: "Blocked device" },
];

export default function ActivityPage() {
  return (
    <Shell active="/activity">
      <ActivityView />
    </Shell>
  );
}

function ActivityView() {
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

  const exportCsv = () => {
    const head = ["time", "event", "result", "key", "ip", "device", "detail"];
    const rows = shown.map((e) => [e.at, e.action, e.outcome, e.keyLabel ?? "", e.ip ?? "", e.deviceId ?? "", e.detail ?? ""]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `virus-records-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHead
        title="Activity"
        description="Every request the desktop app made, with the address it came from and the exact time."
        actions={<Button size="sm" variant="secondary" onClick={exportCsv} disabled={!shown.length}><Download className="size-3.5" aria-hidden /> Export CSV</Button>}
      />

      <div className="anim-in mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-[7px] border border-border-strong bg-input px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by key, IP address or computer…"
            className="h-full w-full border-0 bg-transparent p-0 text-[13px] outline-none focus:shadow-none"
          />
        </div>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-9 max-w-[190px]">
          {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-[12px] text-foreground-muted">{shown.length} record{shown.length === 1 ? "" : "s"}</span>
      </div>

      <Panel className="anim-in anim-in-1">
        {events === null ? (
          <div className="space-y-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<ActivityIcon className="size-6" aria-hidden />} title="Nothing here" description="No request matches this filter." />
        ) : (
          <Table head={["Time", "Event", "Key", "IP address", "Computer", "Result", "Detail"]}>
            {shown.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                <td className="whitespace-nowrap py-2.5 pr-3 text-foreground-secondary">{fmt(e.at)}</td>
                <td className="py-2.5 pr-3 text-foreground-secondary">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px]">
                  {e.keyId ? <a href={`/keys/${e.keyId}`} className="text-foreground-muted hover:text-accent hover:underline">{e.keyLabel}</a> : <span className="text-foreground-muted">—</span>}
                </td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                <td className="max-w-[140px] truncate py-2.5 pr-3 font-mono text-[11px] text-foreground-muted" title={e.deviceId ?? ""}>{e.deviceId ?? "—"}</td>
                <td className="py-2.5 pr-3"><OutcomeBadge outcome={e.outcome} /></td>
                <td className="max-w-[180px] truncate py-2.5 text-foreground-muted" title={e.detail ?? ""}>{e.detail ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
