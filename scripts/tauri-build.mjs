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
import { writeFileSync, unlinkSync, copyFileSync, existsSync, readdirSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Rebuild better-sqlite3 from source for a specific arch.
 *
 * Older code passed `--build-from-source` as a CLI flag and set
 * `npm_config_arch` as an env var — both trigger "Unknown config" warnings in
 * npm ≥ 10.  Writing the settings to a temporary local .npmrc is the
 * recommended alternative; npm always reads the project .npmrc before running
 * any lifecycle script or rebuild.
 */
function rebuildSqlite(arch, label) {
  const npmrcPath = path.join(ROOT, ".npmrc");
  writeFileSync(npmrcPath, `build_from_source=true\narch=${arch}\n`);
  try {
    run("npm rebuild better-sqlite3", label);
  } finally {
    unlinkSync(npmrcPath);
  }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(cmd, label, env) {
  console.log(`\n▶ ${label ?? cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, env: env ?? process.env });
}

// 1. Ensure better-sqlite3 is compiled for the HOST arch.
//    npm ci may restore a stale cross-compiled binary from a previous run's
//    cache, so we always rebuild here before any build script loads it.
const hostArch = process.arch === "arm64" ? "arm64" : "x64";
rebuildSqlite(hostArch, `Rebuilding better-sqlite3 for host (${hostArch})`);

// 2. Download sidecar Node binary
run("node scripts/download-node-binary.mjs", "Downloading sidecar Node binary");

// 3. Build user.db template
run("npx tsx scripts/create-user-db-template.ts", "Building user.db template");

// 4. Copy source databases into the Tauri resource bundle
run("node scripts/copy-databases.mjs", "Copying source databases to Tauri resources");

// 5. Build Next.js (beforeBuildCommand).
//    Must run BEFORE the target-arch rebuild (step 6) because Next.js page-data
//    collection loads better-sqlite3 in the host Node process (arm64 on macOS CI).
run("npm run build:next", "Building Next.js");

// 6. Rebuild better-sqlite3 for the bundle TARGET arch.
//    This must happen AFTER the build scripts above (which need the host-arch
//    native module) and BEFORE tauri build (which bundles it into the app).
const target = process.env.TAURI_BUILD_TARGET;
const npmArch = target?.startsWith("aarch64") ? "arm64" : "x64";
rebuildSqlite(npmArch, `Rebuilding better-sqlite3 for ${npmArch}`);

// 7. Sync the rebuilt better-sqlite3 native module into the server bundle.
//    copy-standalone.mjs (step 5) captured the host-arch binary; overwrite it
//    with the target-arch binary so the sidecar Node process can load it.
copyFileSync(
  path.join(ROOT, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"),
  path.join(ROOT, "src-tauri/resources/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node")
);
console.log(`\n▶ Synced better-sqlite3 (${npmArch}) → server bundle`);

// 8. Remove musl-libc Sharp variants on Linux.
//    sharp ships separate native binaries for glibc (Ubuntu/Debian) and musl libc
//    (Alpine). Both land in the Next.js standalone bundle. On a glibc runner the
//    musl binaries have an unsatisfied dependency on libc.musl-x86_64.so.1, which
//    makes linuxdeploy abort with "Could not find dependency". Strip them out before
//    Tauri packages the AppDir.
if (process.platform === "linux") {
  const imgDir = path.join(ROOT, "src-tauri/resources/server/node_modules/@img");
  if (existsSync(imgDir)) {
    console.log("\n▶ Removing musl Sharp variants from server bundle");
    for (const pkg of readdirSync(imgDir)) {
      if (pkg.includes("musl")) {
        rmSync(path.join(imgDir, pkg), { recursive: true });
        console.log(`  removed: @img/${pkg}`);
      }
    }
  }
}

// 9. Tauri build — platform-specific bundle targets
//    macOS:   build .app only (we create the DMG manually to fix server/ first)
//    Windows: NSIS installer
//    Linux:   AppImage + deb.  appimagetool is itself an AppImage; CI runners
//             lack kernel FUSE support, so the workflow sets
//             APPIMAGE_EXTRACT_AND_RUN=1 to use extract-and-run mode instead.
//             --verbose is added on Linux so Tauri surfaces linuxdeploy's
//             captured output in the CI log when bundling fails.
const bundleFlag =
  process.platform === "darwin"  ? "--bundles app" :
  process.platform === "win32"   ? "--bundles nsis" :
  /* linux */                      "--bundles appimage,deb";

const verboseFlag = process.platform === "linux" ? "--verbose" : "";

const targetFlag = target ? `--target ${target}` : "";

// Strip empty Apple signing vars so Tauri skips code signing when secrets
// are not configured (GitHub Actions sets missing secrets to empty strings).
const tauriBuildEnv = { ...process.env };
for (const key of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
  if (!tauriBuildEnv[key]) delete tauriBuildEnv[key];
}

// Skip beforeBuildCommand — we already ran Next.js in step 5 (before the
// target-arch better-sqlite3 rebuild), so Tauri must not run it again.
// Write config to a file to avoid shell-quoting issues on Windows (PowerShell
// strips double quotes from inside single-quoted strings).
const overrideCfgPath = path.join(ROOT, ".tauri-build-override.json");
writeFileSync(overrideCfgPath, JSON.stringify({ build: { beforeBuildCommand: "" } }));
try {
  run(
    `npx tauri build ${targetFlag} ${bundleFlag} ${verboseFlag} --config .tauri-build-override.json`.replace(/\s+/g, " ").trim(),
    `tauri build ${targetFlag} ${bundleFlag}`.trim(),
    tauriBuildEnv
  );
} finally {
  unlinkSync(overrideCfgPath);
}

// 10. macOS: fix flattened server/ directory inside .app bundle
if (process.platform === "darwin") {
  run("node scripts/fix-app-bundle.mjs", "Fixing .app bundle server/ structure");
}

console.log("\n✓ tauri:build complete.");
