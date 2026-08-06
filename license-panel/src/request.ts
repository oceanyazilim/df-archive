/**
 * Client IP + user agent extraction.
 *
 * Behind Dokploy the app sits behind Traefik, so the socket address is always
 * the proxy — the real client IP arrives in x-forwarded-for. Only the FIRST
 * entry is used (the client as seen by the edge proxy); the rest are hops a
 * client can forge by sending its own header.
 */

import type { NextRequest } from "next/server";

export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return normalize(first);
  }
  const real = req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
  if (real) return normalize(real.trim());
  return req.ip ? normalize(req.ip) : null;
}

function normalize(ip: string): string {
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) reads better as plain IPv4 in the panel.
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return (m ? m[1] : ip).slice(0, 45);
}

export function userAgent(req: NextRequest): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 200) : null;
}
