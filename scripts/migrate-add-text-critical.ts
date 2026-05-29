import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

async function main() {
  const db = new Database(DB_PATH);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='text_critical_marks'"
  ).all();

  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE text_critical_marks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL DEFAULT 1,
        word_id      TEXT NOT NULL,
        mark_type    TEXT NOT NULL,
        text_source  TEXT NOT NULL,
        book         TEXT NOT NULL,
        chapter      INTEGER NOT NULL,
        created_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(workspace_id, word_id)
      );
      CREATE INDEX tcm_book_ch_idx ON text_critical_marks(book, chapter);
    `);
    console.log("✓ Created text_critical_marks table");
  } else {
    console.log("· text_critical_marks already exists");
  }

  db.close();
  console.log("Migration complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
