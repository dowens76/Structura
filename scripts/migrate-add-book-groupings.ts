/**
 * One-time migration: creates the `book_groupings` table in user.db.
 *
 * Run with: npx tsx scripts/migrate-add-book-groupings.ts
 *
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

async function main() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS book_groupings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      books        TEXT    NOT NULL DEFAULT '[]',
      features     TEXT    NOT NULL DEFAULT '[]',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS bg_ws_idx ON book_groupings(workspace_id);
  `);

  console.log("book_groupings table created (or already existed).");
  db.close();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
