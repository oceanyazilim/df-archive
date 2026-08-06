"use client";

/** System views: UUID Directory, System Status, Settings (theme, background, connector). */

import { useCallback, useEffect, useRef, useState } from "react";
import { Music2, RefreshCw, Search, Wifi } from "lucide-react";
import { PageHead as NewPageHead } from "../shared/PageHead";
import { StatCard } from "../shared/StatCard";
import { SkeletonStatCard } from "../shared/Skeleton";
import { EmptyState as NewEmptyState } from "../shared/EmptyState";
import { StatusBadge, type StatusBadgeProps } from "../shared/StatusBadge";
import { CensoredValue } from "../shared/CensoredValue";
import { useIsAdmin } from "../providers/AdminProvider";
import { Panel } from "../shared/Card";
import { Button } from "../shared/Button";
import { GradientCustomizer } from "../GradientCustomizer";
import { queryConnectorState, startPairing, requestBridgeReconnect, queryBridgeCommandResult, ConnectorState } from "../../lib/connector";
import { Health, jget } from "../../lib/types";

type Tone = NonNullable<StatusBadgeProps["tone"]>;

// ---------------- UUID Database ----------------
export function UuidDirectoryView() {
  const [status, setStatus] = useState<{ validMappings: number; totalRecords: number; duplicateRecords: number; conflicts: number; lastLoadedAt: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ results: { uuid: string; distributor: string }[]; truncated: boolean } | null>(null);
  const isAdmin = useIsAdmin();
  useEffect(() => { jget("/api/uuid-mapping/status").then(setStatus as never).catch(() => {}); }, []);
  const search = () => fetch(`/api/uuid-mapping/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setRes);
  return (
    <div>
      <NewPageHead title="UUID Database" description="Direct lookup against the canonical licensor-UUID mapping — exact stored names, protected search." />
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {status === null ? (
          <>
            <SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard />
          </>
        ) : (
          <>
            <StatCard label="Valid records" value={status.validMappings} />
            <StatCard label="Total records" value={status.totalRecords} />
            <StatCard label="Duplicates" value={status.duplicateRecords} />
            <StatCard label="Conflicts" value={status.conflicts} tone={status.conflicts > 0 ? "danger" : "default"} />
          </>
        )}
      </div>
      <Panel title="Search">
        <div className="flex gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-sm border border-border-strong bg-input px-2.5">
            <Search className="size-3.5 shrink-0 text-foreground-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="Search UUID or distributor name"
              aria-label="Search mapping"
              className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-muted"
            />
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-foreground-muted">
          The full mapping is never loaded into the browser — search returns at most 50 rows. Last loaded {status?.lastLoadedAt ? new Date(status.lastLoadedAt).toLocaleString() : "—"}.
        </p>
        {res && (res.results.length === 0 ? <NewEmptyState title="No matches" className="mt-4" /> : (
          <div className="mt-4 divide-y divide-border-subtle">
            {res.results.map((r) => (
              <div key={r.uuid} className="flex items-center justify-between gap-3 py-2.5">
                <span className="font-medium text-foreground">{r.distributor}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge tone="success">Exact</StatusBadge>
                  <CensoredValue value={r.uuid} isAdmin={isAdmin} copyLabel="" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ---------------- API Status ----------------
const COMP_LABEL: Record<string, string> = { operational: "Operational", degraded: "Degraded", not_configured: "Not configured", plan_restricted: "Unavailable", optional: "Operational", failed: "Failed" };
const COMP_TONE: Record<string, Tone> = { operational: "success", degraded: "warning", not_configured: "neutral", plan_restricted: "warning", optional: "success", failed: "danger" };
const SAFE_COMPONENTS: [string, string][] = [
  ["Application Backend", "applicationBackend"], ["Track Metadata", "spotifyApi"], ["Streaming Analytics", "soundchartsCustomerApi"],
  ["UUID Resolver", "distributorResolver"], ["Local Data", "uuidMapping"], ["Cache", "cache"], ["Lookup History", "lookupHistory"],
];
export function SystemStatusView({ health }: { health: Health | null }) {
  return (
    <div>
      <NewPageHead title="API Status" description="Generic component availability. No provider names, endpoints, or credentials are shown." />
      <Panel>
        {!health ? (
          <p className="text-sm text-foreground-muted">Loading…</p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {SAFE_COMPONENTS.map(([label, key]) => {
              const v = health.components[key] ?? "operational";
              return (
                <div key={key} className="flex items-center justify-between py-2.5 text-[13px]">
                  <span className="text-foreground-secondary">{label}</span>
                  <StatusBadge tone={COMP_TONE[v] ?? "neutral"}>{COMP_LABEL[v] ?? "Operational"}</StatusBadge>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------- Settings ----------------
export function SettingsView({ health }: { health: Health | null }) {
  return (
    <div className="space-y-5">
      <NewPageHead title="Settings" description="Appearance, the Spotify connector, and application information." />
      <Panel title="Appearance" description="Off by default — a subtle animated backdrop, always low-opacity and never affecting readability.">
        <GradientCustomizer />
      </Panel>
      <ConnectorSettings />
      <SpotifyAccountSettings />
      <CredentialPools health={health} />
      <Panel title="Application">
        <div className="divide-y divide-border-subtle">
          <Row k="Name" v="Ocean Distro Finder" />
          <Row k="Version" v="1.0.0" />
          <div className="flex items-center justify-between py-2.5 text-[13px]">
            <span className="text-foreground-secondary">Lookup service</span>
            <StatusBadge tone={health?.primaryLookupReady ? "success" : "neutral"}>{health?.primaryLookupReady ? "Operational" : "Not configured"}</StatusBadge>
          </div>
          <Row k="Distributor records" v={`${health?.uuidMappingCount ?? "—"}`} />
        </div>
      </Panel>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-[13px]">
      <span className="text-foreground-secondary">{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}

/**
 * API credential pools.
 *
 * One row per credential slot, showing exactly enough to diagnose a problem
 * (which key, what state, how long until it frees up, what the last error was)
 * and nothing more. Client ids appear masked head-and-tail; secrets and tokens
 * are shown only as a 4-character fingerprint, never in full.
 */
function CredentialPools({ health }: { health: Health | null }) {
  const pools = health?.credentialPools;
  const wait = (ms: number) => {
    const min = Math.ceil(ms / 60000);
    return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
  };
  const ago = (iso: string | null) => {
    if (!iso) return "never";
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const until = (iso: string | null) => {
    if (!iso) return "—";
    const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    if (s <= 0) return "expired";
    return s < 3600 ? `${Math.ceil(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.ceil((s % 3600) / 60)}m`;
  };
  const stateTone: Record<string, Tone> = { available: "success", active: "success", cooling: "warning", disabled: "danger", invalid: "danger" };

  return (
    <Panel title="API Credentials">
      {!pools ? (
        <p className="text-sm text-foreground-muted">Loading…</p>
      ) : (
        Object.values(pools).map((pool) => (
          <div key={pool.provider} className="mb-5 last:mb-0">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium capitalize text-foreground">{pool.provider}</span>
              <StatusBadge tone={pool.available > 0 ? "success" : pool.total === 0 ? "neutral" : "warning"}>
                {pool.total === 0 ? "Not configured" : `${pool.available} of ${pool.total} available`}
                {pool.legacyAvailable > 0 ? ` · ${pool.legacyAvailable} legacy` : ""}
              </StatusBadge>
            </div>

            {pool.total > 0 && (
              <div className="overflow-x-auto rounded-md border border-border-strong">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-card-elevated">
                    <tr className="border-b border-border-subtle text-left text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                      <th className="px-2.5 py-2">Slot</th><th className="px-2.5 py-2">Client ID</th><th className="px-2.5 py-2">Secret</th><th className="px-2.5 py-2">Account</th>
                      <th className="px-2.5 py-2">Status</th><th className="px-2.5 py-2">Token</th><th className="px-2.5 py-2">Last used</th><th className="px-2.5 py-2">Reqs</th><th className="px-2.5 py-2">Failovers</th>
                      <th className="px-2.5 py-2">Last error</th><th className="px-2.5 py-2">Legacy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.slots.map((slot) => (
                      <tr key={slot.label} className="border-b border-border-subtle last:border-0">
                        <td className="px-2.5 py-2 text-foreground-secondary">#{slot.label}</td>
                        <td className="px-2.5 py-2 font-mono text-[11px] text-foreground-muted">{slot.fingerprint}</td>
                        <td className="px-2.5 py-2 font-mono text-[11px] text-foreground-muted">{slot.secretFingerprint}</td>
                        <td className="max-w-[130px] truncate px-2.5 py-2 text-foreground-muted" title={slot.account ?? ""}>{slot.account ?? "—"}</td>
                        <td className="px-2.5 py-2"><StatusBadge tone={stateTone[slot.state] ?? "neutral"}>{slot.state === "cooling" ? `parked · ${wait(slot.cooldownRemainingMs)}` : slot.state}</StatusBadge></td>
                        <td className="px-2.5 py-2 text-foreground-muted">{slot.tokenExpiresAt ? `expires in ${until(slot.tokenExpiresAt)}` : "—"}</td>
                        <td className="px-2.5 py-2 text-foreground-muted">{ago(slot.lastUsedAt)}</td>
                        <td className="px-2.5 py-2 text-foreground-secondary">{slot.requests}</td>
                        <td className="px-2.5 py-2 text-foreground-secondary">{slot.failovers}</td>
                        <td className="px-2.5 py-2 text-foreground-muted">{slot.lastErrorCode ?? "—"}</td>
                        <td className="px-2.5 py-2">
                          {!slot.legacy ? <span className="text-foreground-muted">n/a</span>
                            : slot.legacy.present
                              ? <StatusBadge tone="success" title={`App ID ${slot.legacy.fingerprint} · token ${slot.legacy.secretFingerprint}`}>{slot.legacy.fingerprint}</StatusBadge>
                              : <StatusBadge tone="neutral" title={slot.legacy.issue ?? ""}>{slot.legacy.issue === "not configured" ? "none" : "incomplete"}</StatusBadge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pool.issues.length > 0 && (
              <div className="mt-1.5 space-y-0.5 text-[11.5px] text-danger">
                {pool.issues.map((i) => <div key={i.slot}>Slot {i.slot}: {i.message}</div>)}
              </div>
            )}
            {pool.total > 0 && pool.available === 0 && (
              <p className="mt-1.5 text-[11.5px] text-foreground-muted">
                All {pool.provider} keys are paused. The next one frees up in about {wait(pool.recoversInMs)}.
              </p>
            )}
          </div>
        ))
      )}
      <p className="mt-1 text-[11.5px] text-foreground-muted">
        Add backup keys as numbered environment variables (<code className="font-mono">_2</code>, <code className="font-mono">_3</code>, …); the app
        rotates to the next one automatically when a key is throttled or rejected. Client ids are masked and secrets are shown
        only as their last 4 characters — full keys are never displayed, logged, or returned by the API.
      </p>
    </Panel>
  );
}

type SpotifyAccountState = {
  connected: boolean;
  needsReauth: boolean;
  profile: { id: string; displayName: string | null; avatarUrl: string | null } | null;
  connectedAt: string | null;
};

/**
 * Link the user's own Spotify account (OAuth Authorization Code + PKCE).
 * Consent happens on accounts.spotify.com in the user's browser — this panel
 * only opens the flow and reflects the backend-verified result. Tokens never
 * reach the browser.
 */
function SpotifyAccountSettings() {
  const [st, setSt] = useState<SpotifyAccountState | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const waitTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (): Promise<SpotifyAccountState | null> => {
    try {
      const r = await fetch("/api/spotify-auth/status");
      if (!r.ok) return null;
      const j = (await r.json()) as SpotifyAccountState;
      setSt(j);
      return j;
    } catch { return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { if (waitTimer.current) clearInterval(waitTimer.current); }, []);

  const connect = () => {
    setMsg(null);
    // Opens the consent page. Inside the desktop app this lands in the user's
    // default browser; in a normal browser it is just a new tab.
    window.open("/api/spotify-auth/login", "_blank", "noopener");
    setWaiting(true);
    const deadline = Date.now() + 5 * 60 * 1000;
    if (waitTimer.current) clearInterval(waitTimer.current);
    waitTimer.current = setInterval(async () => {
      const j = await refresh();
      if (j?.connected && !j.needsReauth) {
        setWaiting(false); setMsg(null);
        if (waitTimer.current) clearInterval(waitTimer.current);
      } else if (Date.now() > deadline) {
        setWaiting(false);
        setMsg("No authorization arrived — finish the Spotify page in your browser, then check again.");
        if (waitTimer.current) clearInterval(waitTimer.current);
      }
    }, 2500);
  };

  const disconnect = async () => {
    setMsg(null);
    try { await fetch("/api/spotify-auth/disconnect", { method: "POST" }); } catch { /* status refresh tells the truth */ }
    refresh();
  };

  const connected = !!st?.connected && !st?.needsReauth;

  return (
    <Panel title="Spotify Account" description="Optional — connect your own Spotify account with your explicit consent on Spotify's official page. The app never sees your password, and you can revoke access any time at spotify.com/account/apps.">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] text-foreground-secondary"><Music2 className="size-3.5" aria-hidden /> Account</span>
        {st === null ? (
          <StatusBadge tone="neutral">Checking…</StatusBadge>
        ) : connected ? (
          <StatusBadge tone="success">Connected</StatusBadge>
        ) : st.needsReauth ? (
          <StatusBadge tone="warning">Authorization expired</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not connected</StatusBadge>
        )}
      </div>

      {connected && st?.profile && (
        <div className="mt-3 flex items-center gap-3">
          {st.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={st.profile.avatarUrl} alt="" className="size-9 rounded-full border border-border-strong object-cover" />
          ) : (
            <div className="grid size-9 place-items-center rounded-full border border-border-strong bg-card-elevated text-[13px] font-semibold text-foreground-secondary">
              {(st.profile.displayName ?? st.profile.id).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">{st.profile.displayName ?? st.profile.id}</div>
            <div className="text-[11.5px] text-foreground-muted">
              Connected {st.connectedAt ? new Date(st.connectedAt).toLocaleDateString() : ""} · used automatically when no API key is available
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {connected ? (
          <Button variant="secondary" size="sm" onClick={disconnect}>Disconnect</Button>
        ) : (
          <Button variant="primary" size="sm" loading={waiting} onClick={connect}>
            {waiting ? "Waiting for Spotify…" : st?.needsReauth ? "Reconnect Spotify account" : "Connect Spotify account"}
          </Button>
        )}
        {waiting && (
          <Button variant="secondary" size="sm" onClick={() => { setWaiting(false); if (waitTimer.current) clearInterval(waitTimer.current); }}>
            Cancel
          </Button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-foreground-muted">{msg}</p>}
    </Panel>
  );
}

/**
 * Live status of the Spotify link, in three honest states:
 *   1. Connected — the desktop shell can read the running Spotify client.
 *   2. Desktop app running, Spotify not linked (closed, or auto-started
 *      without the link) — one click here queues a reconnect command that the
 *      desktop shell executes (it relaunches Spotify with the link enabled).
 *   3. Desktop app not running — nothing can capture metadata; say so.
 * The manual pairing code remains only for the browser-hosted panel.
 */
function ConnectorSettings() {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const refresh = useCallback(() => { queryConnectorState().then(setState).catch(() => setState(null)); }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const paired = state?.paired;
  const bridge = state?.bridge;
  const online = !!bridge?.debuggable;

  useEffect(() => {
    if (paired && code) { setCode(null); setMsg("Paired."); }
  }, [paired, code]);

  const generate = async () => {
    setBusy(true); setMsg(null); setCode(null);
    const r = await startPairing();
    setBusy(false);
    if (r.ok && r.code) setCode(r.code);
    else setMsg(r.error === "backend_unreachable" ? "Backend unreachable — is the app running?" : "Could not create a pairing code. Try again.");
  };

  // Queue a reconnect for the desktop shell, then watch it play out.
  const connectNow = async () => {
    setConnectBusy(true); setMsg(null);
    const id = await requestBridgeReconnect();
    if (!id) { setConnectBusy(false); setMsg("Could not reach the local server."); return; }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await queryConnectorState();
      setState(st);
      if (st.bridge.debuggable) { setConnectBusy(false); setMsg("Connected to Spotify."); return; }
      const res = await queryBridgeCommandResult(id);
      if (res.done && !res.ok) { setConnectBusy(false); setMsg(res.message || "Could not connect to Spotify."); return; }
    }
    setConnectBusy(false);
    setMsg("Timed out — try the app menu: Spotify → Connect to Spotify.");
  };

  const badge: { tone: Tone; label: string } = online
    ? { tone: "success", label: "Connected to Spotify" }
    : bridge?.desktopAlive
      ? bridge.spotifyRunning
        ? { tone: "warning", label: "Spotify running · link inactive" }
        : { tone: "warning", label: "Spotify not running" }
      : { tone: "neutral", label: "Desktop app not running" };

  return (
    <Panel title="Spotify Connection">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] text-foreground-secondary"><Wifi className="size-3.5" aria-hidden /> Status</span>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
      <p className="mt-2 text-xs text-foreground-muted">
        Lookups read the licensor identifier from your own running Spotify desktop app. Your Spotify login, tokens and cookies are never read or sent anywhere.
      </p>
      {bridge?.desktopAlive ? (
        !online && (
          <>
            <Button variant="primary" size="sm" className="mt-3" loading={connectBusy} onClick={connectNow} icon={<RefreshCw className="size-3.5" aria-hidden />}>
              {connectBusy ? "Connecting… (Spotify restarts)" : "Connect to Spotify"}
            </Button>
            <p className="mt-2 text-xs text-foreground-muted">
              {bridge.spotifyRunning
                ? "Spotify was started without the app link (usually by Windows autostart). Connecting restarts Spotify once with the link enabled."
                : "Spotify will be started with the app link enabled."}
            </p>
          </>
        )
      ) : (
        <>
          <p className="mt-2 text-xs text-foreground-muted">
            The Ocean Distro Finder desktop app is not running. Start it to enable automatic lookups — or pair a client manually below.
          </p>
          <Button variant={paired ? "secondary" : "primary"} size="sm" className="mt-3" loading={busy} onClick={generate}>
            {busy ? "Generating…" : paired ? "Re-pair" : "Generate pairing code"}
          </Button>
          {code && (
            <div className="mt-3">
              <div className="font-mono text-[22px] font-bold tracking-[0.2em] text-foreground">{code}</div>
              <p className="mt-1.5 text-xs text-foreground-muted">Enter this code in the paired client. It expires in 5 minutes.</p>
            </div>
          )}
        </>
      )}
      {msg && <p className="mt-2 text-xs text-foreground-muted">{msg}</p>}
    </Panel>
  );
}
