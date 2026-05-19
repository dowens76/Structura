/**
 * bump-version.mjs
 *
 * Updates the version string in every file that embeds it:
 *   - package.json
 *   - package-lock.json  (top-level + packages[""] entries)
 *   - src-tauri/tauri.conf.json
 *   - docs/index.html    (⬇ Download vX.Y.Z button)
 *
 * Usage:
 *   node scripts/bump-version.mjs 0.7.2
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <major.minor.patch>");
  console.error("Example: node scripts/bump-version.mjs 0.7.2");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf-8");
}

function writeText(rel, content) {
  writeFileSync(join(ROOT, rel), content, "utf-8");
}

function replaceOnce(text, pattern, replacement, filePath) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    console.warn(`  ⚠  No match found in ${filePath} — skipped`);
  }
  return next;
}

// ── Read current version from package.json ────────────────────────────────────

const pkg = JSON.parse(readText("package.json"));
const oldVersion = pkg.version;

if (oldVersion === newVersion) {
  console.log(`Already at ${newVersion} — nothing to do.`);
  process.exit(0);
}

console.log(`\nBumping ${oldVersion} → ${newVersion}\n`);

// ── 1. package.json ───────────────────────────────────────────────────────────

pkg.version = newVersion;
writeText("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log(`  ✓  package.json`);

// ── 2. package-lock.json ──────────────────────────────────────────────────────

const lock = JSON.parse(readText("package-lock.json"));
lock.version = newVersion;
if (lock.packages?.[""]?.version !== undefined) {
  lock.packages[""].version = newVersion;
}
writeText("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log(`  ✓  package-lock.json`);

// ── 3. src-tauri/tauri.conf.json ──────────────────────────────────────────────

const tauriConf = JSON.parse(readText("src-tauri/tauri.conf.json"));
tauriConf.version = newVersion;
writeText("src-tauri/tauri.conf.json", JSON.stringify(tauriConf, null, 2) + "\n");
console.log(`  ✓  src-tauri/tauri.conf.json`);

// ── 4. docs/index.html ───────────────────────────────────────────────────────

let html = readText("docs/index.html");
html = replaceOnce(
  html,
  /⬇ Download v[\d.]+/,
  `⬇ Download v${newVersion}`,
  "docs/index.html"
);
writeText("docs/index.html", html);
console.log(`  ✓  docs/index.html`);

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`\nDone. All files updated to ${newVersion}.\n`);
