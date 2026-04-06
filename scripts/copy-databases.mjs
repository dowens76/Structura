/**
 * copy-databases.mjs
 *
 * Copies source databases from data/ into src-tauri/resources/databases/
 * using SQLite's online backup API so each copy is fully checkpointed
 * (no WAL sidecar needed) and safe to bundle.
 *
 * Run automatically as part of: npm run tauri:build
 */
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT     = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data");
const DEST_DIR = path.join(ROOT, "src-tauri", "resources", "databases");

mkdirSync(DEST_DIR, { recursive: true });

const DBS = ["source.db", "lexica.db", "lxx.db", "ult.db"];

for (const name of DBS) {
  const src  = path.join(DATA_DIR, name);
  const dest = path.join(DEST_DIR, name);

  if (!existsSync(src)) {
    console.error(`ERROR: ${src} not found. Run the import scripts first.`);
    process.exit(1);
  }

  process.stdout.write(`  ${name} ...`);
  const db = new Database(src, { readonly: true });
  await db.backup(dest);
  db.close();
  console.log(" done");
}

console.log(`\nDatabases copied to src-tauri/resources/databases/`);
