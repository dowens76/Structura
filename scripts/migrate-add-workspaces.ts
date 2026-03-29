/**
 * migrate-add-workspaces.ts
 *
 * Adds users + workspaces tables to user.db and adds workspace_id to all 19
 * annotation tables. Idempotent — safe to run multiple times.
 *
 * Run with: npm run db:migrate:workspaces
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "user.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // Off during migration to avoid cascade issues

// ── Idempotency check ──────────────────────────────────────────────────────
const cols = db
  .prepare("PRAGMA table_info(paragraph_breaks)")
  .all() as { name: string }[];
const alreadyMigrated = cols.some((c) => c.name === "workspace_id");

if (alreadyMigrated) {
  console.log("✓ workspace_id already exists — migration already applied.");
  db.close();
  process.exit(0);
}

console.log("Starting workspace migration on", DB_PATH);

db.transaction(() => {
  // ── 1. Create users table ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      email      TEXT    NOT NULL UNIQUE,
      created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
  `);
  console.log("✓ users table created (or already exists)");

  // ── 2. Create workspaces table ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS workspaces_user_idx ON workspaces(user_id);
  `);
  console.log("✓ workspaces table created (or already exists)");

  // ── 3. Seed default user + workspace ─────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'Default User', 'user@local');
    INSERT OR IGNORE INTO workspaces (id, user_id, name) VALUES (1, 1, 'Default');
  `);
  console.log("✓ Default user and workspace seeded");

  // ── 4. Simple ADD COLUMN tables (no unique-constraint change) ─────────
  // These tables just get workspace_id added with DEFAULT 1; no unique indexes change.
  const simpleAddTables: string[] = [
    "translation_verses",
    "characters",
    "speech_sections",
    "word_tags",
    "passages",
    "clause_relationships",
    "rst_relations",
    "word_arrows",
    "line_annotations",
  ];

  for (const tbl of simpleAddTables) {
    db.exec(`
      ALTER TABLE ${tbl}
        ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1
          REFERENCES workspaces(id) ON DELETE CASCADE;
    `);
    console.log(`✓ Added workspace_id to ${tbl}`);
  }

  // translations needs ADD COLUMN too (unique constraint reconstructed below)
  db.exec(`
    ALTER TABLE translations
      ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1
        REFERENCES workspaces(id) ON DELETE CASCADE;
  `);
  console.log("✓ Added workspace_id to translations");

  // ── 5. Full table reconstruction for unique-constraint changes ─────────
  // For each table: rename → create new → copy → drop old

  // --- paragraph_breaks ---
  db.exec(`
    ALTER TABLE paragraph_breaks RENAME TO paragraph_breaks_old;
    DROP INDEX IF EXISTS pb_book_ch_source_idx;
    CREATE TABLE paragraph_breaks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      created_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX pb_ws_word_idx ON paragraph_breaks(workspace_id, word_id);
    CREATE INDEX pb_book_ch_source_idx ON paragraph_breaks(book, chapter, text_source);
    INSERT INTO paragraph_breaks (id, workspace_id, word_id, text_source, book, chapter, created_at)
      SELECT id, 1, word_id, text_source, book, chapter, created_at FROM paragraph_breaks_old;
    DROP TABLE paragraph_breaks_old;
  `);
  console.log("✓ Reconstructed paragraph_breaks");

  // --- character_refs ---
  db.exec(`
    ALTER TABLE character_refs RENAME TO character_refs_old;
    DROP INDEX IF EXISTS cr_book_ch_src_idx;
    CREATE TABLE character_refs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id       TEXT    NOT NULL,
      character1_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      character2_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      text_source   TEXT    NOT NULL,
      book          TEXT    NOT NULL,
      chapter       INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX cr_ws_word_idx ON character_refs(workspace_id, word_id);
    CREATE INDEX cr_book_ch_src_idx ON character_refs(book, chapter, text_source);
    INSERT INTO character_refs (id, workspace_id, word_id, character1_id, character2_id, text_source, book, chapter)
      SELECT id, 1, word_id, character1_id, character2_id, text_source, book, chapter FROM character_refs_old;
    DROP TABLE character_refs_old;
  `);
  console.log("✓ Reconstructed character_refs");

  // --- word_tag_refs ---
  db.exec(`
    ALTER TABLE word_tag_refs RENAME TO word_tag_refs_old;
    DROP INDEX IF EXISTS wtr_tag_id_idx;
    DROP INDEX IF EXISTS wtr_book_ch_idx;
    CREATE TABLE word_tag_refs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      tag_id       INTEGER NOT NULL REFERENCES word_tags(id) ON DELETE CASCADE,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX wtr_ws_word_idx ON word_tag_refs(workspace_id, word_id);
    CREATE INDEX wtr_tag_id_idx ON word_tag_refs(tag_id);
    CREATE INDEX wtr_book_ch_idx ON word_tag_refs(book, chapter);
    INSERT INTO word_tag_refs (id, workspace_id, word_id, tag_id, text_source, book, chapter)
      SELECT id, 1, word_id, tag_id, text_source, book, chapter FROM word_tag_refs_old;
    DROP TABLE word_tag_refs_old;
  `);
  console.log("✓ Reconstructed word_tag_refs");

  // --- line_indents ---
  db.exec(`
    ALTER TABLE line_indents RENAME TO line_indents_old;
    DROP INDEX IF EXISTS li_book_ch_idx;
    CREATE TABLE line_indents (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      indent_level INTEGER NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX li_ws_word_idx ON line_indents(workspace_id, word_id);
    CREATE INDEX li_book_ch_idx ON line_indents(book, chapter);
    INSERT INTO line_indents (id, workspace_id, word_id, indent_level, text_source, book, chapter)
      SELECT id, 1, word_id, indent_level, text_source, book, chapter FROM line_indents_old;
    DROP TABLE line_indents_old;
  `);
  console.log("✓ Reconstructed line_indents");

  // --- word_formatting ---
  db.exec(`
    ALTER TABLE word_formatting RENAME TO word_formatting_old;
    DROP INDEX IF EXISTS wfmt_book_ch_idx;
    CREATE TABLE word_formatting (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      is_bold      INTEGER NOT NULL DEFAULT 0,
      is_italic    INTEGER NOT NULL DEFAULT 0,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX wfmt_ws_word_idx ON word_formatting(workspace_id, word_id);
    CREATE INDEX wfmt_book_ch_idx ON word_formatting(book, chapter);
    INSERT INTO word_formatting (id, workspace_id, word_id, is_bold, is_italic, text_source, book, chapter)
      SELECT id, 1, word_id, is_bold, is_italic, text_source, book, chapter FROM word_formatting_old;
    DROP TABLE word_formatting_old;
  `);
  console.log("✓ Reconstructed word_formatting");

  // --- scene_breaks ---
  db.exec(`
    ALTER TABLE scene_breaks RENAME TO scene_breaks_old;
    DROP INDEX IF EXISTS sb_book_ch_src_idx;
    DROP INDEX IF EXISTS sb_word_level_idx;
    CREATE TABLE scene_breaks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id     INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id          TEXT    NOT NULL,
      heading          TEXT,
      level            INTEGER NOT NULL DEFAULT 1,
      verse            INTEGER NOT NULL DEFAULT 0,
      out_of_sequence  INTEGER NOT NULL DEFAULT 0,
      extended_through INTEGER,
      text_source      TEXT    NOT NULL,
      book             TEXT    NOT NULL,
      chapter          INTEGER NOT NULL,
      created_at       TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX sb_book_ch_src_idx ON scene_breaks(book, chapter, text_source);
    CREATE UNIQUE INDEX sb_ws_word_level_idx ON scene_breaks(workspace_id, word_id, level);
    INSERT INTO scene_breaks (id, workspace_id, word_id, heading, level, verse, out_of_sequence, extended_through, text_source, book, chapter, created_at)
      SELECT id, 1, word_id, heading, level, verse, out_of_sequence, extended_through, text_source, book, chapter, created_at FROM scene_breaks_old;
    DROP TABLE scene_breaks_old;
  `);
  console.log("✓ Reconstructed scene_breaks");

  // --- notes ---
  db.exec(`
    ALTER TABLE notes RENAME TO notes_old;
    DROP INDEX IF EXISTS notes_book_ch_idx;
    CREATE TABLE notes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      note_type    TEXT    NOT NULL,
      content      TEXT    NOT NULL DEFAULT '{}',
      book         TEXT,
      chapter      INTEGER,
      updated_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX notes_ws_key_idx ON notes(workspace_id, key);
    CREATE INDEX notes_book_ch_idx ON notes(book, chapter);
    INSERT INTO notes (id, workspace_id, key, note_type, content, book, chapter, updated_at)
      SELECT id, 1, key, note_type, content, book, chapter, updated_at FROM notes_old;
    DROP TABLE notes_old;
  `);
  console.log("✓ Reconstructed notes");

  // --- rst_custom_types ---
  db.exec(`
    ALTER TABLE rst_custom_types RENAME TO rst_custom_types_old;
    CREATE TABLE rst_custom_types (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      label        TEXT    NOT NULL,
      abbr         TEXT    NOT NULL,
      color        TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX rct_ws_key_idx ON rst_custom_types(workspace_id, key);
    INSERT INTO rst_custom_types (id, workspace_id, key, label, abbr, color, category, sort_order)
      SELECT id, 1, key, label, abbr, color, category, sort_order FROM rst_custom_types_old;
    DROP TABLE rst_custom_types_old;
  `);
  console.log("✓ Reconstructed rst_custom_types");

  // --- translations unique constraint update ---
  // (workspace_id column already added above via ALTER TABLE)
  db.exec(`
    ALTER TABLE translations RENAME TO translations_old;
    CREATE TABLE translations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      abbreviation TEXT    NOT NULL,
      language     TEXT,
      created_at   INTEGER
    );
    CREATE UNIQUE INDEX trans_ws_abbr_idx ON translations(workspace_id, abbreviation);
    INSERT INTO translations (id, workspace_id, name, abbreviation, language, created_at)
      SELECT id, 1, name, abbreviation, language, created_at FROM translations_old;
    DROP TABLE translations_old;
  `);
  console.log("✓ Reconstructed translations");

})();

db.exec("VACUUM");
console.log("✓ VACUUM complete");

db.pragma("foreign_keys = ON");
db.close();

console.log("\n✅ Workspace migration complete.");
