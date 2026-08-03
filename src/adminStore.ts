/**
 * In-memory admin session store (per server process).
 *
 * Mirrors the lightweight pattern in ./connectorStore.ts: a single password
 * (never stored, only compared) mints a random session token held in memory
 * only — no JWT, no persisted session file. Restarting the server logs every
 * admin session out, which is fine for a single local admin.
 */

import { randomBytes, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE_NAME = "ocean_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function now(): number {
  return Date.now();
}
function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

const sessions = new Map<string, number>(); // token -> expiresAt

function sweep(): void {
  for (const [t, expiresAt] of sessions) {
    if (expiresAt <= now()) sessions.delete(t);
  }
}

/** Constant-time compare against ADMIN_PASSWORD. False (never throws) if unset or the candidate isn't a non-empty string. */
export function verifyAdminPassword(candidate: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createAdminSession(): string {
  sweep();
  const t = token();
  sessions.set(t, now() + SESSION_TTL_MS);
  return t;
}

export function isValidAdminSession(sessionToken: string | undefined | null): boolean {
  if (!sessionToken) return false;
  sweep();
  return sessions.has(sessionToken);
}

export function revokeAdminSession(sessionToken: string | undefined | null): void {
  if (sessionToken) sessions.delete(sessionToken);
}
