"use client";

/** System views: UUID Directory, System Status, Settings (theme, background, connector). */

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { PageHead, EmptyState } from "../ui";
import { PageHead as NewPageHead } from "../shared/PageHead";
import { StatCard } from "../shared/StatCard";
import { EmptyState as NewEmptyState } from "../shared/EmptyState";
import { StatusBadge } from "../shared/StatusBadge";
import { CopyButton } from "../shared/CopyButton";
import { Panel } from "../shared/Card";
import { GradientCustomizer } from "../GradientCustomizer";
import { queryConnectorState, startPairing, requestBridgeReconnect, queryBridgeCommandResult, ConnectorState } from "../../lib/connector";
import { Health, jget } from "../../lib/types";

// ---------------- UUID Database ----------------
export function UuidDirectoryView() {
  const [status, setStatus] = useState<{ validMappings: number; totalRecords: number; duplicateRecords: number; conflicts: number; lastLoadedAt: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ results: { uuid: string; distributor: string }[]; truncated: boolean } | null>(null);
  useEffect(() => { jget("/api/uuid-mapping/status").then(setStatus as never).catch(() => {}); }, []);
  const search = () => fetch(`/api/uuid-mapping/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setRes);
  return (
    <div>
      <NewPageHead title="UUID Database" description="Direct lookup against the canonical licensor-UUID mapping — exact stored names, protected search." />
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Valid records" value={status?.validMappings ?? "—"} />
        <StatCard label="Total records" value={status?.totalRecords ?? "—"} />
        <StatCard label="Duplicates" value={status?.duplicateRecords ?? "—"} />
        <StatCard label="Conflicts" value={status?.conflicts ?? "—"} tone={(status?.conflicts ?? 0) > 0 ? "danger" : "default"} />
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
                  <code className="font-mono text-[11px] text-foreground-muted">{r.uuid}</code>
                  <CopyButton value={r.uuid} label="" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ---------------- System Status ----------------
const COMP_LABEL: Record<string, string> = { operational: "Operational", degraded: "Degraded", not_configured: "Not configured", plan_restricted: "Unavailable", optional: "Operational", failed: "Failed" };
const COMP_CLS: Record<string, string> = { operational: "ok", degraded: "warn", not_configured: "muted", plan_restricted: "warn", optional: "ok", failed: "err" };
const SAFE_COMPONENTS: [string, string][] = [
  ["Application Backend", "applicationBackend"], ["Track Metadata", "spotifyApi"], ["Streaming Analytics", "soundchartsCustomerApi"],
  ["UUID Resolver", "distributorResolver"], ["Local Data", "uuidMapping"], ["Cache", "cache"], ["Lookup History", "lookupHistory"],
];
export function SystemStatusView({ health }: { health: Health | null }) {
  return (
    <>
      <PageHead title="System Status" desc="Generic component availability. No provider names, endpoints, or credentials are shown." />
      <section className="panel anim-in">
        {!health ? <div className="empty">Loading…</div> : <div>{SAFE_COMPONENTS.map(([label, key]) => { const v = health.components[key] ?? "operational"; return <div key={key} className="kv"><span className="k">{label}</span><span className={`badge ${COMP_CLS[v] ?? "muted"}`}><span className="dot" />{COMP_LABEL[v] ?? "Operational"}</span></div>; })}</div>}
      </section>
    </>
  );
}

// ---------------- Settings ----------------
export function SettingsView({ health }: { health: Health | null }) {
  return (
    <>
      <PageHead title="Settings" desc="Dashboard background, the Spotify connector, and application information." />
      <GradientCustomizer />
      <ConnectorSettings />
      <CredentialPools health={health} />
      <section className="panel anim-in">
        <h3 className="panel-title">Application</h3>
        <div className="kv"><span className="k">Name</span><span className="v">Ocean Distro Finder</span></div>
        <div className="kv"><span className="k">Version</span><span className="v">1.0.0</span></div>
        <div className="kv"><span className="k">Lookup service</span><span className={`badge ${health?.primaryLookupReady ? "ok" : "muted"}`}><span className="dot" />{health?.primaryLookupReady ? "Operational" : "Not configured"}</span></div>
        <div className="kv"><span className="k">Distributor records</span><span className="v">{health?.uuidMappingCount ?? "—"}</span></div>
      </section>
    </>
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
  const stateCls: Record<string, string> = { available: "ok", active: "ok", cooling: "warn", disabled: "err", invalid: "err" };

  return (
    <section className="panel anim-in">
      <h3 className="panel-title">API Credentials</h3>
      {!pools ? <div className="hint">Loading…</div> : Object.values(pools).map((pool) => (
        <div key={pool.provider} style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k" style={{ textTransform: "capitalize" }}>{pool.provider}</span>
            <span className={`badge ${pool.available > 0 ? "ok" : pool.total === 0 ? "muted" : "warn"}`}>
              <span className="dot" />
              {pool.total === 0 ? "Not configured" : `${pool.available} of ${pool.total} available`}
              {pool.legacyAvailable > 0 ? ` · ${pool.legacyAvailable} legacy` : ""}
            </span>
          </div>

          {pool.total > 0 && (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Slot</th><th>Client ID</th><th>Secret</th><th>Account</th>
                    <th>Status</th><th>Token</th><th>Last used</th><th>Reqs</th><th>Failovers</th>
                    <th>Last error</th><th>Legacy</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.slots.map((slot) => (
                    <tr key={slot.label}>
                      <td>#{slot.label}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{slot.fingerprint}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{slot.secretFingerprint}</td>
                      <td className="hint" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={slot.account ?? ""}>{slot.account ?? "—"}</td>
                      <td>
                        <span className={`badge ${stateCls[slot.state] ?? "muted"}`}>
                          <span className="dot" />
                          {slot.state === "cooling" ? `parked · ${wait(slot.cooldownRemainingMs)}` : slot.state}
                        </span>
                      </td>
                      <td className="hint">{slot.tokenExpiresAt ? `expires in ${until(slot.tokenExpiresAt)}` : "—"}</td>
                      <td className="hint">{ago(slot.lastUsedAt)}</td>
                      <td>{slot.requests}</td>
                      <td>{slot.failovers}</td>
                      <td className="hint">{slot.lastErrorCode ?? "—"}</td>
                      <td>
                        {!slot.legacy ? <span className="hint">n/a</span>
                          : slot.legacy.present
                            ? <span className="badge ok" title={`App ID ${slot.legacy.fingerprint} · token ${slot.legacy.secretFingerprint}`}><span className="dot" />{slot.legacy.fingerprint}</span>
                            : <span className="badge muted" title={slot.legacy.issue ?? ""}><span className="dot" />{slot.legacy.issue === "not configured" ? "none" : "incomplete"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pool.issues.length > 0 && (
            <div className="hint" style={{ marginTop: 6, color: "var(--danger)" }}>
              {pool.issues.map((i) => <div key={i.slot}>Slot {i.slot}: {i.message}</div>)}
            </div>
          )}
          {pool.total > 0 && pool.available === 0 && (
            <div className="hint" style={{ marginTop: 6 }}>
              All {pool.provider} keys are paused. The next one frees up in about {wait(pool.recoversInMs)}.
            </div>
          )}
        </div>
      ))}
      <p className="hint" style={{ marginTop: 4 }}>
        Add backup keys as numbered environment variables (<span className="mono">_2</span>, <span className="mono">_3</span>, …); the app
        rotates to the next one automatically when a key is throttled or rejected. Client ids are masked and secrets are shown
        only as their last 4 characters — full keys are never displayed, logged, or returned by the API.
      </p>
    </section>
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

  const badge = online
    ? { cls: "ok", label: "Connected to Spotify" }
    : bridge?.desktopAlive
      ? bridge.spotifyRunning
        ? { cls: "warn", label: "Spotify running · link inactive" }
        : { cls: "warn", label: "Spotify not running" }
      : { cls: "muted", label: "Desktop app not running" };

  return (
    <section className="panel anim-in">
      <h3 className="panel-title">Spotify Connection</h3>
      <div className="kv"><span className="k">Status</span><span className={`badge ${badge.cls}`}><span className="dot" />{badge.label}</span></div>
      <p className="hint" style={{ marginTop: 8 }}>
        Lookups read the licensor identifier from your own running Spotify desktop app. Your Spotify login, tokens and cookies are never read or sent anywhere.
      </p>
      {bridge?.desktopAlive ? (
        !online && (
          <>
            <button className="btn primary btn-sm" style={{ marginTop: 10 }} disabled={connectBusy} onClick={connectNow}>
              {connectBusy ? "Connecting… (Spotify restarts)" : "Connect to Spotify"}
            </button>
            <div className="hint" style={{ marginTop: 8, color: "var(--text-muted)" }}>
              {bridge.spotifyRunning
                ? "Spotify was started without the app link (usually by Windows autostart). Connecting restarts Spotify once with the link enabled."
                : "Spotify will be started with the app link enabled."}
            </div>
          </>
        )
      ) : (
        <>
          <div className="hint" style={{ marginTop: 8, color: "var(--text-muted)" }}>
            The Ocean Distro Finder desktop app is not running. Start it to enable automatic lookups — or pair a client manually below.
          </div>
          <button className={`btn ${paired ? "" : "primary"} btn-sm`} style={{ marginTop: 10 }} disabled={busy} onClick={generate}>
            {busy ? "Generating…" : paired ? "Re-pair" : "Generate pairing code"}
          </button>
          {code && (
            <div style={{ marginTop: 10 }}>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>{code}</div>
              <div className="hint" style={{ marginTop: 6 }}>Enter this code in the paired client. It expires in 5 minutes.</div>
            </div>
          )}
        </>
      )}
      {msg && <div className="hint" style={{ marginTop: 8 }}>{msg}</div>}
    </section>
  );
}
