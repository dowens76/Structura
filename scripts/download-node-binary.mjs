#!/usr/bin/env node
/**
 * download-node-binary.mjs
 *
 * Cross-platform replacement for download-node-binary.sh
 * Downloads a Node.js 24 LTS binary for the current Rust target triple
 * and places it at src-tauri/binaries/node-<triple>[.exe]
 *
 * Node 24 is required to match NODE_MODULE_VERSION 137 used by better-sqlite3.
 *
 * Run: npm run build:node-binary
 */
import { execSync } from "child_process";
import { existsSync, mkdirSync, createWriteStream, copyFileSync, chmodSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const NODE_VERSION = "24.14.1";
const ROOT         = dirname(dirname(fileURLToPath(import.meta.url)));
const BINARIES_DIR = join(ROOT, "src-tauri", "binaries");

mkdirSync(BINARIES_DIR, { recursive: true });

// ── Detect Rust target triple ─────────────────────────────────────────────────
// TAURI_BUILD_TARGET takes precedence (set by CI for cross-compilation).
let triple = process.env.TAURI_BUILD_TARGET;
if (!triple) {
  try {
    const out = execSync("rustc -vV", { encoding: "utf-8" });
    triple = out.split("\n").find(l => l.startsWith("host:"))?.split(": ")[1]?.trim();
  } catch {
    console.error("Error: rustc not found. Install Rust from https://rustup.rs");
    process.exit(1);
  }
  if (!triple) {
    console.error("Error: could not detect Rust target triple from rustc -vV");
    process.exit(1);
  }
}

// ── Map Rust triple → Node.js platform / arch / archive ext ──────────────────
const TRIPLES = {
  "aarch64-apple-darwin":      { platform: "darwin", arch: "arm64", ext: "tar.gz" },
  "x86_64-apple-darwin":       { platform: "darwin", arch: "x64",   ext: "tar.gz" },
  "x86_64-pc-windows-msvc":    { platform: "win",    arch: "x64",   ext: "zip"    },
  "i686-pc-windows-msvc":      { platform: "win",    arch: "x86",   ext: "zip"    },
  "aarch64-pc-windows-msvc":   { platform: "win",    arch: "arm64", ext: "zip"    },
  "x86_64-unknown-linux-gnu":  { platform: "linux",  arch: "x64",   ext: "tar.gz" },
  "aarch64-unknown-linux-gnu": { platform: "linux",  arch: "arm64", ext: "tar.gz" },
};

const mapping = TRIPLES[triple];
if (!mapping) {
  console.error(`Error: unsupported Rust target triple: ${triple}`);
  process.exit(1);
}

const { platform, arch, ext } = mapping;
const isWindows  = platform === "win";
const outputPath = join(BINARIES_DIR, `node-${triple}${isWindows ? ".exe" : ""}`);

if (existsSync(outputPath)) {
  console.log(`Node binary already exists: ${outputPath}`);
  process.exit(0);
}

const basename = `node-v${NODE_VERSION}-${platform}-${arch}`;
const url      = `https://nodejs.org/dist/v${NODE_VERSION}/${basename}.${ext}`;
const tmpDir   = join(tmpdir(), `node-dl-${randomBytes(8).toString("hex")}`);
mkdirSync(tmpDir, { recursive: true });
const archivePath = join(tmpDir, `node.${ext}`);

console.log(`Downloading Node.js ${NODE_VERSION} for ${triple}...`);
console.log(`  URL: ${url}`);

// ── Download ──────────────────────────────────────────────────────────────────
const res = await fetch(url);
if (!res.ok) {
  console.error(`HTTP ${res.status} fetching ${url}`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(archivePath));

// ── Extract ───────────────────────────────────────────────────────────────────
if (ext === "tar.gz") {
  execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`);
  const nodeBin = join(tmpDir, basename, "bin", "node");
  copyFileSync(nodeBin, outputPath);
  chmodSync(outputPath, 0o755);
} else {
  // Windows .zip — tar on Windows 10+ (bsdtar) can extract zip archives
  execSync(`tar -xf "${archivePath}" -C "${tmpDir}"`);
  const nodeBin = join(tmpDir, basename, "node.exe");
  copyFileSync(nodeBin, outputPath);
}

rmSync(tmpDir, { recursive: true, force: true });

console.log(`Node binary saved to: ${outputPath}`);
