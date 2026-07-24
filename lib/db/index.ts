import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sourceSchema from "./source-schema";
import * as userSchema from "./user-schema";
import * as lexicaSchema from "./lexica-schema";
import path from "path";
import fs from "fs";

const RESOURCES_DIR = process.env.STRUCTURA_RESOURCES_DIR
  ?? path.join(process.cwd(), "data");
const USER_DATA_DIR = process.env.STRUCTURA_USER_DATA_DIR
  ?? path.join(process.cwd(), "data");

const SOURCE_DB_PATH  = path.join(RESOURCES_DIR, "source.db");  // legacy — superseded by oshb.db/sblgnt.db
const OSHB_DB_PATH    = path.join(RESOURCES_DIR, "oshb.db");
const SBLGNT_DB_PATH  = path.join(RESOURCES_DIR, "sblgnt.db");
const LEXICA_DB_PATH  = path.join(RESOURCES_DIR, "lexica.db");  // legacy fallback only
const LXX_DB_PATH     = path.join(RESOURCES_DIR, "lxx.db");
const ULT_DB_PATH     = path.join(RESOURCES_DIR, "ult.db");
const VCB_DB_PATH     = path.join(RESOURCES_DIR, "vcb.db");
const USER_DB_PATH    = path.join(USER_DATA_DIR,  "user.db");

// Per-lexicon DB paths (one file per lexicon source).
const LEXICON_DB_PATHS: Record<string, string> = {
  BDB:          path.join(RESOURCES_DIR, "bdb.db"),
  Dodson:       path.join(RESOURCES_DIR, "dodson.db"),
  AbbottSmith:  path.join(RESOURCES_DIR, "abbott-smith.db"),
  LSJ:          path.join(RESOURCES_DIR, "lsj.db"),
  UBSHebrew:    path.join(RESOURCES_DIR, "ubs-hebrew.db"),
  UBSGreek:     path.join(RESOURCES_DIR, "ubs-greek.db"),
};

export const HEBREW_LEXICON_SOURCES = ["BDB", "UBSHebrew"] as const;
export const GREEK_LEXICON_SOURCES  = ["AbbottSmith", "Dodson", "LSJ", "UBSGreek"] as const;

// ── Lookup maps ───────────────────────────────────────────────────────────────

export type LookupById    = Record<number, string>;
export type LookupByValue = Record<string, number>;

export interface LookupMaps {
  textSourceById:   LookupById;
  textSourceByValue: LookupByValue;
  languageById:     LookupById;
  partOfSpeechById: LookupById;
  personById:       LookupById;
  genderById:       LookupById;
  wordNumberById:   LookupById;
  tenseById:        LookupById;
  voiceById:        LookupById;
  moodById:         LookupById;
  stemById:         LookupById;
  stateById:        LookupById;
  verbCaseById:     LookupById;
  textSourceIdForFilter: (val: string) => number | null;
}

const EMPTY_LOOKUP_MAPS: LookupMaps = {
  textSourceById:    {},
  textSourceByValue: {},
  languageById:      {},
  partOfSpeechById:  {},
  personById:        {},
  genderById:        {},
  wordNumberById:    {},
  tenseById:         {},
  voiceById:         {},
  moodById:          {},
  stemById:          {},
  stateById:         {},
  verbCaseById:      {},
  textSourceIdForFilter: () => null,
};

