"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Shell } from "../shell";
import { Badge, Button, CopyButton, Panel, ago, api, fmt, type Tone } from "../ui";

type KeyRow = {
  id: string; key: string; type: "single" | "duration" | "unlimited";
  durationDays: number | null; deviceLimit: number; note: string | null;
  createdAt: string; firstActivatedAt: string | null; expiresAt: string | null;
  status: "active" | "unused" | "expired" | "revoked";
  devices: number; lastSeenAt: string | null; spotifyAccounts: string[];
  signal: { distinctIps: number; devices: number; suspicious: boolean };
};

const STATUS_TONE: Record<KeyRow["status"], Tone> = {
  active: "success", unused: "neutral", expired: "warning", revoked: "danger",
};

const TYPE_LABEL: Record<KeyRow["type"], string> = {
  single: "Single use", duration: "Timed", unlimited: "Unlimited",
};

export default function KeysPage() {
  return (
    <Shell active="/keys">
      <Keys />
    </Shell>
  );
}

function Keys() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | KeyRow["status"]>("all");

  const load = useCallback(() => {
    api<{ keys: KeyRow[] }>("/api/admin/keys").then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = (keys ?? []).filter((k) => filter === "all" || k.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Keys</h1>
          <p className="mt-0.5 text-[12.5px] text-foreground-muted">
            Only you issue these. A key unlocks the desktop app on the machine that activates it.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-3.5" aria-hidden /> New key
        </Button>
      </div>

      {creating && <CreateForm onCreated={(made) => { setJustCreated(made); setCreating(false); load(); }} />}

      {justCreated.length > 0 && (
        <Panel title={`${justCreated.length} key${justCreated.length > 1 ? "s" : ""} created`} description="Copy them now — this list disappears when you leave the page (the keys stay in the table below).">
          <div className="space-y-1.5">
            {justCreated.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 rounded-[7px] border border-accent/25 bg-accent/5 px-3 py-2">
                <code className="font-mono text-[13px] tracking-wide text-accent">{k}</code>
                <CopyButton value={k} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "active", "unused", "expired", "revoked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-7 rounded-[7px] border px-2.5 text-[12px] capitalize ${
              filter === f ? "border-accent/40 bg-accent-dim text-accent" : "border-border-strong bg-card text-foreground-secondary hover:bg-card-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Panel>
        {keys === null ? (
          <p className="py-6 text-center text-[12.5px] text-foreground-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-foreground-muted">No keys here yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[10.5px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Devices</th>
                  <th className="py-2 pr-3 font-medium">IPs</th>
                  <th className="py-2 pr-3 font-medium">Spotify</th>
                  <th className="py-2 pr-3 font-medium">Expires</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((k) => (
                  <tr key={k.id} className="border-b border-border-subtle last:border-0 hover:bg-card-hover">
                    <td className="py-2.5 pr-3">
                      <a href={`/keys/${k.id}`} className="font-mono text-[12.5px] tracking-wide text-foreground hover:text-accent hover:underline">
                        {k.key}
                      </a>
                      {k.signal.suspicious && (
                        <span title="More devices or IPs than expected — possible sharing" className="ml-2 inline-flex align-middle text-warning">
                          <AlertTriangle className="size-3.5" aria-hidden />
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-foreground-secondary">
                      {TYPE_LABEL[k.type]}{k.type === "duration" && k.durationDays ? ` · ${k.durationDays}d` : ""}
                    </td>
                    <td className="py-2.5 pr-3"><Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge></td>
                    <td className="py-2.5 pr-3 tabular-nums text-foreground-secondary">
                      {k.devices}{k.deviceLimit > 0 ? ` / ${k.deviceLimit}` : " / ∞"}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-foreground-secondary">{k.signal.distinctIps}</td>
                    <td className="max-w-[160px] truncate py-2.5 pr-3 text-foreground-muted" title={k.spotifyAccounts.join(", ")}>
                      {k.spotifyAccounts.length ? k.spotifyAccounts.join(", ") : "—"}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-foreground-muted" title={fmt(k.expiresAt)}>
                      {k.expiresAt ? fmt(k.expiresAt).split(",")[0] : "never"}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-foreground-muted" title={fmt(k.lastSeenAt)}>{ago(k.lastSeenAt)}</td>
                    <td className="max-w-[180px] truncate py-2.5 text-foreground-muted" title={k.note ?? ""}>{k.note ?? "—"}</td>
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

function CreateForm({ onCreated }: { onCreated: (keys: string[]) => void }) {
  const [type, setType] = useState<KeyRow["type"]>("duration");
  const [durationDays, setDurationDays] = useState(30);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ keys: { key: string }[] }>("/api/admin/keys", {
        method: "POST",
        body: JSON.stringify({ type, durationDays, deviceLimit, count, note }),
      });
      onCreated(r.keys.map((k) => k.key));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Issue keys" description="A timed key starts counting from its first activation, not from now.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-foreground-secondary">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as KeyRow["type"])}>
            <option value="single">Single use — one computer, forever</option>
            <option value="duration">Timed — expires after N days</option>
            <option value="unlimited">Unlimited — never expires</option>
          </select>
        </label>
        {type === "duration" && (
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-foreground-secondary">Days</span>
            <input type="number" min={1} max={3650} value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value) || 30)} />
          </label>
        )}
        {type !== "single" && (
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-foreground-secondary">Device limit (0 = unlimited)</span>
            <input type="number" min={0} max={100} value={deviceLimit} onChange={(e) => setDeviceLimit(Number(e.target.value) || 0)} />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-foreground-secondary">How many</span>
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11.5px] text-foreground-secondary">Note (who is this for?)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Deniz — 30 günlük deneme" />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3">
        <Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </Panel>
  );
}
