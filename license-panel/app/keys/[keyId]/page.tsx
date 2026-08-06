"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Globe, Music2, Trash2, Unlink } from "lucide-react";
import { Shell } from "../../shell";
import { Badge, Button, CopyButton, Panel, Stat, ago, api, fmt, type Tone } from "../../ui";

type Device = {
  deviceId: string; deviceName: string | null; appVersion: string | null; blocked: boolean;
  firstSeenAt: string; lastSeenAt: string; lastIp: string | null;
  ips: { ip: string; at: string }[];
  spotify: {
    id: string; displayName: string | null; avatarUrl: string | null; country: string | null;
    product: string | null; followers: number | null; email: string | null; linkedAt: string;
  } | null;
};
type KeyDetail = {
  id: string; key: string; type: "single" | "duration" | "unlimited";
  durationDays: number | null; deviceLimit: number; note: string | null;
  createdAt: string; firstActivatedAt: string | null; expiresAt: string | null; revokedAt: string | null;
  status: "active" | "unused" | "expired" | "revoked";
  signal: { distinctIps: number; devices: number; suspicious: boolean };
  devices: Device[];
};
type EventRow = { at: string; action: string; outcome: string; ip: string | null; deviceId: string | null; detail: string | null };

const STATUS_TONE: Record<KeyDetail["status"], Tone> = { active: "success", unused: "neutral", expired: "warning", revoked: "danger" };

export default function KeyDetailPage({ params }: { params: { keyId: string } }) {
  return (
    <Shell active="/keys">
      <Detail keyId={params.keyId} />
    </Shell>
  );
}

