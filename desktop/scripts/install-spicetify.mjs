// install-spicetify.mjs — install the Ocean Distro Finder companion into the
// Spotify desktop client via Spicetify. Used both from the CLI and from the
// desktop app's "Install Spotify companion" menu (same implementation).
//
//   node desktop/scripts/install-spicetify.mjs [--mapping path/to/uuid's.json] [--source path/to/distro-finder.js]
//
// The Spotify renderer cannot reach a localhost backend by any channel, so the
// canonical UUID→distributor mapping is EMBEDDED into the extension at install
// time (same source file, same exact-match rule, conflicts excluded). Re-run
// this installer whenever json/uuid's.json changes.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(arg("source", path.join(here, "..", "..", "spicetify", "distro-finder.js")));
const mappingPath = path.resolve(arg("mapping", path.join(here, "..", "..", "json", "uuid's.json")));

if (!fs.existsSync(source)) {
  console.error(`Companion source not found: ${source}`);
  process.exit(1);
}

/**
 * Build { uuid: distributorName } from the canonical file. Mirrors the backend
 * resolver: normalize to 32-hex lowercase, and EXCLUDE any UUID claimed by two
 * different distributors — the system never guesses.
 */
function buildMapping(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const records = Array.isArray(raw)
    ? raw.map((r) => [r.uuid ?? r.licensorUuid ?? r.id, r.name ?? r.distributor ?? r.distributorName])
    : Object.entries(raw);
  const byUuid = new Map();
  const conflicts = new Set();
  for (const [rawUuid, rawName] of records) {
    const uuid = String(rawUuid ?? "").trim().toLowerCase().replace(/-/g, "");
    const name = String(rawName ?? "").trim();
    if (!/^[a-f0-9]{32}$/.test(uuid) || !name) continue;
    const prev = byUuid.get(uuid);
    if (prev && prev !== name) { conflicts.add(uuid); continue; }
    byUuid.set(uuid, name);
  }
  for (const c of conflicts) byUuid.delete(c);
  return { map: Object.fromEntries(byUuid), conflicts: conflicts.size, total: records.length };
}

function spicetify(args) {
  // shell:true so spicetify.exe resolves through PATH on Windows.
  return spawnSync("spicetify", args, { shell: true, encoding: "utf8" });
}

const probe = spicetify(["--version"]);
if (probe.error || probe.status !== 0) {
  console.error(
    "Spicetify CLI not found. Install it first (https://spicetify.app):\n" +
      "  iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex\n" +
      "then re-run this installer."
  );
  process.exit(1);
}
console.log(`Spicetify ${probe.stdout.trim()} found.`);

const extDir =
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "spicetify", "Extensions")
    : path.join(os.homedir(), ".config", "spicetify", "Extensions");
fs.mkdirSync(extDir, { recursive: true });

if (!fs.existsSync(mappingPath)) {
  console.error(`Mapping file not found: ${mappingPath}`);
  process.exit(1);
}
const { map, conflicts, total } = buildMapping(mappingPath);
if (!Object.keys(map).length) {
  console.error(`Mapping file has no usable records: ${mappingPath}`);
  process.exit(1);
}

const content = fs.readFileSync(source, "utf8");
let patched = content.replace("/*__ODF_MAPPING__*/ {}", "/*__ODF_MAPPING__*/ " + JSON.stringify(map));
patched = patched.replace('/*__ODF_MAPPING_BUILT_AT__*/ ""', '/*__ODF_MAPPING_BUILT_AT__*/ ' + JSON.stringify(new Date().toISOString().slice(0, 10)));
if (patched === content) {
  console.error("Could not find the mapping placeholder to patch — companion source changed?");
  process.exit(1);
}
fs.writeFileSync(path.join(extDir, "distro-finder.js"), patched);
console.log(
  `Companion copied to ${extDir}\n` +
  `  mapping: ${Object.keys(map).length} distributors embedded from ${total} records` +
  (conflicts ? ` (${conflicts} conflicting UUID(s) excluded)` : "")
);

for (const args of [["config", "extensions", "distro-finder.js"], ["apply"]]) {
  const r = spicetify(args);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) {
    console.error(`\n\`spicetify ${args.join(" ")}\` failed (exit ${r.status}).`);
    process.exit(1);
  }
}

console.log("\nDone. In Spotify: right-click any track → “Ocean Distro Finder”.");
