"use client";

/**
 * Panel UI kit — deliberately mirrors the desktop app's shared components
 * (Card / Panel / StatCard / StatusBadge / Button) so the two surfaces read as
 * one product. Kept in a single file: the panel is small enough that a
 * component-per-file tree would be more navigation than it is worth.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent" | "violet";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "border-border-strong bg-card-elevated text-foreground-secondary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  accent: "border-accent/30 bg-accent/10 text-accent",
  violet: "border-violet/30 bg-violet/10 text-violet",
};

export function Badge({ tone = "neutral", children, title, dot }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 ${BADGE_TONE[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ children, className = "", hoverable }: { children: ReactNode; className?: string; hoverable?: boolean }) {
  return (
    <div className={`rounded-[14px] border border-border-strong bg-card ${hoverable ? "transition-[border-color,transform,box-shadow] duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_12px_32px_rgba(0,0,0,0.55)]" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Panel({ title, description, actions, children, className = "" }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <Card className={`p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>}
            {description && <p className="mt-0.5 max-w-2xl text-xs text-foreground-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function StatCard({ label, value, sub, icon, tone = "neutral" }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone;
}) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning"
    : tone === "success" ? "text-success" : tone === "accent" ? "text-accent"
    : tone === "violet" ? "text-violet" : "text-foreground";
  return (
    <Card hoverable className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{label}</span>
        {icon && <span className="text-foreground-muted">{icon}</span>}
      </div>
      <div className={`mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-foreground-secondary">{sub}</div>}
    </Card>
  );
}

export function Button({
  children, onClick, variant = "secondary", size = "md", disabled, loading, type = "button", className = "", title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const sizes = size === "sm" ? "h-8 px-3 text-[12px]" : "h-9 px-4 text-[13px]";
  const variants = {
    primary: "border-transparent bg-accent text-[color:var(--on-accent)] hover:bg-accent-hover",
    secondary: "border-border-strong bg-card text-foreground hover:bg-card-hover",
    danger: "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
    ghost: "border-transparent bg-transparent text-foreground-secondary hover:bg-card-hover hover:text-foreground",
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[7px] border font-medium transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-50 ${sizes} ${variants} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
  );
}

export function PageHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[12.5px] text-foreground-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="grid place-items-center px-4 py-12 text-center">
      {icon && <div className="mb-2 text-foreground-muted">{icon}</div>}
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12px] text-foreground-muted">{description}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[7px] bg-card-elevated ${className}`} />;
}

/** Table shell: one place owning header/row/cell styling. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[10.5px] font-semibold uppercase tracking-wider text-foreground-muted">
            {head.map((h) => <th key={h} className="py-2.5 pr-3 font-semibold last:pr-0">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Audit vocabulary shared by every page that renders the event trail.
 *  (Lives here, not in a page file: Next forbids extra exports from pages.) */
export const ACTION_LABEL: Record<string, string> = {
  activate: "Activation",
  heartbeat: "Check-in",
  spotify: "Spotify link",
  deactivate: "Removed",
};

const OUTCOME_LABEL: Record<string, string> = {
  ok: "ok",
  unknown_key: "unknown key",
  revoked: "revoked",
  expired: "expired",
  device_limit: "device limit",
  invalid_token: "not activated",
  device_blocked: "blocked",
  malformed: "malformed",
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone: Tone = outcome === "ok" ? "success" : outcome === "device_limit" || outcome === "expired" ? "warning" : "danger";
  return <Badge tone={tone}>{OUTCOME_LABEL[outcome] ?? outcome}</Badge>;
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

// ---------------- helpers ----------------
export function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Days remaining, or null when the key never expires. */
export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86400000);
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

/** Live clock used in the top bar — the panel is an operations surface, so
 *  "what time is it here" matters when reading activation timestamps. */
export function useClock(): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
