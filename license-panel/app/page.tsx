"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Shell } from "./shell";
import { Badge, Panel, Stat, ago, api, fmt } from "./ui";

type Stats = {
  total: number; active: number; unused: number; expired: number; revoked: number;
  devices: number; distinctIps: number; spotifyAccounts: number; suspicious: number;
  last24h: number; denied24h: number;
};
type EventRow = {
  at: string; action: string; outcome: string; keyLabel: string | null;
  deviceId: string | null; ip: string | null; detail: string | null;
};

export default function OverviewPage() {
  return (
    <Shell active="/">
      <Overview />
    </Shell>
  );
}

function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  const load = useCallback(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch(() => {});
    api<{ events: EventRow[] }>("/api/admin/events?limit=15").then((r) => setEvents(r.events)).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">Overview</h1>
        <p className="mt-0.5 text-[12.5px] text-foreground-muted">
          Every activation and check-in from the desktop app, with the IP and the time it happened.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Keys" value={stats?.total ?? "—"} />
        <Stat label="Active" value={stats?.active ?? "—"} tone="success" />
        <Stat label="Unused" value={stats?.unused ?? "—"} />
        <Stat label="Devices" value={stats?.devices ?? "—"} />
        <Stat label="Distinct IPs" value={stats?.distinctIps ?? "—"} />
        <Stat label="Spotify accounts" value={stats?.spotifyAccounts ?? "—"} tone="accent" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Checks (24h)" value={stats?.last24h ?? "—"} />
        <Stat label="Refused (24h)" value={stats?.denied24h ?? "—"} tone={stats && stats.denied24h > 0 ? "warning" : "neutral"} />
        <Stat label="Expired" value={stats?.expired ?? "—"} />
        <Stat label="Revoked" value={stats?.revoked ?? "—"} tone={stats && stats.revoked > 0 ? "danger" : "neutral"} />
      </div>

      {stats && stats.suspicious > 0 && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-foreground-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <b className="text-foreground">{stats.suspicious} key{stats.suspicious > 1 ? "s look" : " looks"} shared.</b>{" "}
            They answer from more machines or more IP addresses than one person normally would.{" "}
            <a href="/keys" className="text-accent hover:underline">Review them <ArrowRight className="inline size-3" aria-hidden /></a>
          </div>
        </div>
      )}

      <Panel title="Latest activity" description="Newest first. The full trail lives under Activity." actions={<a href="/activity" className="text-[12px] text-accent hover:underline">Open activity →</a>}>
        {events.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-foreground-muted">Nothing yet — no app has checked in.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">IP</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 text-foreground-secondary" title={fmt(e.at)}>{ago(e.at)}</td>
                    <td className="py-2 pr-3 text-foreground-secondary">{e.action}</td>
                    <td className="py-2 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.keyLabel ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                    <td className="py-2">
                      <Badge tone={e.outcome === "ok" ? "success" : "danger"}>{e.outcome}</Badge>
                    </td>
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
