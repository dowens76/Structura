/**
 * create-dmg.mjs
 *
 * Creates a distributable DMG from the (already fixed) Structura.app.
 * Run after `npm run tauri:build` has completed.
 *
 * Run: npm run tauri:dmg
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT    = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP     = path.join(ROOT, "src-tauri/target/release/bundle/macos/Structura.app");
const DMG_DIR = path.join(ROOT, "src-tauri/target/release/bundle/dmg");
const DMG     = path.join(DMG_DIR, "Structura_0.1.0_aarch64.dmg");

if (!existsSync(APP)) {
  console.error(`ERROR: ${APP} not found. Run 'npm run tauri:build' first.`);
  process.exit(1);
}

mkdirSync(DMG_DIR, { recursive: true });

console.log("Creating DMG...");
execSync(
  `hdiutil create -volname "Structura" -srcfolder "${APP}" -ov -format UDZO "${DMG}"`,
  { stdio: "inherit" }
);

console.log(`\n✓ DMG created: ${DMG}`);
