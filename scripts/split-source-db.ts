/**
 * Splits source.db into per-source databases: oshb.db and sblgnt.db.
 *
 * Each output DB keeps all books and lookup tables, but only the words/verses
 * rows belonging to that source.  This keeps the schema identical (indexes,
 * constraints) while reducing file size so each stays under GitHub's 100 MB limit.
 *
 * Run once: npm run db:split-source
 * After verifying the app works, remove source.db from git tracking.
 */

import Database from "better-sqlite3";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const SRC_PATH = path.join(DATA_DIR, "source.db");

const TARGETS: { value: string; file: string }[] = [
  { value: "OSHB",   file: "oshb.db"   },
  { value: "SBLGNT", file: "sblgnt.db" },
];

async function splitOne(srcPath: string, targetValue: string, destFile: string) {
  const destPath = path.join(DATA_DIR, destFile);

  if (fs.existsSync(destPath)) {
    console.log(`  ${destFile} already exists — skipping (delete it first to re-run).`);
    return;
  }

  console.log(`  Opening ${path.basename(srcPath)} ...`);
  const src = new Database(srcPath, { readonly: true });

  // Resolve the integer text_source_id for this source value
  const tsRow = src.prepare("SELECT id FROM text_sources WHERE value = ?").get(targetValue) as { id: number } | undefined;
  if (!tsRow) {
    src.close();
    throw new Error(`text_sources row not found for value="${targetValue}"`);
  }
  const tsId = tsRow.id;
  src.close();

  // Use sqlite3 CLI .clone to copy table-by-table (avoids WAL/corruption issues
  // that prevent VACUUM INTO from working on a live WAL-mode database).
  console.log(`  Cloning ${path.basename(srcPath)} → ${destFile} ...`);
  execSync(`sqlite3 "${srcPath}" ".clone '${destPath}'"`, { stdio: "inherit" });

  console.log(`  Filtering ${destFile} to ${targetValue} only ...`);
  const dest = new Database(destPath);
  dest.pragma("foreign_keys = OFF");

  // Delete words and verses that belong to other sources
  const deletedWords = dest.prepare("DELETE FROM words WHERE text_source_id != ?").run(tsId);
  const deletedVerses = dest.prepare("DELETE FROM verses WHERE text_source != ?").run(targetValue);

  dest.exec("VACUUM");
  dest.close();

  const size = fs.statSync(destPath).size;
  const sizeMb = (size / 1024 / 1024).toFixed(1);
  console.log(`  ${destFile} ready — ${sizeMb} MB (removed ${deletedWords.changes} words, ${deletedVerses.changes} verses)`);
}

async function main() {
  if (!fs.existsSync(SRC_PATH)) {
    console.error(`Error: ${SRC_PATH} not found.`);
    process.exit(1);
  }

  console.log(`Splitting ${path.basename(SRC_PATH)} into per-source databases...\n`);

  for (const { value, file } of TARGETS) {
    await splitOne(SRC_PATH, value, file);
  }

  console.log("\nDone.");
  console.log("Next steps:");
  console.log("  1. Start the dev server and verify Gen 1 (OSHB) and Matt 1 (SBLGNT) load correctly.");
  console.log("  2. Remove source.db from git: git rm --cached data/source.db && echo 'data/source.db' >> .gitignore");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
