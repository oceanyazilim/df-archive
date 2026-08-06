"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Globe, Infinity as InfinityIcon, KeyRound, Laptop, Plus, Search, Timer, UserRound } from "lucide-react";
import { Shell } from "../shell";
import { Badge, Button, Card, EmptyState, PageHead, Panel, Skeleton, Table, ago, api, daysLeft, fmtDay, type Tone } from "../ui";

type KeyType = "single" | "duration" | "unlimited";
type KeyRow = {
  id: string; key: string; type: KeyType;
  durationDays: number | null; deviceLimit: number; note: string | null;
  createdAt: string; firstActivatedAt: string | null; expiresAt: string | null;
  status: "active" | "unused" | "expired" | "revoked";
  devices: number; lastSeenAt: string | null; spotifyAccounts: string[];
  signal: { distinctIps: number; devices: number; suspicious: boolean };
};

const STATUS_TONE: Record<KeyRow["status"], Tone> = { active: "success", unused: "neutral", expired: "warning", revoked: "danger" };
const TYPE_META: Record<KeyType, { label: string; icon: typeof KeyRound; tone: Tone }> = {
  single: { label: "Single use", icon: UserRound, tone: "violet" },
  duration: { label: "Timed", icon: Timer, tone: "accent" },
  unlimited: { label: "Unlimited", icon: InfinityIcon, tone: "neutral" },
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
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    api<{ keys: KeyRow[] }>("/api/admin/keys").then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: keys?.length ?? 0, active: 0, unused: 0, expired: 0, revoked: 0 };
    for (const k of keys ?? []) c[k.status]++;
    return c;
  }, [keys]);

  const q = query.trim().toLowerCase();
  const shown = (keys ?? []).filter((k) =>
    (filter === "all" || k.status === filter) &&
    (!q || [k.key, k.note, ...k.spotifyAccounts].some((v) => v?.toLowerCase().includes(q)))
  );

  return (
    <div>
      <PageHead
        title="Keys"
        description="Only you issue these. One key unlocks the desktop app on the computer that activates it."
        actions={
          <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating((v) => !v)}>
            <Plus className="size-3.5" aria-hidden /> {creating ? "Close" : "New key"}
          </Button>
        }
      />

      {creating && <CreateForm onCreated={(made) => { setJustCreated(made); setCreating(false); load(); }} />}

      {justCreated.length > 0 && (
        <Panel
          className="anim-in mb-4 border-accent/30"
          title={`${justCreated.length} key${justCreated.length > 1 ? "s" : ""} ready`}
          description="Send these to the people who will use them. They stay in the table below."
          actions={<Button size="sm" variant="ghost" onClick={() => setJustCreated([])}>Dismiss</Button>}
        >
          <div className="space-y-1.5">
            {justCreated.map((k) => <KeyLine key={k} value={k} />)}
          </div>
        </Panel>
      )}

      <div className="anim-in mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-[7px] border border-border-strong bg-input px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search key, note or Spotify account…"
            className="h-full w-full border-0 bg-transparent p-0 text-[13px] outline-none focus:shadow-none"
          />
        </div>
        {(["all", "active", "unused", "expired", "revoked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex h-9 items-center gap-1.5 rounded-[7px] border px-3 text-[12.5px] capitalize transition-colors ${
              filter === f ? "border-accent/40 bg-accent-dim text-foreground" : "border-border-strong bg-card text-foreground-secondary hover:bg-card-hover"
            }`}
          >
            {f}
            <span className="tabular-nums text-foreground-muted">{counts[f]}</span>
          </button>
        ))}
      </div>

      <Panel className="anim-in anim-in-1">
        {keys === null ? (
          <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="size-6" aria-hidden />}
            title={keys.length === 0 ? "No keys yet" : "Nothing matches"}
            description={keys.length === 0 ? "Create your first key with the button above." : "Try a different search or filter."}
          />
        ) : (
          <Table head={["Key", "Type", "Status", "Computers", "IPs", "Spotify", "Expires", "Last seen", "Note"]}>
            {shown.map((k) => {
              const meta = TYPE_META[k.type];
              const TypeIcon = meta.icon;
              const left = daysLeft(k.expiresAt);
              return (
                <tr key={k.id} className="group border-b border-border-subtle last:border-0 hover:bg-card-hover">
                  <td className="py-3 pr-3">
                    <a href={`/keys/${k.id}`} className="flex items-center gap-2 font-mono text-[13px] tracking-wide text-foreground hover:text-accent">
                      {k.key}
                      {k.signal.suspicious && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Possible sharing" />}
                    </a>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge tone={meta.tone}><TypeIcon className="size-3" aria-hidden /> {meta.label}{k.type === "duration" && k.durationDays ? ` ${k.durationDays}d` : ""}</Badge>
                  </td>
                  <td className="py-3 pr-3"><Badge tone={STATUS_TONE[k.status]} dot>{k.status}</Badge></td>
                  <td className="py-3 pr-3 tabular-nums text-foreground-secondary">
                    <span className="inline-flex items-center gap-1.5"><Laptop className="size-3 text-foreground-muted" aria-hidden />{k.devices}{k.deviceLimit > 0 ? ` / ${k.deviceLimit}` : " / ∞"}</span>
                  </td>
                  <td className="py-3 pr-3 tabular-nums text-foreground-secondary">
                    <span className={`inline-flex items-center gap-1.5 ${k.signal.distinctIps >= 4 ? "text-warning" : ""}`}>
                      <Globe className="size-3 text-foreground-muted" aria-hidden />{k.signal.distinctIps}
                    </span>
                  </td>
                  <td className="max-w-[150px] truncate py-3 pr-3 text-foreground-muted" title={k.spotifyAccounts.join(", ")}>
                    {k.spotifyAccounts.length ? k.spotifyAccounts.join(", ") : "—"}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-foreground-muted">
                    {k.expiresAt ? (
                      <span className={left !== null && left <= 3 ? "text-warning" : ""}>{fmtDay(k.expiresAt)}{left !== null && left > 0 ? ` · ${left}d` : ""}</span>
                    ) : "never"}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-foreground-muted">{ago(k.lastSeenAt)}</td>
                  <td className="max-w-[160px] truncate py-3 text-foreground-muted" title={k.note ?? ""}>{k.note ?? "—"}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}

function KeyLine({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-accent/25 bg-accent/5 px-3.5 py-2.5">
      <code className="font-mono text-[15px] tracking-[0.08em] text-accent">{value}</code>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}
      >
        {copied ? <><Check className="size-3.5" aria-hidden /> Copied</> : <><Copy className="size-3.5" aria-hidden /> Copy</>}
      </Button>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (keys: string[]) => void }) {
  const [type, setType] = useState<KeyType>("duration");
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
    <Panel className="anim-in mb-4" title="Issue keys" description="A timed key starts counting at its first activation — an unused key never burns its days.">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {(Object.keys(TYPE_META) as KeyType[]).map((t) => {
          const meta = TYPE_META[t];
          const Icon = meta.icon;
          const selected = type === t;
          return (
            <button key={t} onClick={() => setType(t)} className="text-left">
              <Card hoverable className={`h-full p-3.5 ${selected ? "border-accent/50 bg-accent/5" : ""}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`size-4 ${selected ? "text-accent" : "text-foreground-muted"}`} aria-hidden />
                  <span className="text-[13px] font-medium text-foreground">{meta.label}</span>
                  {selected && <Check className="ml-auto size-3.5 text-accent" aria-hidden />}
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-muted">
                  {t === "single" ? "One computer, forever. A second machine is refused."
                    : t === "duration" ? "Expires N days after it is first activated."
                    : "Never expires. Set how many computers may use it."}
                </p>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {type === "duration" && (
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-foreground-secondary">Valid for (days)</span>
            <input type="number" min={1} max={3650} value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value) || 30)} />
          </label>
        )}
        {type !== "single" && (
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-foreground-secondary">Computers allowed (0 = unlimited)</span>
            <input type="number" min={0} max={100} value={deviceLimit} onChange={(e) => setDeviceLimit(Number(e.target.value) || 0)} />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-foreground-secondary">How many keys</span>
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11.5px] text-foreground-secondary">Note — who is this for?</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Deniz — 30 günlük deneme" />
        </label>
      </div>

      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" loading={busy} onClick={submit}>Create {count > 1 ? `${count} keys` : "key"}</Button>
        <span className="text-[11.5px] text-foreground-muted">
          {type === "single" ? "Locked to the first computer that activates it."
            : type === "duration" ? `${durationDays} days from first activation · ${deviceLimit === 0 ? "unlimited" : deviceLimit} computer${deviceLimit === 1 ? "" : "s"}.`
            : `Never expires · ${deviceLimit === 0 ? "unlimited" : deviceLimit} computer${deviceLimit === 1 ? "" : "s"}.`}
        </span>
      </div>
    </Panel>
  );
}
