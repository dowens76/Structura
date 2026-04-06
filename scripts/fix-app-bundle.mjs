/**
 * fix-app-bundle.mjs
 *
 * Tauri's resources glob flattens all files into a single directory level,
 * dropping subdirectories. This script replaces the flattened server/ tree
 * inside the macOS Structura.app bundle with the correctly-structured copy
 * from resources/server/.
 *
 * macOS only — Windows/Linux bundles use different packaging mechanisms
 * where Tauri writes resources directly into the install tree.
 *
 * Run automatically as part of: npm run tauri:build
 */
import { cpSync, rmSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.platform !== "darwin") {
  console.log(`fix-app-bundle: skipping on ${process.platform} (macOS only).`);
  process.exit(0);
}

const buildTarget = process.env.TAURI_BUILD_TARGET;
const bundleBase  = buildTarget
  ? path.join(ROOT, `src-tauri/target/${buildTarget}/release/bundle`)
  : path.join(ROOT, "src-tauri/target/release/bundle");
const APP     = path.join(bundleBase, "macos/Structura.app");
const CONTENT = path.join(APP, "Contents/Resources");


if (!existsSync(APP)) {
  console.error(`ERROR: ${APP} not found. Run 'tauri build --bundles app' first.`);
  process.exit(1);
}

// Replace flattened server/ with the correct structure from resources/server/
const serverSrc  = path.join(ROOT, "src-tauri/resources/server");
const serverDest = path.join(CONTENT, "server");

console.log("Fixing server/ directory in Structura.app...");
if (existsSync(serverDest)) rmSync(serverDest, { recursive: true, force: true });
mkdirSync(serverDest, { recursive: true });
cpSync(serverSrc, serverDest, { recursive: true });
console.log("  ✓ server/ replaced with correct directory structure");

// Verify key files are present
const checks = [
  path.join(serverDest, "server.js"),
  path.join(serverDest, ".next", "BUILD_ID"),
  path.join(serverDest, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
];
let ok = true;
for (const f of checks) {
  if (existsSync(f)) {
    console.log(`  ✓ ${path.relative(serverDest, f)}`);
  } else {
    console.error(`  ✗ MISSING: ${path.relative(serverDest, f)}`);
    ok = false;
  }
}

if (!ok) { console.error("Bundle verification failed."); process.exit(1); }
console.log("\nStructura.app is ready.");
