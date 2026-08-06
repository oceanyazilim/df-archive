"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Ban, Globe, Laptop, Music2, Trash2, Unlink } from "lucide-react";
import { Shell } from "../../shell";
import { ACTION_LABEL, Badge, Button, Card, CopyButton, EmptyState, OutcomeBadge, PageHead, Panel, Skeleton, StatCard, Table, ago, api, daysLeft, fmt, fmtDay, type Tone } from "../../ui";

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
    api<{ key: KeyDetail; events: EventRow[] }>(`/api/admin/keys/${keyId}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [keyId]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    await api(`/api/admin/keys/${keyId}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
    load();
  };

  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  if (!data) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const k = data.key;
  const left = daysLeft(k.expiresAt);

  return (
    <div>
      <a href="/keys" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-foreground-muted transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All keys
      </a>

      <PageHead
        title={k.key}
        description={
          (k.type === "single" ? "Single use — one computer, forever"
            : k.type === "duration" ? `Timed — ${k.durationDays} days from first activation`
            : "Unlimited — never expires") +
          (k.deviceLimit > 0 ? ` · up to ${k.deviceLimit} computer${k.deviceLimit > 1 ? "s" : ""}` : " · unlimited computers") +
          (k.note ? ` · ${k.note}` : "")
        }
        actions={
          <>
            <CopyButton value={k.key} label="Copy key" />
            <Button variant={k.revokedAt ? "secondary" : "danger"} onClick={() => act({ revoked: !k.revokedAt })}>
              <Ban className="size-3.5" aria-hidden /> {k.revokedAt ? "Restore" : "Revoke"}
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                if (!window.confirm(`Delete ${k.key}? Every computer using it stops working at its next check-in.`)) return;
                await api(`/api/admin/keys/${keyId}`, { method: "DELETE" }).catch(() => {});
                window.location.href = "/keys";
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </>
        }
      />

      <div className="anim-in mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[k.status]} dot>{k.status}</Badge>
        {k.revokedAt && <span className="text-[12px] text-foreground-muted">Revoked {fmt(k.revokedAt)}</span>}
      </div>

      {k.signal.suspicious && (
        <div className="anim-in mb-4 flex items-start gap-2.5 rounded-[14px] border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-foreground-secondary">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            This key answers from <b className="text-foreground">{k.signal.devices} computer{k.signal.devices > 1 ? "s" : ""}</b> and{" "}
            <b className="text-foreground">{k.signal.distinctIps} different IP addresses</b> — the pattern of a shared key.
            Block the computers you do not recognise, or revoke the key entirely.
          </div>
        </div>
      )}

      <div className="anim-in anim-in-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Computers" value={`${k.devices.length}${k.deviceLimit > 0 ? ` / ${k.deviceLimit}` : ""}`} icon={<Laptop className="size-4" aria-hidden />} />
        <StatCard label="Distinct IPs" value={k.signal.distinctIps} tone={k.signal.distinctIps >= 4 ? "warning" : "neutral"} icon={<Globe className="size-4" aria-hidden />} />
        <StatCard label="First activated" value={k.firstActivatedAt ? fmtDay(k.firstActivatedAt) : "—"} sub={k.firstActivatedAt ? ago(k.firstActivatedAt) : "never used"} />
        <StatCard label="Expires" value={k.expiresAt ? fmtDay(k.expiresAt) : "never"} tone={left !== null && left <= 3 ? "warning" : "neutral"} sub={left !== null ? (left > 0 ? `${left} days left` : "expired") : undefined} />
      </div>

      <Panel className="anim-in anim-in-2 mt-5" title="Computers" description="Every machine that activated this key, with the Spotify account its user linked.">
        {k.devices.length === 0 ? (
          <EmptyState icon={<Laptop className="size-6" aria-hidden />} title="Not activated anywhere yet" description="Send the key to its owner; it appears here the moment they activate." />
        ) : (
          <div className="space-y-3">
            {k.devices.map((d) => (
              <Card key={d.deviceId} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Laptop className="size-4 text-foreground-muted" aria-hidden />
                      <span className="text-[13.5px] font-medium text-foreground">{d.deviceName ?? "Unnamed computer"}</span>
                      {d.blocked && <Badge tone="danger">blocked</Badge>}
                      {d.appVersion && <Badge>v{d.appVersion}</Badge>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-foreground-muted">
                      First seen {fmt(d.firstSeenAt)} · last check-in {ago(d.lastSeenAt)} · current IP{" "}
                      <span className="font-mono text-foreground-secondary">{d.lastIp ?? "—"}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-foreground-muted">{d.deviceId}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant={d.blocked ? "secondary" : "danger"} onClick={() => act({ deviceId: d.deviceId, blocked: !d.blocked })}>
                      <Ban className="size-3.5" aria-hidden /> {d.blocked ? "Unblock" : "Block"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Free this seat so the key can be used on a different computer"
                      onClick={() => {
                        if (!window.confirm("Free this seat? The key becomes usable on another computer.")) return;
                        act({ deviceId: d.deviceId, release: true });
                      }}
                    >
                      <Unlink className="size-3.5" aria-hidden /> Release
                    </Button>
                  </div>
                </div>

                {d.spotify && (
                  <div className="mt-3 flex items-center gap-3 rounded-[10px] border border-violet/25 bg-violet/5 p-3">
                    {d.spotify.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.spotify.avatarUrl} alt="" className="size-11 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-card-elevated text-[15px] font-semibold text-foreground-secondary">
                        {(d.spotify.displayName ?? d.spotify.id).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-foreground">
                        <Music2 className="size-3.5 text-violet" aria-hidden />
                        {d.spotify.displayName ?? d.spotify.id}
                        {d.spotify.product && <Badge tone={d.spotify.product === "premium" ? "success" : "neutral"}>{d.spotify.product}</Badge>}
                        {d.spotify.country && <Badge>{d.spotify.country}</Badge>}
                      </div>
                      <div className="text-[11.5px] text-foreground-muted">
                        {d.spotify.email ?? "no e-mail shared"}
                        {d.spotify.followers !== null ? ` · ${d.spotify.followers} followers` : ""}
                        {` · linked ${fmt(d.spotify.linkedAt)}`}
                      </div>
                      <div className="font-mono text-[10.5px] text-foreground-muted">{d.spotify.id}</div>
                    </div>
                    <a
                      href={`https://open.spotify.com/user/${encodeURIComponent(d.spotify.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[12px] text-accent hover:underline"
                    >
                      Open
                    </a>
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-[11.5px] text-foreground-muted transition-colors hover:text-foreground">
                    <Globe className="mr-1 inline size-3" aria-hidden /> IP history ({d.ips.length})
                  </summary>
                  <div className="mt-2 space-y-1 rounded-[7px] border border-border-subtle bg-card-elevated p-2.5">
                    {d.ips.map((e) => (
                      <div key={e.ip} className="flex justify-between gap-3 text-[11.5px]">
                        <span className="font-mono text-foreground-secondary">{e.ip}</span>
                        <span className="text-foreground-muted">{fmt(e.at)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </Card>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="anim-in anim-in-3 mt-5" title="This key's activity" description="Every activation, check-in and refusal, newest first.">
        {data.events.length === 0 ? (
          <EmptyState title="No activity recorded" />
        ) : (
          <div className="max-h-[440px] overflow-auto scrollbar-thin">
            <Table head={["Time", "Event", "IP address", "Result", "Detail"]}>
              {data.events.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-b border-border-subtle last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 text-foreground-secondary">{fmt(e.at)}</td>
                  <td className="py-2 pr-3 text-foreground-secondary">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="py-2 pr-3 font-mono text-[11.5px] text-foreground-muted">{e.ip ?? "—"}</td>
                  <td className="py-2 pr-3"><OutcomeBadge outcome={e.outcome} /></td>
                  <td className="max-w-[220px] truncate py-2 text-foreground-muted" title={e.detail ?? ""}>{e.detail ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
