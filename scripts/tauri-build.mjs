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

function run(cmd, label, env) {
  console.log(`\n▶ ${label ?? cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, env: env ?? process.env });
}

// 1. Ensure better-sqlite3 is compiled for the HOST arch.
//    npm ci may restore a stale cross-compiled binary from a previous run's
//    cache, so we always rebuild here before any build script loads it.
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
run(
  "npm rebuild better-sqlite3 --build-from-source",
  `Rebuilding better-sqlite3 for host (${hostArch})`,
  { ...process.env, npm_config_arch: hostArch }
);

// 2. Download sidecar Node binary
run("node scripts/download-node-binary.mjs", "Downloading sidecar Node binary");

// 3. Build user.db template
run("npx tsx scripts/create-user-db-template.ts", "Building user.db template");

// 4. Copy source databases into the Tauri resource bundle
run("node scripts/copy-databases.mjs", "Copying source databases to Tauri resources");

// 5. Rebuild better-sqlite3 for the bundle TARGET arch.
//    This must happen AFTER the build scripts above (which need the host-arch
//    native module) and BEFORE tauri build (which bundles it into the app).
const target = process.env.TAURI_BUILD_TARGET;
const npmArch = target?.startsWith("aarch64") ? "arm64" : "x64";
run(
  "npm rebuild better-sqlite3 --build-from-source",
  `Rebuilding better-sqlite3 for ${npmArch}`,
  { ...process.env, npm_config_arch: npmArch }
);

// 6. Tauri build — platform-specific bundle targets
//    macOS:   build .app only (we create the DMG manually to fix server/ first)
//    Windows: NSIS installer
//    Linux:   AppImage + deb
const bundleFlag =
  process.platform === "darwin"  ? "--bundles app" :
  process.platform === "win32"   ? "--bundles nsis" :
  /* linux */                      "--bundles appimage,deb";

const targetFlag = target ? `--target ${target}` : "";

// Strip empty Apple signing vars so Tauri skips code signing when secrets
// are not configured (GitHub Actions sets missing secrets to empty strings).
const tauriBuildEnv = { ...process.env };
for (const key of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
  if (!tauriBuildEnv[key]) delete tauriBuildEnv[key];
}
// linuxdeploy (used by Tauri's AppImage bundler) is itself an AppImage and
// requires FUSE, which is unavailable in most CI environments. This flag
// tells it to extract and run without FUSE instead.
if (process.platform === "linux") {
  tauriBuildEnv.APPIMAGE_EXTRACT_AND_RUN = "1";
}

run(`npx tauri build ${targetFlag} ${bundleFlag}`.replace(/\s+/g, " ").trim(), `tauri build ${targetFlag} ${bundleFlag}`.trim(), tauriBuildEnv);

// 7. macOS: fix flattened server/ directory inside .app bundle
if (process.platform === "darwin") {
  run("node scripts/fix-app-bundle.mjs", "Fixing .app bundle server/ structure");
}

console.log("\n✓ tauri:build complete.");
