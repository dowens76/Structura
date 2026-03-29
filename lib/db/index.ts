import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sourceSchema from "./source-schema";
import * as userSchema from "./user-schema";
import path from "path";

const SOURCE_DB_PATH = path.join(process.cwd(), "data", "source.db");
const USER_DB_PATH   = path.join(process.cwd(), "data", "user.db");

let _sourceDb: ReturnType<typeof drizzle<typeof sourceSchema>> | null = null;
let _userDb:   ReturnType<typeof drizzle<typeof userSchema>>   | null = null;

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

export function getUserDb() {
  if (!_userDb) {
    const sqlite = new Database(USER_DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("foreign_keys = ON");
    _userDb = drizzle(sqlite, { schema: userSchema });
  }
  return _userDb;
}

export const sourceDb = getSourceDb();
export const userDb   = getUserDb();
