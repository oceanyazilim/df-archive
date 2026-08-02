import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/artwork?url=…&name=…
 * Downloads a track/release artwork image as an attachment. STRICT allowlist:
 * only known public artwork CDNs, https only — never a general-purpose proxy.
 */
const ALLOWED_HOSTS = new Set(["i.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com", "assets.soundcharts.com"]);
const NAME_RE = /[^A-Za-z0-9 _.-]/g;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  const nameParam = (req.nextUrl.searchParams.get("name") ?? "artwork").replace(NAME_RE, "").slice(0, 80) || "artwork";
  let url: URL;
  try { url = new URL(raw); } catch { return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Invalid artwork URL." } }, { status: 400 }); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Artwork host is not allowed." } }, { status: 400 });
  }

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: { code: "SPOTIFY_NOT_FOUND", message: `Artwork fetch failed (HTTP ${res.status}).` } }, { status: 502 });
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "URL did not return an image." } }, { status: 400 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 12 * 1024 * 1024) return NextResponse.json({ error: { code: "INVALID_LOOKUP_INPUT", message: "Image too large." } }, { status: 400 });
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${nameParam}.${ext}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Artwork download failed." } }, { status: 502 });
  }
}