function loadLookupMaps(dbPath: string): LookupMaps {
  if (!fs.existsSync(dbPath)) return EMPTY_LOOKUP_MAPS;
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    function loadTable(table: string): { byId: LookupById; byValue: LookupByValue } {
      const rows = sqlite.prepare(`SELECT id, value FROM ${table}`).all() as { id: number; value: string }[];
      const byId: LookupById = {};
      const byValue: LookupByValue = {};
      for (const r of rows) { byId[r.id] = r.value; byValue[r.value] = r.id; }
      return { byId, byValue };
    }
    const ts  = loadTable("text_sources");
    const lng = loadTable("languages");
    const pos = loadTable("parts_of_speech");
    const per = loadTable("persons");
    const gen = loadTable("genders");
    const wn  = loadTable("word_numbers");
    const ten = loadTable("tenses");
    const voi = loadTable("voices");
    const mo  = loadTable("moods");
    const st  = loadTable("stems");
    const sta = loadTable("states");
    const vc  = loadTable("verb_cases");
    return {
      textSourceById:    ts.byId,
      textSourceByValue: ts.byValue,
      languageById:      lng.byId,
      partOfSpeechById:  pos.byId,
      personById:        per.byId,
      genderById:        gen.byId,
      wordNumberById:    wn.byId,
      tenseById:         ten.byId,
      voiceById:         voi.byId,
      moodById:          mo.byId,
      stemById:          st.byId,
      stateById:         sta.byId,
      verbCaseById:      vc.byId,
      textSourceIdForFilter: (val: string) => ts.byValue[val] ?? null,
    };
  } catch {
    return EMPTY_LOOKUP_MAPS;
  } finally {
    sqlite.close();
  }
}

// ── DB singletons ─────────────────────────────────────────────────────────────

export { USER_DB_PATH };

// Next.js dev mode re-evaluates this module (and re-runs the eager
// `export const x = getX()` calls below) whenever any file that transitively
// imports it changes — which in practice is nearly every file in the app.
// Plain module-level `let` singletons get reset on each re-evaluation, so
// every save-triggered reload silently opened a brand new better-sqlite3
// connection to the same on-disk file without ever closing the previous
// one. Multiple concurrent WAL-mode connections to one file from the same
// process can checkpoint/truncate the WAL out from under each other,
// silently dropping recently-committed writes (e.g. word-dataset groupings)
// the next time the dev server restarts. Caching on `globalThis` survives
// module re-evaluation, so the same connection is reused across reloads.
interface DbCache {
  sourceDb?:    ReturnType<typeof drizzle<typeof sourceSchema>>;
  oshbDb?:      ReturnType<typeof drizzle<typeof sourceSchema>>;
  sblgntDb?:    ReturnType<typeof drizzle<typeof sourceSchema>>;
  lexicaDb?:    ReturnType<typeof drizzle<typeof lexicaSchema>> | null;
  lexiconDbCache?: Map<string, ReturnType<typeof drizzle<typeof lexicaSchema>> | null>;
  lxxDb?:       ReturnType<typeof drizzle<typeof sourceSchema>> | null;
  lxxSqlite?:   Database.Database | null;
  userDb?:      ReturnType<typeof drizzle<typeof userSchema>>;
  userSqlite?:  Database.Database;
  ultSqlite?:   Database.Database | null;
  vcbSqlite?:   Database.Database | null;
}
const globalForDb = globalThis as typeof globalThis & { __structuraDbCache?: DbCache };
const dbCache: DbCache = globalForDb.__structuraDbCache ?? (globalForDb.__structuraDbCache = {});

// Per-lexicon DB cache: keyed by source name.
const _lexiconDbCache = dbCache.lexiconDbCache ?? (dbCache.lexiconDbCache = new Map());

/** Returns the per-source DB for OSHB (Hebrew OT). Falls back to legacy source.db if oshb.db is absent. */
export function getOshbDb(): ReturnType<typeof drizzle<typeof sourceSchema>> {
  if (!dbCache.oshbDb) {
    const dbPath = fs.existsSync(OSHB_DB_PATH) ? OSHB_DB_PATH : SOURCE_DB_PATH;
    const sqlite = new Database(dbPath, { readonly: true });
    sqlite.pragma("foreign_keys = ON");
    dbCache.oshbDb = drizzle(sqlite, { schema: sourceSchema });
  }
  return dbCache.oshbDb;
}

