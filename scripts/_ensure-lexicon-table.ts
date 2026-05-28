/**
 * Shared helper: ensure the lexicon_entries table exists in a given DB file.
 * Called at the top of each per-lexicon import script so scripts are
 * self-contained and don't require a prior `db:push:lexica` run.
 */
import type Database from "better-sqlite3";

export const LEXICON_TABLE_SQL = `
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
  CREATE INDEX IF NOT EXISTS lex_strong_idx       ON lexicon_entries(strong_number);
  CREATE INDEX IF NOT EXISTS lex_strong_source_idx ON lexicon_entries(strong_number, source);
  CREATE INDEX IF NOT EXISTS lex_lemma_src_idx    ON lexicon_entries(lemma, source);
`;

export function ensureLexiconTable(sqlite: Database.Database): void {
  sqlite.exec(LEXICON_TABLE_SQL);
}
