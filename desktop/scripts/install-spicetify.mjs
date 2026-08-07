// install-spicetify.mjs — install the Ocean Distro Finder companion into the
// Spotify desktop client via Spicetify. Used both from the CLI and from the
// desktop app's "Install Spotify companion" menu (same implementation).
//
//   node desktop/scripts/install-spicetify.mjs [--mapping path/to/uuid's.json] [--source path/to/distro-finder.js] [--no-restart]
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
// --no-restart: patch without touching the running Spotify process. The caller
// (the desktop shell's auto-repair) decides when a restart is appropriate.
const noRestart = process.argv.includes("--no-restart");

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

/**
 * Locate the Spicetify CLI.
 *
 * PATH alone is not enough: the official installer adds its folder to the
 * user's PATH, but an already-running process (this one, or the desktop app
 * that forked it) keeps the old environment — so a freshly installed CLI is
 * invisible until the app restarts. Resolving the executable path directly
 * makes the install usable immediately.
 */
function resolveSpicetify() {
  const candidates = [
    "spicetify", // PATH, when the environment already has it
    path.join(process.env.LOCALAPPDATA || "", "spicetify", "spicetify.exe"),
    path.join(process.env.APPDATA || "", "spicetify", "spicetify.exe"),
    path.join(os.homedir(), ".spicetify", "spicetify.exe"),
    path.join(os.homedir(), ".spicetify", "spicetify"),
  ];
  for (const bin of candidates) {
    if (bin !== "spicetify" && !fs.existsSync(bin)) continue;
    const r = spawnSync(bin, ["--version"], { shell: bin === "spicetify", encoding: "utf8" });
    if (!r.error && r.status === 0) return { bin, version: (r.stdout || "").trim() };
  }
  return null;
}

/**
 * Install the Spicetify CLI with its official script. Customers must never be
 * asked to run terminal commands, so the app does this itself — but only on
 * Windows, and only when the CLI is genuinely absent.
 */
function installSpicetifyCli() {
  if (process.platform !== "win32") return null;
  console.log("Spicetify CLI not found — installing it (official installer)…");
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      "$ProgressPreference='SilentlyContinue'; iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex"],
    { encoding: "utf8", windowsHide: true, timeout: 5 * 60 * 1000 }
  );
  process.stdout.write((r.stdout || "").slice(-1200));
  if (r.stderr) process.stderr.write(r.stderr.slice(-600));
  return resolveSpicetify();
}

let cli = resolveSpicetify();
if (!cli && !process.argv.includes("--no-cli-install")) cli = installSpicetifyCli();
if (!cli) {
  console.error(
    "Spicetify CLI could not be installed automatically. Install it manually from https://spicetify.app and run this again."
  );
  process.exit(1);
}
console.log(`Spicetify ${cli.version} ready (${cli.bin}).`);

function spicetify(args) {
  // shell:true only for the bare PATH name; a resolved path is spawned directly.
  return spawnSync(cli.bin, args, { shell: cli.bin === "spicetify", encoding: "utf8" });
}

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

function run(args) {
  const r = spicetify(args);
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  return r;
}

/**
 * Put Spotify back the way it was.
 *
 * Patching rewrites Spotify's own app files. If `apply` fails halfway — an
 * unsupported client version is the usual cause — the client is left broken,
 * and the user did not sign up for that: an optional right-click menu must
 * never cost someone their music player. Every failure path below restores.
 */
function restoreSpotify(why) {
  console.error(`\n${why} — restoring Spotify to its unpatched state…`);
  const r = run(["restore"]);
  if (r.status === 0) console.error("Spotify restored. The in-app panel is not installed; everything else works.");
  else console.error("Automatic restore failed. Run `spicetify restore` manually, or reinstall Spotify from spotify.com.");
  return r.status === 0;
}

// `--restore`: undo everything and leave. Used by the app's repair action.
if (process.argv.includes("--restore")) {
  run(["config", "extensions", "distro-finder.js-"]);
  const ok = restoreSpotify("Restore requested");
  process.exit(ok ? 0 : 1);
}

const applyArgs = noRestart ? ["-n", "apply"] : ["apply"];
const cfg = run(["config", "extensions", "distro-finder.js"]);
if (cfg.status !== 0) {
  console.error(`\n\`spicetify config extensions distro-finder.js\` failed (exit ${cfg.status}).`);
  process.exit(1);
}
let applied = run(applyArgs);
if (applied.status !== 0) {
  // A Spotify self-update rewrites the client and invalidates the old backup;
  // spicetify then refuses a plain `apply`. `backup apply` re-backups the
  // fresh (unpatched) client and applies in one go — recover automatically
  // instead of asking the user to run CLI commands.
  const out = `${applied.stdout || ""}${applied.stderr || ""}`;
  if (/mismatch|backup/i.test(out)) {
    console.log("\nSpotify was updated since the last patch — re-backing up the new client…");
    applied = run(noRestart ? ["-n", "backup", "apply"] : ["backup", "apply"]);
  }
  if (applied.status !== 0) {
    // Do NOT leave a half-patched client behind.
    restoreSpotify(`\`spicetify ${applyArgs.join(" ")}\` failed (exit ${applied.status})`);
    process.exit(1);
  }
}

console.log("\nDone. In Spotify: right-click any track → “Ocean Distro Finder”.");
