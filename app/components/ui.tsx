"use client";

/** Small shared UI primitives — copy button, artwork, empty/error states, stat cards. */

export function CopyButton({ value, label, flash, small }: { value: string | null; label: string; flash: (m: string) => void; small?: boolean }) {
  if (!value) return null;
  return (
    <button className="copy-btn" title={`Copy ${label}`} aria-label={`Copy ${label}`}
      onClick={async () => { try { await navigator.clipboard.writeText(value); flash(`Copied ${label}`); } catch { /* */ } }}>
      {small ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg> : "copy"}
    </button>
  );
}

export function PageHead({ title, desc, actions }: { title: string; desc?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head anim-in" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div>
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-card anim-in">
      <div className="empty-ico" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
      {body && <div className="hint" style={{ maxWidth: 420, margin: "6px auto 0" }}>{body}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div className="empty-card anim-in" role="alert">
      <div className="empty-ico" style={{ color: "var(--danger)" }} aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
      {body && <div className="hint" style={{ maxWidth: 420, margin: "6px auto 0" }}>{body}</div>}
      {onRetry && <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function ArtworkThumb({ url, alt, size = 34, radius = 6 }: { url?: string | null; alt: string; size?: number; radius?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} loading="lazy" style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", border: "1px solid var(--border)", flexShrink: 0 }} />;
  }
  return <span style={{ width: size, height: size, borderRadius: radius, background: "var(--surface-raised)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: size * 0.4, flexShrink: 0 }} aria-hidden>♪</span>;
}

export function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string | null; tone?: "ok" | "warn" | "err" | "acc" }) {
  return (
    <div className={`card anim-in ${tone ?? ""}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
