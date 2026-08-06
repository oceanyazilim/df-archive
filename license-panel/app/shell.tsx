"use client";

/**
 * App shell — the same anatomy as the desktop app: fixed sidebar with the
 * brand mark and grouped navigation, a sticky top bar, then the page body.
 *
 * It also owns the login gate: no page renders license data to a signed-out
 * browser, and the sign-in screen is the only thing an unauthenticated visitor
 * can ever see.
 */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Activity, KeyRound, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { Badge, Button, api, useClock } from "./ui";

type NavItem = { href: string; label: string; icon: typeof KeyRound; hint?: string };
type NavGroup = { section: string; items: NavItem[] };

/** Grouped so new sections (users, releases, billing…) drop in without a redesign. */
const NAV: NavGroup[] = [
  {
    section: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Licensing",
    items: [
      { href: "/keys", label: "Keys", icon: KeyRound },
      { href: "/activity", label: "Activity", icon: Activity },
    ],
  },
];

export function Shell({ children, active }: { children: ReactNode; active: string }) {
  const session = useSession();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("vr:sidebar-collapsed") === "1"); } catch { /* ignore */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem("vr:sidebar-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  if (session.loading) {
    return <div className="grid min-h-screen place-items-center text-[13px] text-foreground-muted">Loading…</div>;
  }
  if (!session.configured) return <NotConfigured missing={session.missing} />;
  if (!session.signedIn) return <Login onDone={session.refresh} />;

  return (
    <div className="min-h-screen">
      <aside
        className="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border-subtle bg-sidebar transition-[width] duration-[220ms] ease-out"
        style={{ width: collapsed ? 76 : 248 }}
      >
        <a href="/" className={`flex items-center ${collapsed ? "justify-center px-0" : "px-4"} pb-3 pt-5`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/virus-logo.png"
            alt="Virus Records"
            style={{ height: collapsed ? 30 : 40, width: "auto" }}
            className="block object-contain transition-[filter] duration-[120ms] ease-out hover:brightness-110"
          />
        </a>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mx-3 mb-2 flex min-h-9 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-medium text-foreground-muted transition-colors hover:bg-card-hover hover:text-foreground-secondary ${collapsed ? "mx-auto justify-center px-1.5" : ""}`}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <><PanelLeftClose className="size-4" aria-hidden /> Collapse</>}
        </button>

        <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-2 scrollbar-thin">
          {NAV.map((group) => (
            <div key={group.section}>
              {!collapsed && (
                <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground-muted">
                  {group.section}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`flex min-h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors ${
                        isActive ? "bg-accent-dim text-foreground" : "text-foreground-secondary hover:bg-card-hover hover:text-foreground"
                      } ${collapsed ? "justify-center px-1.5" : ""}`}
                    >
                      <Icon className={`size-4 shrink-0 ${isActive ? "text-accent" : ""}`} aria-hidden />
                      {!collapsed && item.label}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={`border-t border-border-subtle px-3 py-3 ${collapsed ? "px-2" : ""}`}>
          {collapsed ? (
            <div className="grid place-items-center" title="Signed in as administrator">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[12px] text-foreground-secondary">
                <ShieldCheck className="size-3.5 text-accent" aria-hidden /> Administrator
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1.5 w-full justify-start px-1.5"
                onClick={() => { api("/api/admin/session", { method: "DELETE" }).finally(() => window.location.reload()); }}
              >
                <LogOut className="size-3.5" aria-hidden /> Sign out
              </Button>
            </>
          )}
        </div>
      </aside>

      <div className="transition-[margin] duration-[220ms] ease-out" style={{ marginLeft: collapsed ? 76 : 248 }}>
        <TopBar />
        <main className="mx-auto max-w-[1240px] px-6 pb-16 pt-6">{children}</main>
      </div>
    </div>
  );
}

/** The bar carries context the page heading does not repeat: which product
 *  this is, the local clock (activation timestamps are read against it) and
 *  whether the service is answering. */
function TopBar() {
  const clock = useClock();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-subtle bg-[color:var(--header)] px-6 backdrop-blur">
      <span className="text-[12.5px] font-semibold uppercase tracking-[0.16em] text-foreground-secondary">Virus Records</span>
      <span className="text-[11.5px] text-foreground-muted">License panel</span>
      <div className="flex-1" />
      <span className="hidden text-[11.5px] tabular-nums text-foreground-muted sm:block">{clock}</span>
      <Badge tone="success" dot>Online</Badge>
    </header>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true); setError(null);
    try {
      await api("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(55% 40% at 50% 0%, var(--accent-dim), transparent 70%)" }} />
      <div className="relative w-full max-w-[380px] anim-in">
        <div className="mb-7 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/virus-logo.png" alt="Virus Records" style={{ height: 56, width: "auto" }} className="block object-contain" />
        </div>
        <div className="rounded-[14px] border border-border-strong bg-card p-5">
          <h1 className="text-[15px] font-semibold text-foreground">License panel</h1>
          <p className="mt-1 text-[12.5px] text-foreground-secondary">
            Keys are issued here and nowhere else. Sign in to continue.
          </p>
          <label className="mt-4 block text-[11.5px] text-foreground-secondary" htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            autoFocus
            className="mt-1.5"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="••••••••"
          />
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <Button variant="primary" className="mt-4 w-full" loading={busy} disabled={!password} onClick={submit}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
        <p className="mt-3 text-center text-[11px] text-foreground-muted">
          Every activation is logged with its IP address and time.
        </p>
      </div>
    </div>
  );
}

function NotConfigured({ missing }: { missing: string[] }) {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-[470px] rounded-[14px] border border-warning/30 bg-warning/5 p-5">
        <h1 className="text-[14px] font-semibold text-foreground">Finish the deployment first</h1>
        <p className="mt-2 text-[12.5px] text-foreground-secondary">
          The panel is running but these environment variables are missing:
        </p>
        <ul className="mt-2 space-y-1">
          {missing.map((m) => <li key={m} className="font-mono text-[12px] text-warning">{m}</li>)}
        </ul>
        <p className="mt-3 text-[12px] text-foreground-muted">
          Set them in Dokploy (Environment), then redeploy. <span className="font-mono">PANEL_SECRET</span> must be at
          least 16 characters — it signs the admin session cookie.
        </p>
      </div>
    </div>
  );
}

function useSession() {
  const [state, setState] = useState<{ loading: boolean; signedIn: boolean; configured: boolean; missing: string[] }>({
    loading: true, signedIn: false, configured: true, missing: [],
  });
  const refresh = useCallback(async () => {
    try {
      const s = await api<{ signedIn: boolean; configured: boolean; missing: string[] }>("/api/admin/session");
      setState({ loading: false, signedIn: s.signedIn, configured: s.configured, missing: s.missing });
    } catch {
      setState({ loading: false, signedIn: false, configured: true, missing: [] });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, refresh };
}
