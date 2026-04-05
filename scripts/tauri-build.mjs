/**
 * tauri-build.mjs
 *
 * Cross-platform Tauri build orchestrator. Replaces the bash-chained
 * `tauri:build` npm script so it works on macOS, Windows, and Linux.
 *
 * Steps:
 *   1. Download the sidecar Node.js binary for the current target triple
 *   2. Create the user.db template
 *   3. Build Next.js + run `tauri build` with platform-appropriate bundles
 *   4. macOS only: fix the flattened server/ directory in the .app bundle
 *
 * Run: npm run tauri:build
 */
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(cmd, label) {
  console.log(`\n▶ ${label ?? cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

// 1. Download sidecar Node binary
run("node scripts/download-node-binary.mjs", "Downloading sidecar Node binary");

// 2. Build user.db template
run("npx tsx scripts/create-user-db-template.ts", "Building user.db template");

// 3. Tauri build — platform-specific bundle targets
//    macOS:   build .app only (we create the DMG manually to fix server/ first)
//    Windows: NSIS installer
//    Linux:   AppImage + deb
const bundleFlag =
  process.platform === "darwin"  ? "--bundles app" :
  process.platform === "win32"   ? "--bundles nsis" :
  /* linux */                      "--bundles appimage,deb";

run(`npx tauri build ${bundleFlag}`, `tauri build ${bundleFlag}`);

// 4. macOS: fix flattened server/ directory inside .app bundle
if (process.platform === "darwin") {
  run("node scripts/fix-app-bundle.mjs", "Fixing .app bundle server/ structure");
}

console.log("\n✓ tauri:build complete.");
