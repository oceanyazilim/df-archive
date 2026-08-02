// prepare.mjs — assemble the desktop server bundle from the Next.js standalone
// build. Run `next build` first (next.config.js already sets output:"standalone").
//
//   .next/standalone  → desktop/server            (server.js + traced deps)
//   .next/static      → desktop/server/.next/static
//   public            → desktop/server/public
//   json              → desktop/server/json       (canonical mapping, always fresh)
//   .env*             → desktop/server            (optional runtime secrets)

import { cpSync, rmSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = path.join(root, "desktop", "server");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` in the repo root first.");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(standalone, out, { recursive: true });
cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
}
// The output-file-trace usually carries json/** already; copy again so the
// bundle always ships the current mapping even if the trace lagged the build.
cpSync(path.join(root, "json"), path.join(out, "json"), { recursive: true });

for (const f of readdirSync(root)) {
  if (/^\.env(\..+)?$/.test(f) && statSync(path.join(root, f)).isFile()) {
    copyFileSync(path.join(root, f), path.join(out, f));
  }
}

console.log("Desktop server bundle ready:", out);
