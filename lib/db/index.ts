import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sourceSchema from "./source-schema";
import * as userSchema from "./user-schema";
import path from "path";
import fs from "fs";

const SOURCE_DB_PATH = path.join(process.cwd(), "data", "source.db");
const LXX_DB_PATH   = path.join(process.cwd(), "data", "lxx.db");
const USER_DB_PATH  = path.join(process.cwd(), "data", "user.db");

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
let _lxxDb:       ReturnType<typeof drizzle<typeof sourceSchema>> | null = null;
let _userDb:      ReturnType<typeof drizzle<typeof userSchema>>   | null = null;
let _userSqlite:  Database.Database | null = null;

export function getSourceDb() {
  if (!_sourceDb) {
    const sqlite = new Database(SOURCE_DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");
    _sourceDb = drizzle(sqlite, { schema: sourceSchema });
  }
  return _sourceDb;
}

export function getLxxDb(): ReturnType<typeof drizzle<typeof sourceSchema>> | null {
  if (_lxxDb) return _lxxDb;
  if (!fs.existsSync(LXX_DB_PATH)) return null;
  const sqlite = new Database(LXX_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  _lxxDb = drizzle(sqlite, { schema: sourceSchema });
  return _lxxDb;
}

export function getUserDb() {
  if (!_userDb) {
    _userSqlite = new Database(USER_DB_PATH);
    _userSqlite.pragma("journal_mode = WAL");
    _userSqlite.pragma("synchronous = NORMAL");
    _userSqlite.pragma("foreign_keys = ON");
    _userDb = drizzle(_userSqlite, { schema: userSchema });
  }
  return _userDb;
}

/** Raw better-sqlite3 instance for user.db — used by backup/restore. */
export function getUserSqlite(): Database.Database {
  if (!_userSqlite) getUserDb(); // ensure initialized
  return _userSqlite!;
}

export const sourceDb     = getSourceDb();
export const userDb       = getUserDb();
export const userSqlite   = getUserSqlite();
export const sourceLookups = loadLookupMaps(SOURCE_DB_PATH);
export const lxxLookups    = loadLookupMaps(LXX_DB_PATH);
