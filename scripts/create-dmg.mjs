/**
 * create-dmg.mjs
 *
 * Creates a distributable DMG from the (already fixed) Structura.app.
 * Version and architecture are read dynamically from package.json / rustc.
 *
 * Run after `npm run tauri:build` has completed.
 * Run: npm run tauri:dmg
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT        = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildTarget = process.env.TAURI_BUILD_TARGET;
const bundleBase  = buildTarget
  ? path.join(ROOT, `src-tauri/target/${buildTarget}/release/bundle`)
  : path.join(ROOT, "src-tauri/target/release/bundle");
const APP     = path.join(bundleBase, "macos/Structura.app");
const DMG_DIR = path.join(bundleBase, "dmg");

if (process.platform !== "darwin") {
  console.log("create-dmg: skipping on non-macOS platform.");
  process.exit(0);
}

if (!existsSync(APP)) {
  console.error(`ERROR: ${APP} not found. Run 'npm run tauri:build' first.`);
  process.exit(1);
}

// Read version from package.json
const pkg     = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const version = pkg.version;

// Detect current Rust host triple (for the arch suffix in the filename)
let triple = "";
try {
  const out = execSync("rustc -vV", { encoding: "utf-8" });
  triple = out.split("\n").find(l => l.startsWith("host:"))?.split(": ")[1]?.trim() ?? "";
} catch { /* rustc not available — fall back to process.arch */ }

const archSuffix = buildTarget
  ? (buildTarget.startsWith("aarch64") ? "aarch64" : "x86_64")
  : triple.startsWith("aarch64") ? "aarch64"
  : triple.startsWith("x86_64")  ? "x86_64"
  : process.arch === "arm64"     ? "aarch64"
  : "x86_64";

mkdirSync(DMG_DIR, { recursive: true });

const DMG = path.join(DMG_DIR, `Structura_${version}_${archSuffix}.dmg`);

console.log(`Creating DMG: ${path.basename(DMG)}...`);
execSync(
  `hdiutil create -volname "Structura" -srcfolder "${APP}" -ov -format UDZO "${DMG}"`,
  { stdio: "inherit" }
);

console.log(`\n✓ DMG created: ${DMG}`);
