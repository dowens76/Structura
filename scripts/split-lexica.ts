/**
 * Split lexica.db into per-lexicon database files.
 *
 * Creates individual DB files from the combined lexica.db:
 *   bdb.db            ← source = "BDB"
 *   strongs-hebrew.db ← source = "HebrewStrong"
 *   dodson.db         ← source = "Dodson"
 *   abbott-smith.db   ← source = "AbbottSmith"
 *   lsj.db            ← source = "LSJ"
 *
 * Run: npm run db:split:lexica
 */

import Database from "better-sqlite3";
import path from "path";
import { existsSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data");

const SOURCE_DB  = path.join(DATA_DIR, "lexica.db");
const TARGET_DBS: Record<string, string> = {
  BDB:          path.join(DATA_DIR, "bdb.db"),
  HebrewStrong: path.join(DATA_DIR, "strongs-hebrew.db"),
  Dodson:       path.join(DATA_DIR, "dodson.db"),
  AbbottSmith:  path.join(DATA_DIR, "abbott-smith.db"),
  LSJ:          path.join(DATA_DIR, "lsj.db"),
};

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS lexicon_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    strong_number   TEXT    NOT NULL,
    language        TEXT    NOT NULL,
    lemma           TEXT,
    transliteration TEXT,
    pronunciation   TEXT,
    short_gloss     TEXT,
    definition      TEXT,
    usage           TEXT,
    source          TEXT,
    UNIQUE (strong_number, source)
  );
  CREATE INDEX IF NOT EXISTS lex_strong_idx    ON lexicon_entries(strong_number);
  CREATE INDEX IF NOT EXISTS lex_lemma_src_idx ON lexicon_entries(lemma, source);
`;

function main() {
  if (!existsSync(SOURCE_DB)) {
    console.error(`Source database not found: ${SOURCE_DB}`);
    process.exit(1);
  }

  const src = new Database(SOURCE_DB, { readonly: true });

  const sources = (
    src.prepare("SELECT DISTINCT source FROM lexicon_entries").all() as { source: string }[]
  ).map((r) => r.source);

  console.log(`Found sources in lexica.db: ${sources.join(", ")}\n`);

  for (const source of sources) {
    const targetPath = TARGET_DBS[source];
    if (!targetPath) {
      console.log(`⚠  No target DB configured for source "${source}" — skipping.`);
      continue;
    }

    console.log(`Splitting ${source} → ${path.basename(targetPath)} …`);
    const target = new Database(targetPath);
    target.pragma("journal_mode = WAL");
    target.exec(CREATE_SQL);

    // Clear existing rows for this source so re-runs are idempotent.
    const del = target.prepare(`DELETE FROM lexicon_entries WHERE source = ?`).run(source);
    if (del.changes > 0) console.log(`  Cleared ${del.changes} existing rows.`);

    const rows = src.prepare(
      `SELECT strong_number, language, lemma, transliteration, pronunciation,
              short_gloss, definition, usage, source
       FROM lexicon_entries WHERE source = ?`
    ).all(source) as {
      strong_number: string; language: string; lemma: string | null;
      transliteration: string | null; pronunciation: string | null;
      short_gloss: string | null; definition: string | null;
      usage: string | null; source: string;
    }[];

    const insert = target.prepare(`
      INSERT OR REPLACE INTO lexicon_entries
        (strong_number, language, lemma, transliteration, pronunciation,
         short_gloss, definition, usage, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    type Row = typeof rows[0];
    const insertMany = target.transaction((rows: Row[]) => {
      for (const r of rows) {
        insert.run(
          r.strong_number, r.language, r.lemma, r.transliteration,
          r.pronunciation, r.short_gloss, r.definition, r.usage, r.source,
        );
      }
    });

    insertMany(rows);
    console.log(`  ✓ ${rows.length.toLocaleString()} entries written.\n`);
    target.close();
  }

  src.close();
  console.log("Done.");
}

main();
