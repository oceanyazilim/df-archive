"use client";

/** Small shared UI kit for the panel — kept in one file so the whole admin
 *  surface stays consistent without pulling in a component library. */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border-strong bg-card-elevated text-foreground-secondary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  accent: "border-accent/30 bg-accent/10 text-accent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = "secondary", size = "md", disabled, type = "button", className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-[7px] border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = size === "sm" ? "h-8 px-3 text-[12px]" : "h-9 px-4 text-[13px]";
  const variants = {
    primary: "border-transparent bg-accent text-[color:var(--on-accent)] hover:bg-accent-hover",
    secondary: "border-border-strong bg-card text-foreground hover:bg-card-hover",
    danger: "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    ghost: "border-transparent bg-transparent text-foreground-secondary hover:bg-card-hover hover:text-foreground",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes} ${variants} ${className}`}>
      {children}
    </button>
  );
}

export function Panel({ title, description, actions, children, className = "" }: {
  title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[10px] border border-border-strong bg-card p-4 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[13.5px] font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 max-w-2xl text-[12px] text-foreground-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "neutral", hint }: { label: string; value: string | number; tone?: Tone; hint?: string }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : tone === "accent" ? "text-accent" : "text-foreground";
  return (
    <div className="rounded-[10px] border border-border-strong bg-card px-4 py-3">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-foreground-muted">{hint}</div>}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }).catch(() => {});
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Shared fetch helper: unwraps the API's { error } envelope into a thrown Error. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status}).`);
  return json as T;
}

/** Signed-in gate used by every page; renders the login form when signed out. */
export function useSession() {
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
