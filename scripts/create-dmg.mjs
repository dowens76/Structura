/**
 * create-dmg.mjs
 *
 * Creates a drag-and-drop DMG installer from the (already fixed) Structura.app.
 * Uses appdmg for the Finder window layout (background image, Applications alias,
 * icon positions).
 *
 * Run after `npm run tauri:build` has completed.
 * Run: npm run tauri:dmg
 */
import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
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

// Detect architecture
let triple = "";
try {
  const out = execSync("rustc -vV", { encoding: "utf-8" });
  triple = out.split("\n").find(l => l.startsWith("host:"))?.split(": ")[1]?.trim() ?? "";
} catch { /* fall back to process.arch */ }

const archSuffix = buildTarget
  ? (buildTarget.startsWith("aarch64") ? "aarch64" : "x86_64")
  : triple.startsWith("aarch64") ? "aarch64"
  : triple.startsWith("x86_64")  ? "x86_64"
  : process.arch === "arm64"     ? "aarch64"
  : "x86_64";

mkdirSync(DMG_DIR, { recursive: true });

const DMG = path.join(DMG_DIR, `Structura_${version}_${archSuffix}.dmg`);

// Detach any lingering mounted Structura volumes
try {
  const vols = execSync("ls /Volumes/ 2>/dev/null", { encoding: "utf-8" });
  for (const vol of vols.split("\n")) {
    if (vol.toLowerCase().startsWith("structura")) {
      try {
        execSync(`hdiutil detach "/Volumes/${vol}" -force`, { stdio: "ignore" });
      } catch { /* ignore */ }
    }
  }
} catch { /* ignore */ }

if (existsSync(DMG)) {
  rmSync(DMG);
}

// appdmg spec — see https://github.com/LinusU/node-appdmg
// Window: 660×420, matching dmg-background.png dimensions
// App icon center:          (165, 285)  ← same as tauri.conf.json appPosition
// Applications alias center: (495, 285) ← same as tauri.conf.json applicationFolderPosition
const spec = {
  title: "Structura",
  background: path.join(ROOT, "src-tauri/icons/dmg-background@2x.png"),
  "icon-size": 80,
  window: { size: { width: 660, height: 420 } },
  contents: [
    { x: 165, y: 285, type: "file", path: APP },
    { x: 495, y: 285, type: "link", path: "/Applications" },
  ],
};

const specPath = path.join(ROOT, ".appdmg-spec.json");
writeFileSync(specPath, JSON.stringify(spec, null, 2));

console.log(`Creating DMG: ${path.basename(DMG)}…`);
try {
  const result = spawnSync(
    path.join(ROOT, "node_modules/.bin/appdmg"),
    [specPath, DMG],
    { stdio: "inherit", cwd: ROOT }
  );
  if (result.status !== 0) {
    console.error("appdmg failed.");
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(specPath, { force: true });
}

console.log(`\n✓ DMG created: ${DMG}`);