/** Returns the per-source DB for SBLGNT (Greek NT). Falls back to legacy source.db if sblgnt.db is absent. */
export function getSblgntDb(): ReturnType<typeof drizzle<typeof sourceSchema>> {
  if (!dbCache.sblgntDb) {
    const dbPath = fs.existsSync(SBLGNT_DB_PATH) ? SBLGNT_DB_PATH : SOURCE_DB_PATH;
    const sqlite = new Database(dbPath, { readonly: true });
    sqlite.pragma("foreign_keys = ON");
    dbCache.sblgntDb = drizzle(sqlite, { schema: sourceSchema });
  }
  return dbCache.sblgntDb;
}

/** Route to the correct per-source DB and its lookup maps based on textSource. */
export function getDbAndLookups(textSource: string): { db: ReturnType<typeof drizzle<typeof sourceSchema>>; lookups: LookupMaps } {
  if (textSource === "SBLGNT") return { db: getSblgntDb(), lookups: sblgntLookups };
  return { db: getOshbDb(), lookups: oshbLookups };
}

/** @deprecated Use getOshbDb() or getDbAndLookups(textSource) instead. */
export function getSourceDb() {
  if (!dbCache.sourceDb) {
    // Prefer the split oshb.db; fall back to the legacy combined source.db.
    const dbPath = fs.existsSync(OSHB_DB_PATH) ? OSHB_DB_PATH : SOURCE_DB_PATH;
    const sqlite = new Database(dbPath, { readonly: true });
    sqlite.pragma("foreign_keys = ON");
    dbCache.sourceDb = drizzle(sqlite, { schema: sourceSchema });
  }
  return dbCache.sourceDb;
}

export function getLexicaDb() {
  if (!dbCache.lexicaDb) {
    if (!fs.existsSync(LEXICA_DB_PATH)) return null;
    const sqlite = new Database(LEXICA_DB_PATH, { readonly: true });
    dbCache.lexicaDb = drizzle(sqlite, { schema: lexicaSchema });
  }
  return dbCache.lexicaDb;
}

/**
 * Return the Drizzle DB instance for a single named lexicon source,
 * e.g. "BDB", "AbbottSmith", "LSJ".
 * Returns null if the per-lexicon DB file does not exist.
 */
export function getLexiconDb(
  source: string,
): ReturnType<typeof drizzle<typeof lexicaSchema>> | null {
  if (_lexiconDbCache.has(source)) return _lexiconDbCache.get(source)!;
  const dbPath = LEXICON_DB_PATHS[source];
  if (!dbPath || !fs.existsSync(dbPath)) {
    _lexiconDbCache.set(source, null);
    return null;
  }
  const sqlite = new Database(dbPath, { readonly: true });
  const db = drizzle(sqlite, { schema: lexicaSchema });
  _lexiconDbCache.set(source, db);
  return db;
}

/**
 * Resolve a lexicon DB for a given source name.
 * 1. Try the per-lexicon DB file (e.g. bdb.db, lsj.db).
 * 2. Fall back to the legacy combined lexica.db if the per-lexicon file is absent.
 * Returns null only when neither file exists.
 */
export function getLexiconDbForSource(
  source: string | null | undefined,
): ReturnType<typeof drizzle<typeof lexicaSchema>> | null {
  if (source) {
    const per = getLexiconDb(source);
    if (per) return per;
  }
  return getLexicaDb();
}

/**
 * Return all available lexicon DBs for the given language.
 * Prefers per-lexicon DB files; falls back to the legacy combined lexica.db
 * only when no per-lexicon files exist at all.
 */
export function getLexiconDbsForLanguage(
  language: "hebrew" | "greek",
): Array<{ db: ReturnType<typeof drizzle<typeof lexicaSchema>>; source: string }> {
  const sources: readonly string[] =
    language === "hebrew" ? HEBREW_LEXICON_SOURCES : GREEK_LEXICON_SOURCES;

  const perDbs = sources.flatMap((s) => {
    const db = getLexiconDb(s);
    return db ? [{ db, source: s }] : [];
  });
  if (perDbs.length > 0) return perDbs;

  // Fall back to the legacy combined DB (no per-lexicon files present).
  const legacy = getLexicaDb();
  return legacy ? [{ db: legacy, source: "legacy" }] : [];
}

