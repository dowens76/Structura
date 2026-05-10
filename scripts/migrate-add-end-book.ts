/**
 * One-time migration: adds the `end_book` column to the passages table.
 *
 * Run with: npx tsx scripts/migrate-add-end-book.ts
 *
 * Safe to re-run — uses IF NOT EXISTS (SQLite ALTER TABLE is idempotent here
 * because we catch the "duplicate column" error).
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

async function main() {
  const db = new Database(DB_PATH);

  try {
    db.exec(`ALTER TABLE passages ADD COLUMN end_book TEXT`);
    console.log("Added end_book column to passages table.");
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate column")) {
      console.log("Column end_book already exists — skipping.");
    } else {
      throw err;
    }
  }

  db.close();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
