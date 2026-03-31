/**
 * create-user-db-template.ts
 *
 * Copies data/user.db → src-tauri/resources/user.db.template,
 * then wipes all user data rows and sets journal_mode = DELETE
 * so the template has no WAL/SHM sidecar files when bundled.
 *
 * Run: npm run build:template
 */

import Database from "better-sqlite3";
import { mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const ROOT        = process.cwd();
const SOURCE_DB   = path.join(ROOT, "data", "user.db");
const DEST_DIR    = path.join(ROOT, "src-tauri", "resources");
const DEST_DB     = path.join(DEST_DIR, "user.db.template");

if (!existsSync(SOURCE_DB)) {
  console.error("Error: data/user.db not found. Start the app once first to create it.");
  process.exit(1);
}

console.log("Creating user.db.template from data/user.db ...");
mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(SOURCE_DB, DEST_DB);

const db = new Database(DEST_DB);

// Switch to DELETE journal mode (no WAL files) before clearing data
db.pragma("journal_mode = DELETE");
db.pragma("synchronous = FULL");

// Get all user tables (exclude sqlite_* metadata)
const tables = (db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
).all() as { name: string }[]).map(r => r.name);

console.log(`Clearing ${tables.length} tables ...`);
db.transaction(() => {
  for (const table of tables) {
    db.prepare(`DELETE FROM "${table}"`).run();
    console.log(`  cleared: ${table}`);
  }

  // Reset all auto-increment sequences
  db.prepare("DELETE FROM sqlite_sequence").run();

  // Seed a default user and workspace (required for the app to function on first launch)
  try {
    db.prepare(
      "INSERT INTO users (id, name, email) VALUES (1, 'User', 'user@structura.app')"
    ).run();
    console.log("  seeded: users (id=1)");
    db.prepare(
      "INSERT INTO workspaces (id, user_id, name) VALUES (1, 1, 'Default')"
    ).run();
    console.log("  seeded: workspaces (id=1)");
  } catch (e) {
    console.warn("  Could not seed user/workspace:", (e as Error).message);
  }

  // Seed auto_backup_settings row
  try {
    db.prepare(
      "INSERT INTO auto_backup_settings (id) VALUES (1)"
    ).run();
    console.log("  seeded: auto_backup_settings (id=1)");
  } catch {
    // Table might not exist or already have a default
  }
})();

db.pragma("vacuum");
db.close();

console.log(`\n✓ Template saved to: ${DEST_DB}`);