export function getLxxDb(): ReturnType<typeof drizzle<typeof sourceSchema>> | null {
  if (dbCache.lxxDb) return dbCache.lxxDb;
  if (!fs.existsSync(LXX_DB_PATH)) return null;
  const sqlite = new Database(LXX_DB_PATH, { readonly: true });
  sqlite.pragma("foreign_keys = ON");
  dbCache.lxxSqlite = sqlite;
  dbCache.lxxDb = drizzle(sqlite, { schema: sourceSchema });
  return dbCache.lxxDb;
}

/** Raw better-sqlite3 connection to lxx.db (initialises getLxxDb if needed). */
export function getLxxSqlite(): Database.Database | null {
  if (dbCache.lxxSqlite) return dbCache.lxxSqlite;
  getLxxDb(); // ensures dbCache.lxxSqlite is populated
  return dbCache.lxxSqlite ?? null;
}

function migrateUserDb(sqlite: Database.Database): void {
  // Run the entire migration under an exclusive lock so concurrent Next.js
  // build workers (or worker threads) don't race each other.  The caller
  // already sets busy_timeout = 5000 ms, so the second worker will simply
  // wait for the first to finish and then find everything already done.
  sqlite.exec("BEGIN EXCLUSIVE");
  try {
    _migrateUserDbInner(sqlite);
    sqlite.exec("COMMIT");
  } catch (e) {
    try { sqlite.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

function _migrateUserDbInner(sqlite: Database.Database): void {
  const sceneBreakCols = (sqlite.prepare("PRAGMA table_info(scene_breaks)").all() as { name: string }[]).map(r => r.name);
  if (!sceneBreakCols.includes("thematic"))
    try { sqlite.exec("ALTER TABLE scene_breaks ADD COLUMN thematic INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
  if (!sceneBreakCols.includes("thematic_letter"))
    try { sqlite.exec("ALTER TABLE scene_breaks ADD COLUMN thematic_letter TEXT"); } catch { /* already exists */ }
  if (!sceneBreakCols.includes("transitional"))
    try { sqlite.exec("ALTER TABLE scene_breaks ADD COLUMN transitional INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

  const lineAnnotCols = (sqlite.prepare("PRAGMA table_info(line_annotations)").all() as { name: string }[]).map(r => r.name);
  if (!lineAnnotCols.includes("transitional"))
    try { sqlite.exec("ALTER TABLE line_annotations ADD COLUMN transitional INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
  if (!lineAnnotCols.includes("comm_function"))
    try { sqlite.exec("ALTER TABLE line_annotations ADD COLUMN comm_function TEXT"); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS intertextual_links (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id         INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      source_book          TEXT    NOT NULL,
      source_chapter       INTEGER NOT NULL,
      source_verse         INTEGER NOT NULL,
      source_end_verse     INTEGER,
      source_text_source   TEXT    NOT NULL,
      source_start_word_id TEXT,
      source_end_word_id   TEXT,
      target_book          TEXT    NOT NULL,
      target_chapter       INTEGER NOT NULL,
      target_verse         INTEGER NOT NULL,
      target_end_verse     INTEGER,
      target_text_source   TEXT    NOT NULL,
      target_start_word_id TEXT,
      target_end_word_id   TEXT,
      link_type            TEXT    NOT NULL,
      strength             INTEGER NOT NULL DEFAULT 3,
      notes                TEXT,
      direction            TEXT    NOT NULL DEFAULT 'source_to_target',
      tags                 TEXT    NOT NULL DEFAULT '[]',
      created_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS il_workspace_idx ON intertextual_links(workspace_id);
    CREATE INDEX IF NOT EXISTS il_source_idx    ON intertextual_links(source_book, source_chapter);
    CREATE INDEX IF NOT EXISTS il_target_idx    ON intertextual_links(target_book, target_chapter);
  `);

  const ilCols = (sqlite.prepare("PRAGMA table_info(intertextual_links)").all() as { name: string }[]).map(r => r.name);
  if (!ilCols.includes("tags"))
    try { sqlite.exec("ALTER TABLE intertextual_links ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"); } catch { /* already exists */ }

  const charCols = (sqlite.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map(r => r.name);
  if (!charCols.includes("sort_order"))
    try { sqlite.exec("ALTER TABLE characters ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch { /* already exists */ }

  const tagCols = (sqlite.prepare("PRAGMA table_info(word_tags)").all() as { name: string }[]).map(r => r.name);
  if (!tagCols.includes("sort_order"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch { /* already exists */ }
  if (!tagCols.includes("corpus_grouping_id"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN corpus_grouping_id INTEGER"); } catch { /* already exists */ }
  if (!tagCols.includes("lemmas"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN lemmas TEXT"); } catch { /* already exists */ }
  if (!tagCols.includes("highlighted"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN highlighted INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
  if (!tagCols.includes("corpus_type")) {
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN corpus_type TEXT NOT NULL DEFAULT 'book'"); } catch { /* already exists */ }
    // Backfill: any tag that already had a grouping set was implicitly "grouping"-scoped.
    try { sqlite.exec("UPDATE word_tags SET corpus_type = 'grouping' WHERE corpus_grouping_id IS NOT NULL"); } catch { /* already exists */ }
  }
  if (!tagCols.includes("corpus_chapter"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN corpus_chapter INTEGER"); } catch { /* already exists */ }
  if (!tagCols.includes("corpus_passage_id"))
    try { sqlite.exec("ALTER TABLE word_tags ADD COLUMN corpus_passage_id INTEGER"); } catch { /* already exists */ }

  const rstCols = (sqlite.prepare("PRAGMA table_info(rst_relations)").all() as { name: string }[]).map(r => r.name);
  if (!rstCols.includes("intersect_point"))
    try { sqlite.exec("ALTER TABLE rst_relations ADD COLUMN intersect_point TEXT NOT NULL DEFAULT 'mid'"); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS passages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      book         TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      label        TEXT    NOT NULL DEFAULT '',
      start_chapter INTEGER NOT NULL,
      start_verse   INTEGER NOT NULL,
      end_book      TEXT,
      end_chapter   INTEGER NOT NULL,
      end_verse     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS passages_book_src_idx ON passages(book, text_source);
  `);

  const passageCols = (sqlite.prepare("PRAGMA table_info(passages)").all() as { name: string }[]).map(r => r.name);
  if (!passageCols.includes("end_book"))
    try { sqlite.exec("ALTER TABLE passages ADD COLUMN end_book TEXT"); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auto_backup_settings (
      id               INTEGER PRIMARY KEY,
      enabled          INTEGER NOT NULL DEFAULT 0,
      folder_path      TEXT,
      interval_type    TEXT    NOT NULL DEFAULT 'daily',
      interval_hours   INTEGER NOT NULL DEFAULT 24,
      retention_type   TEXT    NOT NULL DEFAULT 'smart',
      retention_count  INTEGER NOT NULL DEFAULT 10,
      last_backup_at   TEXT,
      last_error       TEXT,
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO auto_backup_settings (id) VALUES (1);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS paragraph_headings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      verse        INTEGER NOT NULL,
      heading      TEXT    NOT NULL,
      created_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ph_ws_bkchv_idx ON paragraph_headings(workspace_id, book, chapter, verse);
    CREATE INDEX IF NOT EXISTS ph_book_ch_idx ON paragraph_headings(book, chapter);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS constituent_labels (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      label        TEXT    NOT NULL,
      group_id     TEXT,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conlbl_ws_word_idx ON constituent_labels(workspace_id, word_id);
    CREATE INDEX IF NOT EXISTS conlbl_book_ch_src_idx ON constituent_labels(book, chapter, text_source);
  `);

  const conlblCols = (sqlite.prepare("PRAGMA table_info(constituent_labels)").all() as { name: string }[]).map(r => r.name);
  if (!conlblCols.includes("group_id")) {
    try { sqlite.exec("ALTER TABLE constituent_labels ADD COLUMN group_id TEXT"); } catch { /* already exists */ }
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS conlbl_ws_group_idx ON constituent_labels(workspace_id, group_id)"); } catch { /* already exists */ }

  const waCols = (sqlite.prepare("PRAGMA table_info(word_arrows)").all() as { name: string }[]).map(r => r.name);
  if (!waCols.includes("color"))       try { sqlite.exec("ALTER TABLE word_arrows ADD COLUMN color TEXT"); } catch { /* already exists */ }
  if (!waCols.includes("midpoint_dx"))  try { sqlite.exec("ALTER TABLE word_arrows ADD COLUMN midpoint_dx REAL");  } catch { /* already exists */ }
  if (!waCols.includes("midpoint_dy"))  try { sqlite.exec("ALTER TABLE word_arrows ADD COLUMN midpoint_dy REAL");  } catch { /* already exists */ }
  if (!waCols.includes("midpoint2_dx")) try { sqlite.exec("ALTER TABLE word_arrows ADD COLUMN midpoint2_dx REAL"); } catch { /* already exists */ }
  if (!waCols.includes("midpoint2_dy")) try { sqlite.exec("ALTER TABLE word_arrows ADD COLUMN midpoint2_dy REAL"); } catch { /* already exists */ }

  const wfmtCols = (sqlite.prepare("PRAGMA table_info(word_formatting)").all() as { name: string }[]).map(r => r.name);
  if (!wfmtCols.includes("is_small_caps"))
    try { sqlite.exec("ALTER TABLE word_formatting ADD COLUMN is_small_caps INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS book_groupings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      books        TEXT    NOT NULL DEFAULT '[]',
      features     TEXT    NOT NULL DEFAULT '[]',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS bg_ws_idx ON book_groupings(workspace_id);
  `);

  const workspaceCols = (sqlite.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[]).map(r => r.name);
  if (!workspaceCols.includes("translation_only"))
    try { sqlite.exec("ALTER TABLE workspaces ADD COLUMN translation_only INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS translation_footnotes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id   INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      translation_id INTEGER NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
      osis_ref       TEXT    NOT NULL,
      type           TEXT    NOT NULL,
      content        TEXT    NOT NULL,
      word_index     INTEGER NOT NULL DEFAULT 0,
      book           TEXT    NOT NULL,
      chapter        INTEGER NOT NULL,
      verse          INTEGER NOT NULL,
      created_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS tf_trans_book_ch_idx ON translation_footnotes(translation_id, book, chapter);
    CREATE INDEX IF NOT EXISTS tf_osis_ref_idx ON translation_footnotes(osis_ref);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS translation_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id   INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      translation_id INTEGER NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
      osis_ref       TEXT    NOT NULL,
      text           TEXT    NOT NULL,
      label          TEXT,
      created_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS tv_ver_trans_osis_idx ON translation_versions(translation_id, osis_ref);
    CREATE INDEX IF NOT EXISTS tv_ver_ws_trans_idx ON translation_versions(workspace_id, translation_id);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS text_critical_marks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      mark_type    TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL,
      created_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tcm_ws_word_idx ON text_critical_marks(workspace_id, word_id);
    CREATE INDEX IF NOT EXISTS tcm_book_ch_idx ON text_critical_marks(book, chapter);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id           TEXT    PRIMARY KEY,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      label        TEXT    NOT NULL DEFAULT '',
      href         TEXT    NOT NULL,
      translations TEXT    NOT NULL DEFAULT '[]',
      created_at   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS bookmarks_ws_idx ON bookmarks(workspace_id);

    CREATE TABLE IF NOT EXISTS notes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      note_type    TEXT    NOT NULL,
      content      TEXT    NOT NULL DEFAULT '{}',
      book         TEXT,
      chapter      INTEGER,
      updated_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notes_ws_key_idx ON notes(workspace_id, key);
    CREATE INDEX IF NOT EXISTS notes_book_ch_idx ON notes(book, chapter);

    CREATE TABLE IF NOT EXISTS word_formatting (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      is_bold      INTEGER NOT NULL DEFAULT 0,
      is_italic    INTEGER NOT NULL DEFAULT 0,
      is_small_caps INTEGER NOT NULL DEFAULT 0,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wfmt_ws_word_idx ON word_formatting(workspace_id, word_id);
    CREATE INDEX IF NOT EXISTS wfmt_book_ch_idx ON word_formatting(book, chapter);

    CREATE TABLE IF NOT EXISTS word_datasets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT    NOT NULL,
      created_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS wds_ws_idx ON word_datasets(workspace_id);

    CREATE TABLE IF NOT EXISTS word_dataset_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id  INTEGER NOT NULL REFERENCES word_datasets(id) ON DELETE CASCADE,
      word_id     TEXT    NOT NULL,
      value       TEXT    NOT NULL,
      group_id    TEXT,
      text_source TEXT    NOT NULL,
      book        TEXT    NOT NULL,
      chapter     INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wde_ds_word_idx ON word_dataset_entries(dataset_id, word_id);
    CREATE INDEX IF NOT EXISTS wde_ds_book_ch_idx ON word_dataset_entries(dataset_id, book, chapter, text_source);
    CREATE INDEX IF NOT EXISTS wde_ds_group_idx ON word_dataset_entries(dataset_id, group_id);

    CREATE TABLE IF NOT EXISTS word_dataset_label_colors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id  INTEGER NOT NULL REFERENCES word_datasets(id) ON DELETE CASCADE,
      value       TEXT    NOT NULL,
      color       TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wdlc_ds_value_idx ON word_dataset_label_colors(dataset_id, value);

    CREATE TABLE IF NOT EXISTS transliteration_formats (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      word_id      TEXT    NOT NULL,
      format       TEXT    NOT NULL,
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS trf_ws_word_idx ON transliteration_formats(workspace_id, word_id);
    CREATE INDEX IF NOT EXISTS trf_book_ch_src_idx ON transliteration_formats(book, chapter, text_source);

    CREATE TABLE IF NOT EXISTS comm_function_custom_types (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      key          TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      label        TEXT    NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cfct_ws_key_idx ON comm_function_custom_types(workspace_id, key);

    CREATE TABLE IF NOT EXISTS word_tag_columns (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspaces(id) ON DELETE CASCADE,
      tag_name     TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      type         TEXT    NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wtc_ws_tagname_name_idx ON word_tag_columns(workspace_id, tag_name, name);
    CREATE INDEX IF NOT EXISTS wtc_ws_tagname_idx ON word_tag_columns(workspace_id, tag_name);

    CREATE TABLE IF NOT EXISTS word_tag_column_options (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id  INTEGER NOT NULL REFERENCES word_tag_columns(id) ON DELETE CASCADE,
      value      TEXT    NOT NULL,
      color      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wtco_col_value_idx ON word_tag_column_options(column_id, value);

    CREATE TABLE IF NOT EXISTS word_tag_column_values (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id  INTEGER NOT NULL REFERENCES word_tag_columns(id) ON DELETE CASCADE,
      word_id    TEXT    NOT NULL,
      option_id  INTEGER REFERENCES word_tag_column_options(id) ON DELETE CASCADE,
      text_value TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS wtcv_col_word_idx ON word_tag_column_values(column_id, word_id);
    CREATE UNIQUE INDEX IF NOT EXISTS wtcv_col_word_option_idx ON word_tag_column_values(column_id, word_id, option_id);
  `);

  const wdeCols = (sqlite.prepare("PRAGMA table_info(word_dataset_entries)").all() as { name: string }[]).map(r => r.name);
  if (!wdeCols.includes("group_id")) {
    try { sqlite.exec("ALTER TABLE word_dataset_entries ADD COLUMN group_id TEXT"); } catch { /* already exists */ }
    try { sqlite.exec("CREATE INDEX IF NOT EXISTS wde_ds_group_idx ON word_dataset_entries(dataset_id, group_id)"); } catch { /* already exists */ }
  }

  // Seed VCB translation record if vcb.db is present but the translations row is missing
  if (fs.existsSync(VCB_DB_PATH)) {
    const existing = sqlite.prepare("SELECT id FROM translations WHERE abbreviation = 'VCB' LIMIT 1").get();
    if (!existing) {
      sqlite.prepare(
        "INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'User', 'user@structura.app')"
      ).run();
      sqlite.prepare(
        "INSERT OR IGNORE INTO workspaces (id, user_id, name) VALUES (1, 1, 'Default')"
      ).run();
      sqlite.prepare(
        "INSERT OR IGNORE INTO translations (workspace_id, name, abbreviation, language) VALUES (1, 'Vietnamese Contemporary Bible 2015', 'VCB', 'Vietnamese')"
      ).run();
    }
  }

  // Seed ULT translation record if ult.db is present but the translations row is missing
  if (fs.existsSync(ULT_DB_PATH)) {
    const existing = sqlite.prepare("SELECT id FROM translations WHERE abbreviation = 'ULT' LIMIT 1").get();
    if (!existing) {
      sqlite.prepare(
        "INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'User', 'user@structura.app')"
      ).run();
      sqlite.prepare(
        "INSERT OR IGNORE INTO workspaces (id, user_id, name) VALUES (1, 1, 'Default')"
      ).run();
      sqlite.prepare(
        "INSERT OR IGNORE INTO translations (workspace_id, name, abbreviation, language) VALUES (1, 'UnfoldingWord Literal Text', 'ULT', 'English')"
      ).run();
    }
  }
}

export function getUserDb() {
  if (!dbCache.userDb) {
    const sqlite = new Database(USER_DB_PATH);
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");
    migrateUserDb(sqlite);
    dbCache.userSqlite = sqlite;
    dbCache.userDb = drizzle(sqlite, { schema: userSchema });
  }
  return dbCache.userDb;
}

/** Raw better-sqlite3 instance for user.db — used by backup/restore. */
export function getUserSqlite(): Database.Database {
  if (!dbCache.userSqlite) getUserDb(); // ensure initialized
  return dbCache.userSqlite!;
}

/** Read-only better-sqlite3 instance for ult.db — null if not yet imported. */
export function getUltSqlite(): Database.Database | null {
  if (dbCache.ultSqlite) return dbCache.ultSqlite;
  if (!fs.existsSync(ULT_DB_PATH)) return null;
  dbCache.ultSqlite = new Database(ULT_DB_PATH, { readonly: true });
  return dbCache.ultSqlite;
}

/** Read-only better-sqlite3 instance for vcb.db — null if not yet imported. */
export function getVcbSqlite(): Database.Database | null {
  if (dbCache.vcbSqlite) return dbCache.vcbSqlite;
  if (!fs.existsSync(VCB_DB_PATH)) return null;
  dbCache.vcbSqlite = new Database(VCB_DB_PATH, { readonly: true });
  return dbCache.vcbSqlite;
}

export const sourceDb     = getSourceDb();
export const userDb       = getUserDb();
export const userSqlite   = getUserSqlite();

// Per-source lookup maps.  oshbLookups also serves as the canonical lookup for
// source-independent queries (books, languages) since all lookup tables are
// identical across oshb.db and sblgnt.db.
const _oshbLookupPath   = fs.existsSync(OSHB_DB_PATH)   ? OSHB_DB_PATH   : SOURCE_DB_PATH;
const _sblgntLookupPath = fs.existsSync(SBLGNT_DB_PATH) ? SBLGNT_DB_PATH : SOURCE_DB_PATH;
export const oshbLookups   = loadLookupMaps(_oshbLookupPath);
export const sblgntLookups = loadLookupMaps(_sblgntLookupPath);
export const sourceLookups = oshbLookups; // tense map: X=perfect, Y=pluperfect
export const lxxLookups    = loadLookupMaps(LXX_DB_PATH);
