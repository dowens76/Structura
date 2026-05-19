/**
 * Migration: adds translation footnotes, version history, and isSmallCaps
 * to user.db.
 *
 * Run with: npx tsx scripts/migrate-add-translation-features.ts
 *
 * Safe to re-run — uses IF NOT EXISTS / ignores "column already exists" errors.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

function addColumnIfMissing(db: InstanceType<typeof Database>, table: string, column: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  Added column ${table}.${column}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate column name") || msg.includes("already exists")) {
      console.log(`  Column ${table}.${column} already exists — skipped`);
    } else {
      throw e;
    }
  }
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  console.log("Adding is_small_caps to word_formatting…");
  addColumnIfMissing(db, "word_formatting", "is_small_caps", "INTEGER NOT NULL DEFAULT 0");

  console.log("Creating translation_footnotes table…");
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_footnotes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    INTEGER NOT NULL DEFAULT 1,
      translation_id  INTEGER NOT NULL,
      osis_ref        TEXT NOT NULL,
      type            TEXT NOT NULL,
      content         TEXT NOT NULL,
      word_index      INTEGER NOT NULL DEFAULT 0,
      book            TEXT NOT NULL,
      chapter         INTEGER NOT NULL,
      verse           INTEGER NOT NULL,
      created_at      TEXT,
      FOREIGN KEY (workspace_id)   REFERENCES workspaces(id)   ON DELETE CASCADE,
      FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS tf_trans_book_ch_idx
      ON translation_footnotes(translation_id, book, chapter);
    CREATE INDEX IF NOT EXISTS tf_osis_ref_idx
      ON translation_footnotes(osis_ref);
  `);

  console.log("Creating translation_versions table…");
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_versions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    INTEGER NOT NULL DEFAULT 1,
      translation_id  INTEGER NOT NULL,
      osis_ref        TEXT NOT NULL,
      text            TEXT NOT NULL,
      label           TEXT,
      created_at      TEXT,
      FOREIGN KEY (workspace_id)   REFERENCES workspaces(id)   ON DELETE CASCADE,
      FOREIGN KEY (translation_id) REFERENCES translations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS tv_ver_trans_osis_idx
      ON translation_versions(translation_id, osis_ref);
    CREATE INDEX IF NOT EXISTS tv_ver_ws_trans_idx
      ON translation_versions(workspace_id, translation_id);
  `);

  db.close();
  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
