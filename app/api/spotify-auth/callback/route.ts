import { NextRequest, NextResponse } from "next/server";
import { completeAuth } from "@core/spotifyAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify-auth/callback — Spotify sends the user's browser back here
 * after consent. Exchanges the one-time code (PKCE) and shows a tiny page the
 * user can close; the panel notices the new link state by polling status.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const denied = q.get("error");
  let title: string;
  let detail: string;
  let ok = false;

  if (denied) {
    title = "Authorization cancelled";
    detail = denied === "access_denied"
      ? "You declined the authorization — nothing was connected."
      : `Spotify reported: ${denied}`;
  } else {
    const out = await completeAuth(q.get("code"), q.get("state"));
    ok = out.ok;
    if (out.ok) {
      title = "Spotify account connected";
      detail = out.displayName
        ? `Connected as ${out.displayName}. You can close this tab and return to Ocean Distro Finder.`
        : "Connected. You can close this tab and return to Ocean Distro Finder.";
    } else {
      title = "Connection failed";
      detail = out.message;
    }
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;display:grid;place-items:center;min-height:100vh;background:#000;color:#e8e8e8;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  .card{max-width:420px;padding:36px 40px;border:1px solid #222;border-radius:10px;background:#0a0a0a;text-align:center}
  .dot{width:44px;height:44px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:${ok ? "#12351f" : "#3a1414"};color:${ok ? "#1db954" : "#e05555"}}
  h1{margin:0 0 8px;font-size:17px;font-weight:600}
  p{margin:0;color:#9a9a9a}
</style></head><body>
<div class="card"><div class="dot">${ok ? "✓" : "✕"}</div><h1>${esc(title)}</h1><p>${esc(detail)}</p></div>
<script>if(${ok ? "true" : "false"}){setTimeout(function(){try{window.close()}catch(e){}},4000)}</script>
</body></html>`;
  return new NextResponse(html, { status: ok || denied ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
