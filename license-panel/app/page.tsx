"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Ban, Globe, KeyRound, Laptop, Music2, ShieldX } from "lucide-react";
import { Shell } from "./shell";
import { ACTION_LABEL, Badge, Button, EmptyState, OutcomeBadge, PageHead, Panel, Skeleton, StatCard, Table, ago, api, fmt } from "./ui";

type Stats = {
  total: number; active: number; unused: number; expired: number; revoked: number;
  devices: number; distinctIps: number; spotifyAccounts: number; suspicious: number;
  last24h: number; denied24h: number;
};
type EventRow = {
  at: string; action: string; outcome: string; keyId: string | null; keyLabel: string | null;
  deviceId: string | null; ip: string | null; detail: string | null;
};
type KeyRow = {
  id: string; key: string; status: string; devices: number; deviceLimit: number;
  spotifyAccounts: string[]; signal: { distinctIps: number; devices: number; suspicious: boolean };
  note: string | null; lastSeenAt: string | null;
};

export default function DashboardPage() {
  return (
    <Shell active="/">
      <Dashboard />
    </Shell>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [flagged, setFlagged] = useState<KeyRow[]>([]);

  const load = useCallback(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch(() => {});
    api<{ events: EventRow[] }>("/api/admin/events?limit=12").then((r) => setEvents(r.events)).catch(() => setEvents([]));
    api<{ keys: KeyRow[] }>("/api/admin/keys").then((r) => setFlagged(r.keys.filter((k) => k.signal.suspicious))).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <div>
      <PageHead
        title="Dashboard"
        description="Live view of every key you issued: where it is being used, from which address, and when it last checked in."
        actions={<Button variant="primary" size="sm" onClick={() => { window.location.href = "/keys"; }}><KeyRound className="size-3.5" aria-hidden /> Issue a key</Button>}
      />

      <div className="anim-in grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Keys issued" value={stats?.total ?? "—"} icon={<KeyRound className="size-4" aria-hidden />} sub={stats ? `${stats.unused} never used` : undefined} />
        <StatCard label="Active" value={stats?.active ?? "—"} tone="success" sub={stats ? `${stats.expired} expired · ${stats.revoked} revoked` : undefined} />
        <StatCard label="Computers" value={stats?.devices ?? "—"} icon={<Laptop className="size-4" aria-hidden />} sub={stats ? `${stats.distinctIps} distinct IP addresses` : undefined} />
        <StatCard label="Spotify accounts" value={stats?.spotifyAccounts ?? "—"} tone="violet" icon={<Music2 className="size-4" aria-hidden />} sub="linked with consent" />
      </div>

      <div className="anim-in anim-in-1 mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Checks (24h)" value={stats?.last24h ?? "—"} icon={<Activity className="size-4" aria-hidden />} />
        <StatCard label="Refused (24h)" value={stats?.denied24h ?? "—"} tone={stats && stats.denied24h > 0 ? "warning" : "neutral"} icon={<ShieldX className="size-4" aria-hidden />} />
        <StatCard label="Possibly shared" value={stats?.suspicious ?? "—"} tone={stats && stats.suspicious > 0 ? "danger" : "neutral"} icon={<AlertTriangle className="size-4" aria-hidden />} />
        <StatCard label="Unused keys" value={stats?.unused ?? "—"} sub="waiting to be activated" />
      </div>

      {flagged.length > 0 && (
        <Panel
          className="anim-in anim-in-2 mt-5 border-warning/30"
          title="Keys worth a look"
          description="These answer from more computers or more addresses than one person normally would."
        >
          <div className="space-y-2">
            {flagged.slice(0, 5).map((k) => (
              <a key={k.id} href={`/keys/${k.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border-strong bg-card-elevated px-3.5 py-2.5 transition-colors hover:border-warning/40 hover:bg-card-hover">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                  <code className="font-mono text-[13px] tracking-wide text-foreground">{k.key}</code>
                  {k.note && <span className="text-[12px] text-foreground-muted">{k.note}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="warning"><Laptop className="size-3" aria-hidden /> {k.signal.devices} device{k.signal.devices > 1 ? "s" : ""}</Badge>
                  <Badge tone="warning"><Globe className="size-3" aria-hidden /> {k.signal.distinctIps} IPs</Badge>
                  <ArrowRight className="size-3.5 text-foreground-muted" aria-hidden />
                </div>
              </a>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        className="anim-in anim-in-3 mt-5"
        title="Latest activity"
        description="Newest first — every activation, check-in and refusal."
        actions={<a href="/activity" className="text-[12px] text-accent hover:underline">Open activity →</a>}
      >
        {events === null ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : events.length === 0 ? (
          <EmptyState icon={<Activity className="size-6" aria-hidden />} title="No activity yet" description="Nothing has checked in. Issue a key and activate the app to see it here." />
        ) : (
          <Table head={["When", "Event", "Key", "IP address", "Result"]}>
            {events.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0">
                <td className="whitespace-nowrap py-2.5 pr-3 text-foreground-secondary" title={fmt(e.at)}>{ago(e.at)}</td>
                <td className="py-2.5 pr-3 text-foreground-secondary">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px]">
                  {e.keyId ? <a href={`/keys/${e.keyId}`} className="text-foreground-muted hover:text-accent hover:underline">{e.keyLabel}</a> : <span className="text-foreground-muted">—</span>}
                </td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                <td className="py-2.5"><OutcomeBadge outcome={e.outcome} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

