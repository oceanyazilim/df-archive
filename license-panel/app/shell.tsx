"use client";

/** App shell: brand, navigation, sign-out — plus the login gate, so no page
 *  ever renders license data to a signed-out browser. */

import { useState } from "react";
import type { ReactNode } from "react";
import { Activity, KeyRound, LayoutDashboard, LogOut } from "lucide-react";
import { Button, api, useSession } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/keys", label: "Keys", icon: KeyRound },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function Shell({ children, active }: { children: ReactNode; active: string }) {
  const session = useSession();

  if (session.loading) {
    return <div className="grid min-h-screen place-items-center text-[13px] text-foreground-muted">Loading…</div>;
  }
  if (!session.configured) return <NotConfigured missing={session.missing} />;
  if (!session.signedIn) return <Login onDone={session.refresh} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border-strong bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-6 px-5">
          <a href="/" className="flex items-center gap-2.5">
            <span className="vr-mark">VR</span>
            <span>
              <span className="block text-[13.5px] font-semibold leading-4">Virus Records</span>
              <span className="block text-[10.5px] text-foreground-muted">License panel</span>
            </span>
          </a>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const isActive = active === n.href;
              return (
                <a
                  key={n.href}
                  href={n.href}
                  className={`flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] ${
                    isActive ? "bg-accent-dim text-accent" : "text-foreground-secondary hover:bg-card-hover hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" aria-hidden /> {n.label}
                </a>
              );
            })}
          </nav>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { api("/api/admin/session", { method: "DELETE" }).finally(() => window.location.reload()); }}
          >
            <LogOut className="size-3.5" aria-hidden /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-5 py-6">{children}</main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="vr-mark">VR</span>
          <div>
            <div className="text-[15px] font-semibold">Virus Records</div>
            <div className="text-[11.5px] text-foreground-muted">License panel</div>
          </div>
        </div>
        <div className="rounded-[10px] border border-border-strong bg-card p-5">
          <label className="mb-1.5 block text-[12px] text-foreground-secondary" htmlFor="pw">Panel password</label>
          <input
            id="pw"
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="••••••••"
          />
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <Button variant="primary" className="mt-4 w-full" disabled={busy || !password} onClick={submit}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
        <p className="mt-3 text-center text-[11px] text-foreground-muted">
          Only the administrator issues keys. Nothing here is public.
        </p>
      </div>
    </div>
  );
}

function NotConfigured({ missing }: { missing: string[] }) {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-[460px] rounded-[10px] border border-warning/30 bg-warning/5 p-5">
        <h1 className="text-[14px] font-semibold text-foreground">Finish the deployment first</h1>
        <p className="mt-2 text-[12.5px] text-foreground-secondary">
          The panel is running but these environment variables are missing:
        </p>
        <ul className="mt-2 space-y-1">
          {missing.map((m) => (
            <li key={m} className="font-mono text-[12px] text-warning">{m}</li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-foreground-muted">
          Set them in Dokploy (Environment), then redeploy. <span className="font-mono">PANEL_SECRET</span> must be at least
          16 characters — it signs the admin session cookie.
        </p>
      </div>
    </div>
  );
}