function Detail({ keyId }: { keyId: string }) {
  const [data, setData] = useState<{ key: KeyDetail; events: EventRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ key: KeyDetail; events: EventRow[] }>(`/api/admin/keys/${keyId}`).then(setData).catch((e) => setError((e as Error).message));
  }, [keyId]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    await api(`/api/admin/keys/${keyId}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
    load();
  };

  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  if (!data) return <p className="text-[13px] text-foreground-muted">Loading…</p>;
  const k = data.key;

  return (
    <div className="space-y-5">
      <a href="/keys" className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All keys
      </a>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <code className="font-mono text-[19px] font-semibold tracking-wide">{k.key}</code>
            <CopyButton value={k.key} />
            <Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-foreground-muted">
            {k.type === "single" ? "Single use — one computer, forever"
              : k.type === "duration" ? `Timed — ${k.durationDays} days from first activation`
              : "Unlimited — never expires"}
            {k.deviceLimit > 0 ? ` · up to ${k.deviceLimit} device${k.deviceLimit > 1 ? "s" : ""}` : " · unlimited devices"}
            {k.note ? ` · ${k.note}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={k.revokedAt ? "secondary" : "danger"} onClick={() => act({ revoked: !k.revokedAt })}>
            <Ban className="size-3.5" aria-hidden /> {k.revokedAt ? "Restore key" : "Revoke key"}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              if (!window.confirm(`Delete ${k.key}? The app on any activated computer stops working at its next check-in.`)) return;
              await api(`/api/admin/keys/${keyId}`, { method: "DELETE" }).catch(() => {});
              window.location.href = "/keys";
            }}
          >
            <Trash2 className="size-3.5" aria-hidden /> Delete
          </Button>
        </div>
      </div>

      {k.signal.suspicious && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-foreground-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            This key answers from <b className="text-foreground">{k.signal.devices} device{k.signal.devices > 1 ? "s" : ""}</b> and{" "}
            <b className="text-foreground">{k.signal.distinctIps} different IP addresses</b>. That is the pattern of a shared key —
            block the devices you do not recognise, or revoke the key entirely.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Devices" value={`${k.devices.length}${k.deviceLimit > 0 ? ` / ${k.deviceLimit}` : ""}`} />
        <Stat label="Distinct IPs" value={k.signal.distinctIps} tone={k.signal.distinctIps >= 4 ? "warning" : "neutral"} />
        <Stat label="First activated" value={k.firstActivatedAt ? fmt(k.firstActivatedAt).split(",")[0] : "—"} />
        <Stat label="Expires" value={k.expiresAt ? fmt(k.expiresAt).split(",")[0] : "never"} />
      </div>

      <Panel title="Devices" description="Each computer that activated this key, with the Spotify account its user linked.">
        {k.devices.length === 0 ? (
          <p className="py-5 text-center text-[12.5px] text-foreground-muted">Not activated anywhere yet.</p>
        ) : (
          <div className="space-y-3">
            {k.devices.map((d) => (
              <div key={d.deviceId} className="rounded-[10px] border border-border-strong bg-card-elevated p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">{d.deviceName ?? "Unnamed computer"}</span>
                      {d.blocked && <Badge tone="danger">blocked</Badge>}
                      {d.appVersion && <Badge>v{d.appVersion}</Badge>}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-foreground-muted">{d.deviceId}</div>
                    <div className="mt-1 text-[11.5px] text-foreground-muted">
                      First seen {fmt(d.firstSeenAt)} · last check-in {ago(d.lastSeenAt)} · current IP{" "}
                      <span className="font-mono text-foreground-secondary">{d.lastIp ?? "—"}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant={d.blocked ? "secondary" : "danger"} onClick={() => act({ deviceId: d.deviceId, blocked: !d.blocked })}>
                      <Ban className="size-3.5" aria-hidden /> {d.blocked ? "Unblock" : "Block"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act({ deviceId: d.deviceId, release: true })} >
                      <Unlink className="size-3.5" aria-hidden /> Release slot
                    </Button>
                  </div>
                </div>

                {d.spotify && (
                  <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-accent/20 bg-accent/5 p-2.5">
                    {d.spotify.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.spotify.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-card-elevated text-[13px] font-semibold text-foreground-secondary">
                        {(d.spotify.displayName ?? d.spotify.id).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                        <Music2 className="size-3.5 text-accent" aria-hidden />
                        {d.spotify.displayName ?? d.spotify.id}
                        {d.spotify.product && <Badge tone="accent">{d.spotify.product}</Badge>}
                      </div>
                      <div className="text-[11.5px] text-foreground-muted">
                        {d.spotify.email ?? "no e-mail shared"}
                        {d.spotify.country ? ` · ${d.spotify.country}` : ""}
                        {d.spotify.followers !== null ? ` · ${d.spotify.followers} followers` : ""}
                        {` · linked ${fmt(d.spotify.linkedAt)}`}
                      </div>
                      <div className="font-mono text-[10.5px] text-foreground-muted">{d.spotify.id}</div>
                    </div>
                  </div>
                )}

                <details className="mt-2.5">
                  <summary className="cursor-pointer text-[11.5px] text-foreground-muted hover:text-foreground">
                    <Globe className="mr-1 inline size-3" aria-hidden /> IP history ({d.ips.length})
                  </summary>
                  <div className="mt-1.5 space-y-0.5">
                    {d.ips.map((e) => (
                      <div key={e.ip} className="flex justify-between gap-3 text-[11.5px]">
                        <span className="font-mono text-foreground-secondary">{e.ip}</span>
                        <span className="text-foreground-muted">{fmt(e.at)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="This key's activity" description="Every activation, check-in and refusal, newest first.">
        {data.events.length === 0 ? (
          <p className="py-5 text-center text-[12.5px] text-foreground-muted">No activity recorded.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto scrollbar-thin">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">IP</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-foreground-secondary">{fmt(e.at)}</td>
                    <td className="py-1.5 pr-3 text-foreground-secondary">{e.action}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                    <td className="py-1.5"><Badge tone={e.outcome === "ok" ? "success" : "danger"}>{e.outcome}</Badge></td>
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
