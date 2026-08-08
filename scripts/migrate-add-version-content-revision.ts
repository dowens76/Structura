/**
 * migrate-add-version-content-revision.ts
 *
 * Adds a `content_revision` column to `versions`, bumped by
 * copyVersionAnnotations whenever a copy overwrites a version's markup — lets
 * the chapter/passage pages force a ChapterDisplay remount when a copy
 * targets the version currently being viewed (same versionId, so the normal
 * remount key wouldn't otherwise change). Idempotent — safe to run multiple
 * times.
 *
 * Run with: npm run db:migrate:version-content-revision
 * Or against a specific file (e.g. the packaged Tauri app's separate DB —
 * see project_dual_user_db in memory): npm run db:migrate:version-content-revision -- /path/to/user.db
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.argv[2] ?? path.join(process.cwd(), "data", "user.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const tableExists = (name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;

if (!tableExists("versions")) {
  console.log("✓ versions table not found — nothing to migrate (fresh db:push already has the final schema).");
  db.close();
  process.exit(0);
}

const cols = db.prepare("PRAGMA table_info(versions)").all() as { name: string }[];
const alreadyMigrated = cols.some((c) => c.name === "content_revision");

if (alreadyMigrated) {
  console.log("✓ content_revision already exists — migration already applied.");
  db.close();
  process.exit(0);
}

db.exec("ALTER TABLE versions ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;");
console.log("✓ Added content_revision to versions");

db.close();
console.log("\n✅ Migration complete.");
