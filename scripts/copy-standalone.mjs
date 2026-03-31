/**
 * copy-standalone.mjs
 * Copies the Next.js standalone output into src-tauri/resources/server/
 * so Tauri can bundle it.
 *
 * Run automatically as part of: npm run build:next
 */
import { cpSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SRC_STANDALONE = path.join(ROOT, ".next", "standalone");
const SRC_STATIC     = path.join(ROOT, ".next", "static");
const SRC_PUBLIC     = path.join(ROOT, "public");
const DEST           = path.join(ROOT, "src-tauri", "resources", "server");

if (!existsSync(SRC_STANDALONE)) {
  console.error("ERROR: .next/standalone not found. Run `next build` first.");
  process.exit(1);
}

console.log("Copying standalone build to src-tauri/resources/server/ ...");

// Clear previous copy
if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}
mkdirSync(DEST, { recursive: true });

// 1. Copy standalone server (excluding the `data/` directory which Next.js
//    traces but is not needed at runtime — databases are passed via env vars)
cpSync(SRC_STANDALONE, DEST, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(SRC_STANDALONE, src);
    // Exclude data/ (databases + import source files — handled via env vars)
    if (rel === "data" || rel.startsWith("data" + path.sep)) return false;
    // Exclude src-tauri/ (Rust build artifacts accidentally traced by Next.js)
    if (rel === "src-tauri" || rel.startsWith("src-tauri" + path.sep)) return false;
    return true;
  },
});
console.log("  ✓ .next/standalone → server/ (data/ and src-tauri/ excluded)");

// 2. Copy static assets into the right location for the standalone server
const destStatic = path.join(DEST, ".next", "static");
mkdirSync(path.dirname(destStatic), { recursive: true });
cpSync(SRC_STATIC, destStatic, { recursive: true });
console.log("  ✓ .next/static     → server/.next/static/");

// 3. Copy public folder
if (existsSync(SRC_PUBLIC)) {
  const destPublic = path.join(DEST, "public");
  cpSync(SRC_PUBLIC, destPublic, { recursive: true });
  console.log("  ✓ public/          → server/public/");
}

console.log("\nDone. src-tauri/resources/server/ is ready for bundling.");
