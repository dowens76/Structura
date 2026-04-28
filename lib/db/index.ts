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
const LEXICA_DB_PATH  = path.join(RESOURCES_DIR, "lexica.db");
const LXX_DB_PATH     = path.join(RESOURCES_DIR, "lxx.db");
const ULT_DB_PATH     = path.join(RESOURCES_DIR, "ult.db");
const USER_DB_PATH    = path.join(USER_DATA_DIR,  "user.db");

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
let _userDb:      ReturnType<typeof drizzle<typeof userSchema>>   | null = null;
let _userSqlite:  Database.Database | null = null;
let _ultSqlite:   Database.Database | null = null;

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

export function getLxxDb(): ReturnType<typeof drizzle<typeof sourceSchema>> | null {
  if (_lxxDb) return _lxxDb;
  if (!fs.existsSync(LXX_DB_PATH)) return null;
  const sqlite = new Database(LXX_DB_PATH, { readonly: true });
  sqlite.pragma("foreign_keys = ON");
  _lxxDb = drizzle(sqlite, { schema: sourceSchema });
  return _lxxDb;
}

function migrateUserDb(sqlite: Database.Database): void {
  const sceneBreakCols = (sqlite.prepare("PRAGMA table_info(scene_breaks)").all() as { name: string }[]).map(r => r.name);
  if (!sceneBreakCols.includes("thematic"))
    sqlite.exec("ALTER TABLE scene_breaks ADD COLUMN thematic INTEGER NOT NULL DEFAULT 0");
  if (!sceneBreakCols.includes("thematic_letter"))
    sqlite.exec("ALTER TABLE scene_breaks ADD COLUMN thematic_letter TEXT");

  const charCols = (sqlite.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map(r => r.name);
  if (!charCols.includes("sort_order"))
    sqlite.exec("ALTER TABLE characters ADD COLUMN sort_order INTEGER DEFAULT 0");

  const tagCols = (sqlite.prepare("PRAGMA table_info(word_tags)").all() as { name: string }[]).map(r => r.name);
  if (!tagCols.includes("sort_order"))
    sqlite.exec("ALTER TABLE word_tags ADD COLUMN sort_order INTEGER DEFAULT 0");
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

export const sourceDb     = getSourceDb();
export const lexicaDb     = getLexicaDb()!;
export const userDb       = getUserDb();
export const userSqlite   = getUserSqlite();
export const sourceLookups = loadLookupMaps(SOURCE_DB_PATH); // tense map: X=perfect, Y=pluperfect
export const lxxLookups    = loadLookupMaps(LXX_DB_PATH);
