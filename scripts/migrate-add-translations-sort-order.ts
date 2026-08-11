/**
 * migrate-add-translations-sort-order.ts
 *
 * Adds `sort_order` to `translations` (used by the "reorder translations"
 * feature). This column was previously only synced to the dev DB via
 * `db:push`, never via a checked-in migration script, so the packaged Tauri
 * app's separate database (see project_dual_user_db in memory) never picked
 * it up. Idempotent — safe to run multiple times.
 *
 * Run with: npx tsx scripts/migrate-add-translations-sort-order.ts
 * Or against a specific file (e.g. the packaged Tauri app's DB):
 *   npx tsx scripts/migrate-add-translations-sort-order.ts /path/to/user.db
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.argv[2] ?? path.join(process.cwd(), "data", "user.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const cols = db.prepare("PRAGMA table_info(translations)").all() as { name: string }[];
const alreadyMigrated = cols.some((c) => c.name === "sort_order");

if (alreadyMigrated) {
  console.log("✓ sort_order already exists on translations — migration already applied.");
} else {
  db.exec("ALTER TABLE translations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;");
  console.log("✓ Added sort_order to translations");
}

db.close();
console.log("\n✅ Migration complete.");
