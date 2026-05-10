/**
 * One-time migration: creates the `app_settings` table in user.db.
 *
 * Run with: npx tsx scripts/migrate-add-app-settings.ts
 *
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

async function main() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log("app_settings table created (or already existed).");
  db.close();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
