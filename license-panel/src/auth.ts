/**
 * Admin session — a signed, stateless cookie.
 *
 * Stateless on purpose: Dokploy restarts the container on every redeploy, and
 * an in-memory session table would log the administrator out each time. The
 * cookie carries only an expiry and an HMAC over it; there is nothing to
 * steal from the server side but the secret itself.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "vr_panel_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  // A missing secret must not silently degrade to a guessable default.
  const s = process.env.PANEL_SECRET;
  if (!s || s.length < 16) {
    throw new Error("PANEL_SECRET is not set (needs at least 16 characters).");
  }
  return s;
}

export function isConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.PANEL_PASSWORD) missing.push("PANEL_PASSWORD");
  if (!process.env.PANEL_SECRET || process.env.PANEL_SECRET.length < 16) missing.push("PANEL_SECRET");
  return { ok: missing.length === 0, missing };
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function verifyPassword(candidate: unknown): boolean {
  const expected = process.env.PANEL_PASSWORD;
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createSession(): { value: string; maxAge: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return { value: `${payload}.${sign(payload)}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function isValidSession(cookieValue: string | undefined | null): boolean {
  if (!cookieValue) return false;
  const [payload, mac] = cookieValue.split(".");
  if (!payload || !mac) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  let expected: string;
  try { expected = sign(payload); } catch { return false; }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
