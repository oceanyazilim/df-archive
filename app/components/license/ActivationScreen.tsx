"use client";

/**
 * Activation gate — the first thing an unlicensed copy shows.
 *
 * It is a full-screen takeover on purpose: there is no partially-usable state
 * to fall back to, and the server refuses every analysis route anyway. The
 * screen also has to be honest about WHY it appeared (never activated vs. key
 * revoked vs. expired vs. panel unreachable), because those need different
 * actions from the user.
 */

import { useState } from "react";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import type { LicenseState } from "../../lib/license";

const STATE_COPY: Record<Exclude<LicenseState["state"], "active" | "grace">, { title: string; body: string }> = {
  unlicensed: {
    title: "Activate this copy",
    body: "Enter the key you received. It unlocks this computer and stays valid until it expires or is revoked.",
  },
  locked: {
    title: "This copy is locked",
    body: "The license is no longer valid on this computer. Enter another key, or contact Virus Records.",
  },
};

export function ActivationScreen({ status, onActivated }: { status: LicenseState; onActivated: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = STATE_COPY[status.state === "locked" ? "locked" : "unlicensed"];

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "This key was not accepted.");
        return;
      }
      onActivated();
    } catch {
      setError("Could not reach the license server. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  };

  // Keys read as VR-XXXX-XXXX-XXXX; group as the user types so a pasted or
  // hand-typed key always ends up in the same shape.
  const onChange = (raw: string) => {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
    const body = clean.startsWith("VR") ? clean.slice(2) : clean;
    const groups = body.match(/.{1,4}/g) ?? [];
    setKey(groups.length ? `VR-${groups.join("-")}` : clean ? `VR-${body}` : "");
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5">
      {/* Ambient brand wash — subtle, never competing with the form. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{ background: "radial-gradient(60% 45% at 50% 0%, var(--accent-dim), transparent 70%)" }} />

      <div className="relative w-full max-w-[420px]">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl text-[15px] font-extrabold tracking-tight"
            style={{ background: "radial-gradient(circle at 30% 25%, var(--accent), var(--accent-deep) 78%)", color: "var(--on-accent)" }}>
            VR
          </span>
          <div>
            <div className="text-[17px] font-semibold leading-5 tracking-tight text-foreground">Virus Records</div>
            <div className="text-[11.5px] text-foreground-muted">Distribution intelligence</div>
          </div>
        </div>

        <div className="rounded-lg border border-border-strong bg-card p-6">
          <h1 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            {status.state === "locked" ? <ShieldAlert className="size-4 text-danger" aria-hidden /> : <KeyRound className="size-4 text-accent" aria-hidden />}
            {copy.title}
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground-secondary">{copy.body}</p>

          {status.state === "locked" && status.message && (
            <p className="mt-3 rounded-sm border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] text-danger">{status.message}</p>
          )}

          <label className="mt-5 block text-[11.5px] text-foreground-secondary" htmlFor="license-key">License key</label>
          <input
            id="license-key"
            value={key}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="VR-XXXX-XXXX-XXXX"
            className="mt-1.5 h-11 w-full rounded-sm border border-border-strong bg-input px-3 text-center font-mono text-[16px] tracking-[0.14em] text-foreground outline-none placeholder:text-foreground-muted focus:border-accent focus:shadow-focus-ring"
          />

          {error && <p className="mt-2.5 text-[12px] text-danger">{error}</p>}

          <button
            onClick={submit}
            disabled={busy || key.replace(/[^A-Z0-9]/g, "").length < 8}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-transparent bg-accent text-[13.5px] font-semibold text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Activating…</> : "Activate"}
          </button>

          <p className="mt-4 border-t border-border-subtle pt-3 text-[11px] leading-relaxed text-foreground-muted">
            One key belongs to one computer. Activating on a second machine is refused, and every activation is
            recorded with its time and IP address so shared keys can be traced.
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-foreground-muted">
          Keys are issued by Virus Records only · {new URL(status.server).host}
        </p>
      </div>
    </div>
  );
}
