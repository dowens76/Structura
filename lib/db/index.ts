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

const SOURCE_DB_PATH  = path.join(RESOURCES_DIR, "source.db");
const LEXICA_DB_PATH  = path.join(RESOURCES_DIR, "lexica.db");  // legacy fallback only
const LXX_DB_PATH     = path.join(RESOURCES_DIR, "lxx.db");
const ULT_DB_PATH     = path.join(RESOURCES_DIR, "ult.db");
const VCB_DB_PATH     = path.join(RESOURCES_DIR, "vcb.db");
const USER_DB_PATH    = path.join(USER_DATA_DIR,  "user.db");

// Per-lexicon DB paths (one file per lexicon source).
const LEXICON_DB_PATHS: Record<string, string> = {
  BDB:          path.join(RESOURCES_DIR, "bdb.db"),
  HebrewStrong: path.join(RESOURCES_DIR, "strongs-hebrew.db"),
  Dodson:       path.join(RESOURCES_DIR, "dodson.db"),
  AbbottSmith:  path.join(RESOURCES_DIR, "abbott-smith.db"),
  LSJ:          path.join(RESOURCES_DIR, "lsj.db"),
};

export const HEBREW_LEXICON_SOURCES = ["BDB", "HebrewStrong"] as const;
export const GREEK_LEXICON_SOURCES  = ["AbbottSmith", "Dodson", "LSJ"] as const;

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

let _sourceDb:    ReturnType<typeof drizzle<typeof sourceSchema>> | null = null;
let _lexicaDb:    ReturnType<typeof drizzle<typeof lexicaSchema>> | null = null;
let _lxxDb:       ReturnType<typeof drizzle<typeof sourceSchema>> | null = null;
let _lxxSqlite:   Database.Database | null = null;
let _userDb:      ReturnType<typeof drizzle<typeof userSchema>>   | null = null;
let _userSqlite:  Database.Database | null = null;
let _ultSqlite:   Database.Database | null = null;
let _vcbSqlite:   Database.Database | null = null;

// Per-lexicon DB cache: keyed by source name.
const _lexiconDbCache = new Map<string, ReturnType<typeof drizzle<typeof lexicaSchema>> | null>();

export function getSourceDb() {
  if (!_sourceDb) {
    const sqlite = new Database(SOURCE_DB_PATH, { readonly: true });
    sqlite.pragma("foreign_keys = ON");
    _sourceDb = drizzle(sqlite, { schema: sourceSchema });
  }
  return _sourceDb;
}

export function getLexicaDb() {
  if (!_lexicaDb) {
    if (!fs.existsSync(LEXICA_DB_PATH)) return null;
    const sqlite = new Database(LEXICA_DB_PATH, { readonly: true });
    _lexicaDb = drizzle(sqlite, { schema: lexicaSchema });
  }
  return _lexicaDb;
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
  if (_lxxDb) return _lxxDb;
  if (!fs.existsSync(LXX_DB_PATH)) return null;
  const sqlite = new Database(LXX_DB_PATH, { readonly: true });
  sqlite.pragma("foreign_keys = ON");
  _lxxSqlite = sqlite;
  _lxxDb = drizzle(sqlite, { schema: sourceSchema });
  return _lxxDb;
}

/** Raw better-sqlite3 connection to lxx.db (initialises getLxxDb if needed). */
export function getLxxSqlite(): Database.Database | null {
  if (_lxxSqlite) return _lxxSqlite;
  getLxxDb(); // ensures _lxxSqlite is populated
  return _lxxSqlite;
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
      text_source  TEXT    NOT NULL,
      book         TEXT    NOT NULL,
      chapter      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conlbl_ws_word_idx ON constituent_labels(workspace_id, word_id);
    CREATE INDEX IF NOT EXISTS conlbl_book_ch_src_idx ON constituent_labels(book, chapter, text_source);
  `);

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
}

export function getUserDb() {
  if (!_userDb) {
    _userSqlite = new Database(USER_DB_PATH);
    _userSqlite.pragma("busy_timeout = 5000");
    _userSqlite.pragma("journal_mode = WAL");
    _userSqlite.pragma("synchronous = NORMAL");
    _userSqlite.pragma("foreign_keys = ON");
    migrateUserDb(_userSqlite);
    _userDb = drizzle(_userSqlite, { schema: userSchema });
  }
  return _userDb;
}

/** Raw better-sqlite3 instance for user.db — used by backup/restore. */
export function getUserSqlite(): Database.Database {
  if (!_userSqlite) getUserDb(); // ensure initialized
  return _userSqlite!;
}

/** Read-only better-sqlite3 instance for ult.db — null if not yet imported. */
export function getUltSqlite(): Database.Database | null {
  if (_ultSqlite) return _ultSqlite;
  if (!fs.existsSync(ULT_DB_PATH)) return null;
  _ultSqlite = new Database(ULT_DB_PATH, { readonly: true });
  return _ultSqlite;
}

/** Read-only better-sqlite3 instance for vcb.db — null if not yet imported. */
export function getVcbSqlite(): Database.Database | null {
  if (_vcbSqlite) return _vcbSqlite;
  if (!fs.existsSync(VCB_DB_PATH)) return null;
  _vcbSqlite = new Database(VCB_DB_PATH, { readonly: true });
  return _vcbSqlite;
}

export const sourceDb     = getSourceDb();
export const userDb       = getUserDb();
export const userSqlite   = getUserSqlite();
export const sourceLookups = loadLookupMaps(SOURCE_DB_PATH); // tense map: X=perfect, Y=pluperfect
export const lxxLookups    = loadLookupMaps(LXX_DB_PATH);
