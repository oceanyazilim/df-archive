/**
 * Minimal dependency-free HTTP layer exposing the intermediary service.
 *
 *   POST /api/distributor-lookup         { "trackId": "..." }  (or {value,type})
 *   POST /api/distributor-lookup/batch   { "tracks": [ { "trackId": "..." } ] }
 *   POST /api/distributor-lookup/refresh  (reloads the mapping file)
 *   GET  /health
 *
 * The server never returns tokens or Authorization headers in any response.
 * It is built on Node's built-in http module so no web framework is added.
 */

import * as http from "http";
import { DistributorResolver } from "./distributorResolver";
import { TrackIdentifier } from "./types";
import { logger } from "./logger";

const MAX_BODY_BYTES = 1_000_000; // 1 MB guard against oversized payloads.

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

/** Extract a TrackIdentifier from a request object supporting several shapes. */
function toIdentifier(obj: Record<string, unknown>): TrackIdentifier | string | null {
  if (typeof obj.trackId === "string") return { value: obj.trackId, type: "trackId" };
  if (typeof obj.value === "string") {
    return { value: obj.value, type: (obj.type as TrackIdentifier["type"]) ?? "trackId" };
  }
  for (const type of ["isrc", "upc", "releaseId", "platformTrackId"] as const) {
    if (typeof obj[type] === "string") return { value: obj[type] as string, type };
  }
  return null;
}

export function createServer(resolver = new DistributorResolver()): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      if (method === "GET" && url === "/health") {
        const mapping = resolver.loadedMapping;
        return send(res, 200, {
          status: "ok",
          records: mapping.recordCount,
          conflicts: mapping.conflicts.length,
          warnings: mapping.warnings.length,
        });
      }

      if (method === "POST" && url === "/api/distributor-lookup") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const id = toIdentifier(body);
        if (!id) {
          return send(res, 400, {
            success: false,
            error: {
              code: "INVALID_TRACK_IDENTIFIER",
              message: "Provide trackId (or value/type, isrc, upc, releaseId).",
            },
          });
        }
        const result = await resolver.resolveDistributorForTrack(id);
        return send(res, 200, result);
      }

      if (method === "POST" && url === "/api/distributor-lookup/batch") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const tracks = Array.isArray(body.tracks) ? body.tracks : null;
        if (!tracks) {
          return send(res, 400, {
            error: {
              code: "INVALID_TRACK_IDENTIFIER",
              message: "Provide a non-empty 'tracks' array.",
            },
          });
        }
        const ids = tracks.map((t) =>
          typeof t === "string" ? t : toIdentifier(t as Record<string, unknown>)
        );
        const result = await resolver.resolveDistributorsForTracks(
          ids.filter((x): x is TrackIdentifier | string => x !== null)
        );
        return send(res, 200, result);
      }

      if (method === "POST" && url === "/api/distributor-lookup/refresh") {
        const mapping = resolver.refreshMapping();
        return send(res, 200, {
          status: "refreshed",
          records: mapping.recordCount,
          conflicts: mapping.conflicts.length,
        });
      }

      return send(res, 404, {
        error: { code: "NOT_FOUND", message: `No route for ${method} ${url}.` },
      });
    } catch (err) {
      logger.error({ event: "server_error", errorCategory: (err as Error).message });
      return send(res, 400, {
        error: { code: "BAD_REQUEST", message: (err as Error).message },
      });
    }
  });
}

// Start when run directly: `node dist/server.js`.
if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = createServer();
  server.listen(port, () => {
    logger.info({ event: "server_listening", matchStatus: `port=${port}` });
  });
}
