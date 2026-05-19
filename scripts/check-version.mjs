/**
 * check-version.mjs
 *
 * Verifies that the version string is consistent across every file that
 * embeds it.  Exits with code 1 if any mismatch is found.
 *
 * Run manually:  npm run version:check
 * Run in CI:     add `npm run version:check` as a build step.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// ── Collect versions from each source ────────────────────────────────────────

const sources = [];

const pkg = JSON.parse(read("package.json"));
sources.push({ file: "package.json", version: pkg.version });

const lock = JSON.parse(read("package-lock.json"));
sources.push({ file: "package-lock.json (root)", version: lock.version });
if (lock.packages?.[""]?.version !== undefined) {
  sources.push({ file: 'package-lock.json (packages[""])', version: lock.packages[""].version });
}

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
sources.push({ file: "src-tauri/tauri.conf.json", version: tauriConf.version });

const html = read("docs/index.html");
const htmlMatch = html.match(/⬇ Download v([\d.]+)/);
sources.push({
  file: "docs/index.html",
  version: htmlMatch ? htmlMatch[1] : "(not found)",
});

// ── Report ────────────────────────────────────────────────────────────────────

const expected = pkg.version;
let allOk = true;

console.log(`\nVersion consistency check (expected: ${expected})\n`);

for (const { file, version } of sources) {
  const ok = version === expected;
  console.log(`  ${ok ? "✓" : "✗"}  ${file}: ${version}`);
  if (!ok) allOk = false;
}

if (allOk) {
  console.log(`\nAll files are at ${expected}.\n`);
} else {
  console.error(`\n✗ Version mismatch detected. Run: npm run version:bump ${expected}\n`);
  process.exit(1);
}
