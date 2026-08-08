/**
 * migrate-add-versions.ts
 *
 * Adds the `versions` and `active_version_selections` tables, and a NOT NULL
 * `version_id` column to the 11 chapter-scoped markup tables (paragraph_breaks,
 * character_refs, speech_sections, word_tag_refs, line_indents, scene_breaks,
 * rst_relations, word_arrows, line_annotations, word_formatting,
 * text_critical_marks). One "Version 1" row is created per distinct
 * (workspace_id, book, chapter) locus found across those tables, and every
 * existing row is backfilled to point at its locus's "Version 1". Idempotent —
 * safe to run multiple times.
 *
 * Run with: npm run db:migrate:versions
 * Or against a specific file (e.g. the packaged Tauri app's separate DB —
 * see project_dual_user_db in memory): npm run db:migrate:versions -- /path/to/user.db
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.argv[2] ?? path.join(process.cwd(), "data", "user.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // Off during migration to avoid cascade issues

// ── Idempotency check ──────────────────────────────────────────────────────
const tableExists = (name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;

if (!tableExists("paragraph_breaks")) {
  console.log("✓ paragraph_breaks table not found — nothing to migrate (fresh db:push already has the final schema).");
  db.close();
  process.exit(0);
}

const cols = db.prepare("PRAGMA table_info(paragraph_breaks)").all() as { name: string }[];
const alreadyMigrated = cols.some((c) => c.name === "version_id");

if (alreadyMigrated) {
  console.log("✓ version_id already exists — migration already applied.");
  db.close();
  process.exit(0);
}

console.log("Starting version migration on", DB_PATH);

// The 11 versionable tables, in the order their rebuilds happen below.
const VERSIONABLE_TABLES = [
  "paragraph_breaks",
  "character_refs",
  "speech_sections",
  "word_tag_refs",
  "line_indents",
  "scene_breaks",
  "rst_relations",
  "word_arrows",
  "line_annotations",
  "word_formatting",
  "text_critical_marks",
];

db.transaction(() => {
  // ── 1. Create versions + active_version_selections tables ───────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      group_key    TEXT,
      created_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS ver_ws_book_ch_idx ON versions(workspace_id, book, chapter);
    CREATE INDEX IF NOT EXISTS ver_group_idx ON versions(group_key);

    CREATE TABLE IF NOT EXISTS active_version_selections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS avs_ws_book_ch_idx ON active_version_selections(workspace_id, book, chapter);
  `);
  console.log("✓ versions + active_version_selections tables created");

  // ── 2. Seed one "Version 1" per distinct (workspace_id, book, chapter)
  //      locus found across all 11 versionable tables ──────────────────────
  const unionSql = VERSIONABLE_TABLES
    .map((t) => `SELECT workspace_id, book, chapter FROM ${t}`)
    .join(" UNION ");
  db.exec(`
    INSERT INTO versions (workspace_id, book, chapter, name, sort_order)
    SELECT DISTINCT workspace_id, book, chapter, 'Version 1', 0 FROM (${unionSql});
  `);
  const versionCount = (db.prepare("SELECT COUNT(*) AS n FROM versions").get() as { n: number }).n;
  console.log(`✓ Seeded ${versionCount} "Version 1" rows (one per pre-existing locus)`);

  // ── 3. Rebuild each versionable table with a NOT NULL version_id ────────
  // Each old row's version_id is resolved via a correlated subquery against
  // the versions rows just seeded, matched on (workspace_id, book, chapter).

  // --- paragraph_breaks ---
  db.exec(`
    ALTER TABLE paragraph_breaks RENAME TO paragraph_breaks_old;
    DROP INDEX IF EXISTS pb_ws_word_idx;
    DROP INDEX IF EXISTS pb_book_ch_source_idx;
    CREATE TABLE paragraph_breaks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      created_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX pb_ws_word_idx ON paragraph_breaks(workspace_id, version_id, word_id);
    CREATE INDEX pb_book_ch_source_idx ON paragraph_breaks(book, chapter, text_source);
    INSERT INTO paragraph_breaks (id, workspace_id, version_id, word_id, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.text_source, o.book, o.chapter, o.created_at
      FROM paragraph_breaks_old o;
    DROP TABLE paragraph_breaks_old;
  `);
  console.log("✓ Reconstructed paragraph_breaks");

  // --- character_refs ---
  db.exec(`
    ALTER TABLE character_refs RENAME TO character_refs_old;
    DROP INDEX IF EXISTS cr_ws_word_idx;
    DROP INDEX IF EXISTS cr_book_ch_src_idx;
    CREATE TABLE character_refs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id    INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id       TEXT    NOT NULL,
      character1_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      character2_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      text_source   TEXT    NOT NULL,
      book          TEXT    NOT NULL,
      chapter       INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX cr_ws_word_idx ON character_refs(workspace_id, version_id, word_id);
    CREATE INDEX cr_book_ch_src_idx ON character_refs(book, chapter, text_source);
    INSERT INTO character_refs (id, workspace_id, version_id, word_id, character1_id, character2_id, text_source, book, chapter)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.character1_id, o.character2_id, o.text_source, o.book, o.chapter
      FROM character_refs_old o;
    DROP TABLE character_refs_old;
  `);
  console.log("✓ Reconstructed character_refs");

  // --- speech_sections ---
  db.exec(`
    ALTER TABLE speech_sections RENAME TO speech_sections_old;
    DROP INDEX IF EXISTS ss_book_ch_src_idx;
    CREATE TABLE speech_sections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id    INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      start_word_id TEXT    NOT NULL,
      end_word_id   TEXT    NOT NULL,
      text_source   TEXT    NOT NULL,
      book          TEXT    NOT NULL,
      chapter       INTEGER NOT NULL
    );
    CREATE INDEX ss_book_ch_src_idx ON speech_sections(book, chapter, text_source);
    INSERT INTO speech_sections (id, workspace_id, version_id, character_id, start_word_id, end_word_id, text_source, book, chapter)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.character_id, o.start_word_id, o.end_word_id, o.text_source, o.book, o.chapter
      FROM speech_sections_old o;
    DROP TABLE speech_sections_old;
  `);
  console.log("✓ Reconstructed speech_sections");

  // --- word_tag_refs ---
  db.exec(`
    ALTER TABLE word_tag_refs RENAME TO word_tag_refs_old;
    DROP INDEX IF EXISTS wtr_ws_word_idx;
    DROP INDEX IF EXISTS wtr_tag_id_idx;
    DROP INDEX IF EXISTS wtr_book_ch_idx;
    CREATE TABLE word_tag_refs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      tag_id       INTEGER NOT NULL REFERENCES word_tags(id) ON DELETE CASCADE,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX wtr_ws_word_idx ON word_tag_refs(workspace_id, version_id, word_id);
    CREATE INDEX wtr_tag_id_idx ON word_tag_refs(tag_id);
    CREATE INDEX wtr_book_ch_idx ON word_tag_refs(book, chapter);
    INSERT INTO word_tag_refs (id, workspace_id, version_id, word_id, tag_id, text_source, book, chapter)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.tag_id, o.text_source, o.book, o.chapter
      FROM word_tag_refs_old o;
    DROP TABLE word_tag_refs_old;
  `);
  console.log("✓ Reconstructed word_tag_refs");

  // --- line_indents ---
  db.exec(`
    ALTER TABLE line_indents RENAME TO line_indents_old;
    DROP INDEX IF EXISTS li_ws_word_idx;
    DROP INDEX IF EXISTS li_book_ch_idx;
    CREATE TABLE line_indents (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      indent_level INTEGER NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX li_ws_word_idx ON line_indents(workspace_id, version_id, word_id);
    CREATE INDEX li_book_ch_idx ON line_indents(book, chapter);
    INSERT INTO line_indents (id, workspace_id, version_id, word_id, indent_level, text_source, book, chapter)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.indent_level, o.text_source, o.book, o.chapter
      FROM line_indents_old o;
    DROP TABLE line_indents_old;
  `);
  console.log("✓ Reconstructed line_indents");

  // --- scene_breaks ---
  db.exec(`
    ALTER TABLE scene_breaks RENAME TO scene_breaks_old;
    DROP INDEX IF EXISTS sb_book_ch_src_idx;
    DROP INDEX IF EXISTS sb_ws_word_level_idx;
    CREATE TABLE scene_breaks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id     INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id       INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id          TEXT    NOT NULL,
      heading          TEXT,
      level            INTEGER NOT NULL DEFAULT 1,
      verse            INTEGER NOT NULL DEFAULT 0,
      out_of_sequence  INTEGER NOT NULL DEFAULT 0,
      extended_through INTEGER,
      thematic         INTEGER NOT NULL DEFAULT 0,
      thematic_letter  TEXT,
      transitional     INTEGER NOT NULL DEFAULT 0,
      text_source      TEXT    NOT NULL,
      book             TEXT    NOT NULL,
      chapter          INTEGER NOT NULL,
      created_at       TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX sb_book_ch_src_idx ON scene_breaks(book, chapter, text_source);
    CREATE UNIQUE INDEX sb_ws_word_level_idx ON scene_breaks(workspace_id, version_id, word_id, level);
    INSERT INTO scene_breaks (id, workspace_id, version_id, word_id, heading, level, verse, out_of_sequence, extended_through, thematic, thematic_letter, transitional, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.heading, o.level, o.verse, o.out_of_sequence, o.extended_through, o.thematic, o.thematic_letter, o.transitional, o.text_source, o.book, o.chapter, o.created_at
      FROM scene_breaks_old o;
    DROP TABLE scene_breaks_old;
  `);
  console.log("✓ Reconstructed scene_breaks");

  // --- rst_relations ---
  db.exec(`
    ALTER TABLE rst_relations RENAME TO rst_relations_old;
    DROP INDEX IF EXISTS rst_book_ch_src_idx;
    DROP INDEX IF EXISTS rst_group_idx;
    CREATE TABLE rst_relations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id      INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      group_id        TEXT    NOT NULL,
      seg_word_id     TEXT    NOT NULL,
      role            TEXT    NOT NULL,
      rel_type        TEXT    NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      intersect_point TEXT    NOT NULL DEFAULT 'mid',
      text_source     TEXT    NOT NULL,
      book            TEXT    NOT NULL,
      chapter         INTEGER NOT NULL,
      created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX rst_book_ch_src_idx ON rst_relations(book, chapter, text_source);
    CREATE INDEX rst_group_idx ON rst_relations(group_id);
    INSERT INTO rst_relations (id, workspace_id, version_id, group_id, seg_word_id, role, rel_type, sort_order, intersect_point, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.group_id, o.seg_word_id, o.role, o.rel_type, o.sort_order, o.intersect_point, o.text_source, o.book, o.chapter, o.created_at
      FROM rst_relations_old o;
    DROP TABLE rst_relations_old;
  `);
  console.log("✓ Reconstructed rst_relations");

  // --- word_arrows ---
  db.exec(`
    ALTER TABLE word_arrows RENAME TO word_arrows_old;
    DROP INDEX IF EXISTS wa_book_ch_src_idx;
    CREATE TABLE word_arrows (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      from_word_id TEXT    NOT NULL,
      to_word_id   TEXT    NOT NULL,
      label        TEXT,
      color        TEXT,
      midpoint_dx  REAL,
      midpoint_dy  REAL,
      midpoint2_dx REAL,
      midpoint2_dy REAL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      created_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX wa_book_ch_src_idx ON word_arrows(book, chapter, text_source);
    INSERT INTO word_arrows (id, workspace_id, version_id, from_word_id, to_word_id, label, color, midpoint_dx, midpoint_dy, midpoint2_dx, midpoint2_dy, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.from_word_id, o.to_word_id, o.label, o.color, o.midpoint_dx, o.midpoint_dy, o.midpoint2_dx, o.midpoint2_dy, o.text_source, o.book, o.chapter, o.created_at
      FROM word_arrows_old o;
    DROP TABLE word_arrows_old;
  `);
  console.log("✓ Reconstructed word_arrows");

  // --- line_annotations ---
  db.exec(`
    ALTER TABLE line_annotations RENAME TO line_annotations_old;
    DROP INDEX IF EXISTS la_book_ch_src_idx;
    CREATE TABLE line_annotations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id      INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      annot_type      TEXT    NOT NULL,
      label           TEXT    NOT NULL,
      comm_function   TEXT,
      color           TEXT    NOT NULL,
      description     TEXT,
      out_of_sequence INTEGER NOT NULL DEFAULT 0,
      transitional    INTEGER NOT NULL DEFAULT 0,
      start_word_id   TEXT    NOT NULL,
      end_word_id     TEXT    NOT NULL,
      text_source     TEXT    NOT NULL,
      book            TEXT    NOT NULL,
      chapter         INTEGER NOT NULL,
      created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX la_book_ch_src_idx ON line_annotations(book, chapter, text_source);
    INSERT INTO line_annotations (id, workspace_id, version_id, annot_type, label, comm_function, color, description, out_of_sequence, transitional, start_word_id, end_word_id, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.annot_type, o.label, o.comm_function, o.color, o.description, o.out_of_sequence, o.transitional, o.start_word_id, o.end_word_id, o.text_source, o.book, o.chapter, o.created_at
      FROM line_annotations_old o;
    DROP TABLE line_annotations_old;
  `);
  console.log("✓ Reconstructed line_annotations");

  // --- word_formatting ---
  db.exec(`
    ALTER TABLE word_formatting RENAME TO word_formatting_old;
    DROP INDEX IF EXISTS wfmt_ws_word_idx;
    DROP INDEX IF EXISTS wfmt_book_ch_idx;
    CREATE TABLE word_formatting (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id  INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id    INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id       TEXT    NOT NULL,
      is_bold       INTEGER NOT NULL DEFAULT 0,
      is_italic     INTEGER NOT NULL DEFAULT 0,
      is_small_caps INTEGER NOT NULL DEFAULT 0,
      text_source   TEXT    NOT NULL,
      book          TEXT    NOT NULL,
      chapter       INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX wfmt_ws_word_idx ON word_formatting(workspace_id, version_id, word_id);
    CREATE INDEX wfmt_book_ch_idx ON word_formatting(book, chapter);
    INSERT INTO word_formatting (id, workspace_id, version_id, word_id, is_bold, is_italic, is_small_caps, text_source, book, chapter)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.is_bold, o.is_italic, o.is_small_caps, o.text_source, o.book, o.chapter
      FROM word_formatting_old o;
    DROP TABLE word_formatting_old;
  `);
  console.log("✓ Reconstructed word_formatting");

  // --- text_critical_marks ---
  db.exec(`
    ALTER TABLE text_critical_marks RENAME TO text_critical_marks_old;
    DROP INDEX IF EXISTS tcm_ws_word_idx;
    DROP INDEX IF EXISTS tcm_book_ch_idx;
    CREATE TABLE text_critical_marks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      mark_type    TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      created_at   TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE UNIQUE INDEX tcm_ws_word_idx ON text_critical_marks(workspace_id, version_id, word_id);
    CREATE INDEX tcm_book_ch_idx ON text_critical_marks(book, chapter);
    INSERT INTO text_critical_marks (id, workspace_id, version_id, word_id, mark_type, text_source, book, chapter, created_at)
      SELECT o.id, o.workspace_id,
             (SELECT v.id FROM versions v WHERE v.workspace_id = o.workspace_id AND v.book = o.book AND v.chapter = o.chapter),
             o.word_id, o.mark_type, o.text_source, o.book, o.chapter, o.created_at
      FROM text_critical_marks_old o;
    DROP TABLE text_critical_marks_old;
  `);
  console.log("✓ Reconstructed text_critical_marks");
})();

db.exec("VACUUM");
console.log("✓ VACUUM complete");

db.pragma("foreign_keys = ON");
db.close();

console.log("\n✅ Version migration complete.");
