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

// Required DBs — build fails if any are absent.
const REQUIRED_DBS = [
  "source.db",
  // Per-lexicon DBs — created by running individual import scripts or
  // by splitting the legacy combined DB:  npm run db:split:lexica
  "bdb.db",
  "strongs-hebrew.db",
  "dodson.db",
  "abbott-smith.db",
  "lsj.db",
  "lxx.db",
];

// Optional DBs — copied only when present; not an error if absent.
const OPTIONAL_DBS = ["ult.db", "vcb.db"];

const DBS = [...REQUIRED_DBS, ...OPTIONAL_DBS];

for (const name of DBS) {
  const src  = path.join(DATA_DIR, name);
  const dest = path.join(DEST_DIR, name);

  if (!existsSync(src)) {
    if (OPTIONAL_DBS.includes(name)) {
      console.log(`  ${name} ... skipped (not found)`);
      continue;
    }
    const hint = ["bdb.db","strongs-hebrew.db","dodson.db","abbott-smith.db","lsj.db"].includes(name)
      ? " Run the import scripts (npm run import:lexicon) or split the legacy DB (npm run db:split:lexica)."
      : " Run the import scripts first.";
    console.error(`ERROR: ${src} not found.${hint}`);
    process.exit(1);
  }

  process.stdout.write(`  ${name} ...`);
  const db = new Database(src, { readonly: true });
  await db.backup(dest);
  db.close();
  console.log(" done");
}

console.log(`\nDatabases copied to src-tauri/resources/databases/`);
