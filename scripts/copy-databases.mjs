/**
 * copy-databases.mjs
 *
 * Copies source databases from data/ into src-tauri/resources/databases/
 * using SQLite's online backup API, then converts each copy to DELETE
 * journal mode so no WAL sidecar files are needed.  This is required for
 * Linux AppImage where databases live on a read-only squashfs — SQLite
 * cannot create the WAL-index (.db-shm) on a read-only filesystem.
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
  "oshb.db",
  "sblgnt.db",
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
      : ["oshb.db","sblgnt.db"].includes(name)
        ? " Run: npm run import:oshb && npm run import:morphgnt && npm run generate:transliterations && npm run db:split-source"
        : " Run the import scripts first.";
    console.error(`ERROR: ${src} not found.${hint}`);
    process.exit(1);
  }

  process.stdout.write(`  ${name} ...`);
  const db = new Database(src, { readonly: true });
  await db.backup(dest);
  db.close();
  // The backup inherits WAL journal mode from the source. On Linux AppImage
  // the databases live on a read-only squashfs, so SQLite can't create the
  // WAL-index (.db-shm) file — converting to DELETE mode avoids this entirely.
  const destDb = new Database(dest);
  destDb.pragma("wal_checkpoint(TRUNCATE)");
  destDb.pragma("journal_mode=DELETE");
  // VACUUM reclaims free pages that the backup API copies verbatim from the
  // source (e.g. pages freed by a previous DELETE-and-reimport run).
  destDb.prepare("VACUUM").run();
  destDb.close();
  console.log(" done");
}

console.log(`\nDatabases copied to src-tauri/resources/databases/`);
