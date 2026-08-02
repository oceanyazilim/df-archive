export interface FlagUuidPayload {
  reason: "add" | "report";
  licensorUuid?: string | null;
  spotifyTrackId?: string | null;
  spotifyAlbumId?: string | null;
  trackTitle?: string | null;
  releaseTitle?: string | null;
  artists?: string[];
  note?: string | null;
}

/** Submits a real, reviewable record — backs "Add to UUID Database" / "Report Mapping". */
export async function submitUuidFlag(payload: FlagUuidPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/uuid-mapping/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || j.error) return { ok: false, error: j.error?.message ?? "Could not submit." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error — could not reach the server." };
  }
}
