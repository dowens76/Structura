/**
 * Rebuild source.db with optimizations:
 *   1. page_size = 16384 (from 4096)
 *   2. String normalization — repeated columns stored as integer lookups
 *   3. Drop osis_ref column (redundant / unused)
 *   4. Extract LXX (STEPBIBLE_LXX) words into separate lxx.db
 *
 * Run:  npm run db:rebuild
 *
 * This script replaces source.db in-place (saves a .bak backup first).
 * After running, restart the dev server.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR    = path.join(process.cwd(), "data");
const SOURCE_PATH = path.join(DATA_DIR, "source.db");
const LXX_PATH    = path.join(DATA_DIR, "lxx.db");
const BACKUP_PATH = path.join(DATA_DIR, "source.db.bak");

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildLookup(db: Database.Database, col: string): Map<string, number> {
  const rows = db.prepare(`SELECT DISTINCT ${col} FROM words WHERE ${col} IS NOT NULL ORDER BY ${col}`).all() as { [key: string]: string }[];
  const map = new Map<string, number>();
  let id = 1;
  for (const row of rows) {
    const val = row[col] as string;
    if (val != null) map.set(val, id++);
  }
  return map;
}

function createLookupTable(db: Database.Database, tableName: string, map: Map<string, number>) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`);
  const ins = db.prepare(`INSERT OR IGNORE INTO ${tableName} (id, value) VALUES (?, ?)`);
  for (const [val, id] of map) ins.run(id, val);
}

function createNewSourceDb(newPath: string, pageSize: number): Database.Database {
  if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
  const db = new Database(newPath);
  db.pragma(`page_size = ${pageSize}`);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = OFF"); // off during bulk load
  return db;
}

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS text_sources  (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS languages     (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS parts_of_speech (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS persons       (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS genders       (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS word_numbers  (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenses        (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS voices        (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS moods         (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stems         (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS states        (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verb_cases    (id INTEGER PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS books (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      osis_code     TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      testament     TEXT NOT NULL,
      language      TEXT NOT NULL,
      book_number   INTEGER NOT NULL,
      chapter_count INTEGER NOT NULL,
      text_source   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS words (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id             TEXT NOT NULL UNIQUE,
      book_id             INTEGER NOT NULL,
      chapter             INTEGER NOT NULL,
      verse               INTEGER NOT NULL,
      position_in_verse   INTEGER NOT NULL,
      surface_text        TEXT NOT NULL,
      surface_norm        TEXT,
      lemma               TEXT,
      strong_number       TEXT,
      morph_code          TEXT,
      text_source_id      INTEGER NOT NULL,
      language_id         INTEGER NOT NULL,
      part_of_speech_id   INTEGER,
      person_id           INTEGER,
      gender_id           INTEGER,
      word_number_id      INTEGER,
      tense_id            INTEGER,
      voice_id            INTEGER,
      mood_id             INTEGER,
      stem_id             INTEGER,
      state_id            INTEGER,
      verb_case_id        INTEGER
    );

    CREATE INDEX IF NOT EXISTS words_book_ch_verse_idx ON words (book_id, chapter, verse);
    CREATE INDEX IF NOT EXISTS words_lemma_idx         ON words (lemma);
    CREATE INDEX IF NOT EXISTS words_pos_idx           ON words (part_of_speech_id);
    CREATE INDEX IF NOT EXISTS words_source_idx        ON words (text_source_id);

    CREATE TABLE IF NOT EXISTS verses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      osis_ref    TEXT NOT NULL UNIQUE,
      book_id     INTEGER NOT NULL,
      chapter     INTEGER NOT NULL,
      verse       INTEGER NOT NULL,
      text_source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lexicon_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      strong_number   TEXT NOT NULL UNIQUE,
      language        TEXT NOT NULL,
      lemma           TEXT,
      transliteration TEXT,
      pronunciation   TEXT,
      short_gloss     TEXT,
      definition      TEXT,
      usage           TEXT,
      source          TEXT
    );
    CREATE INDEX IF NOT EXISTS lex_strong_idx ON lexicon_entries (strong_number);
  `);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// If a backup exists, it means source.db was already rebuilt — use the backup as the source.
const oldDbPath = fs.existsSync(BACKUP_PATH) ? BACKUP_PATH : SOURCE_PATH;
console.log(`Opening ${oldDbPath === BACKUP_PATH ? "source.db.bak (backup)" : "source.db"} …`);
const oldDb = new Database(oldDbPath, { readonly: true });

// Build lookup maps from old DB
console.log("Building lookup maps …");
const tsMap  = buildLookup(oldDb, "text_source");
const lngMap = buildLookup(oldDb, "language");
const posMap = buildLookup(oldDb, "part_of_speech");
const perMap = buildLookup(oldDb, "person");
const genMap = buildLookup(oldDb, "gender");
const wnMap  = buildLookup(oldDb, "word_number");
const tenMap = buildLookup(oldDb, "tense");
const voiMap = buildLookup(oldDb, "voice");
const moMap  = buildLookup(oldDb, "mood");
const stMap  = buildLookup(oldDb, "stem");
const staMap = buildLookup(oldDb, "state");
const vcMap  = buildLookup(oldDb, "verb_case");

console.log(`  text_source:    ${[...tsMap.keys()].join(", ")}`);
console.log(`  language:       ${[...lngMap.keys()].join(", ")}`);
console.log(`  part_of_speech: ${posMap.size} values`);
console.log(`  tense:          ${[...tenMap.keys()].join(", ")}`);
console.log(`  voice:          ${[...voiMap.keys()].join(", ")}`);
console.log(`  mood:           ${[...moMap.keys()].join(", ")}`);
console.log(`  stem:           ${[...stMap.keys()].join(", ")}`);

// ── Build source.db (OSHB + SBLGNT only) ──────────────────────────────────────

// Separate lookup maps for source.db (exclude STEPBIBLE_LXX)
const sourceTsMap = new Map<string, number>();
let srcId = 1;
for (const [val] of tsMap) {
  if (val !== "STEPBIBLE_LXX") sourceTsMap.set(val, srcId++);
}

console.log("\nBacking up source.db …");
fs.copyFileSync(SOURCE_PATH, BACKUP_PATH);

const NEW_SOURCE_TMP = SOURCE_PATH + ".new";
console.log("Creating new source.db …");
const newDb = createNewSourceDb(NEW_SOURCE_TMP, 16384);
createSchema(newDb);

// Insert lookup values for source.db (OSHB + SBLGNT only)
createLookupTable(newDb, "text_sources", sourceTsMap);
createLookupTable(newDb, "languages", lngMap);
createLookupTable(newDb, "parts_of_speech", posMap);
createLookupTable(newDb, "persons", perMap);
createLookupTable(newDb, "genders", genMap);
createLookupTable(newDb, "word_numbers", wnMap);
createLookupTable(newDb, "tenses", tenMap);
createLookupTable(newDb, "voices", voiMap);
createLookupTable(newDb, "moods", moMap);
createLookupTable(newDb, "stems", stMap);
createLookupTable(newDb, "states", staMap);
createLookupTable(newDb, "verb_cases", vcMap);

// Copy books
console.log("Copying books …");
const bookRows = oldDb.prepare("SELECT * FROM books").all() as Record<string, unknown>[];
const insBook = newDb.prepare(`
  INSERT INTO books (id, osis_code, name, testament, language, book_number, chapter_count, text_source)
  VALUES (@id, @osis_code, @name, @testament, @language, @book_number, @chapter_count, @text_source)
`);
newDb.transaction(() => { for (const row of bookRows) insBook.run(row); })();
console.log(`  Copied ${bookRows.length} books`);

// Copy words (source only — skip STEPBIBLE_LXX)
console.log("Copying words (OSHB + SBLGNT) …");
const srcWordRows = oldDb.prepare(
  "SELECT * FROM words WHERE text_source != 'STEPBIBLE_LXX'"
).all() as Record<string, unknown>[];

const insWord = newDb.prepare(`
  INSERT INTO words (
    id, word_id, book_id, chapter, verse, position_in_verse,
    surface_text, surface_norm, lemma, strong_number, morph_code,
    text_source_id, language_id, part_of_speech_id,
    person_id, gender_id, word_number_id, tense_id, voice_id,
    mood_id, stem_id, state_id, verb_case_id
  ) VALUES (
    @id, @word_id, @book_id, @chapter, @verse, @position_in_verse,
    @surface_text, @surface_norm, @lemma, @strong_number, @morph_code,
    @text_source_id, @language_id, @part_of_speech_id,
    @person_id, @gender_id, @word_number_id, @tense_id, @voice_id,
    @mood_id, @stem_id, @state_id, @verb_case_id
  )
`);

newDb.transaction(() => {
  for (const row of srcWordRows) {
    insWord.run({
      id:               row.id,
      word_id:          row.word_id,
      book_id:          row.book_id,
      chapter:          row.chapter,
      verse:            row.verse,
      position_in_verse: row.position_in_verse,
      surface_text:     row.surface_text,
      surface_norm:     row.surface_norm ?? null,
      lemma:            row.lemma ?? null,
      strong_number:    row.strong_number ?? null,
      morph_code:       row.morph_code ?? null,
      text_source_id:   sourceTsMap.get(row.text_source as string) ?? 1,
      language_id:      lngMap.get(row.language as string) ?? 1,
      part_of_speech_id: row.part_of_speech != null ? posMap.get(row.part_of_speech as string) ?? null : null,
      person_id:        row.person != null ? perMap.get(row.person as string) ?? null : null,
      gender_id:        row.gender != null ? genMap.get(row.gender as string) ?? null : null,
      word_number_id:   row.word_number != null ? wnMap.get(row.word_number as string) ?? null : null,
      tense_id:         row.tense != null ? tenMap.get(row.tense as string) ?? null : null,
      voice_id:         row.voice != null ? voiMap.get(row.voice as string) ?? null : null,
      mood_id:          row.mood != null ? moMap.get(row.mood as string) ?? null : null,
      stem_id:          row.stem != null ? stMap.get(row.stem as string) ?? null : null,
      state_id:         row.state != null ? staMap.get(row.state as string) ?? null : null,
      verb_case_id:     row.verb_case != null ? vcMap.get(row.verb_case as string) ?? null : null,
    });
  }
})();
console.log(`  Copied ${srcWordRows.length} words`);

// Copy verses
console.log("Copying verses …");
const verseRows = oldDb.prepare("SELECT * FROM verses").all() as Record<string, unknown>[];
const insVerse = newDb.prepare(`
  INSERT INTO verses (id, osis_ref, book_id, chapter, verse, text_source)
  VALUES (@id, @osis_ref, @book_id, @chapter, @verse, @text_source)
`);
newDb.transaction(() => { for (const row of verseRows) insVerse.run(row); })();
console.log(`  Copied ${verseRows.length} verses`);

// Copy lexicon_entries
console.log("Copying lexicon entries …");
const lexRows = oldDb.prepare("SELECT * FROM lexicon_entries").all() as Record<string, unknown>[];
if (lexRows.length > 0) {
  const insLex = newDb.prepare(`
    INSERT INTO lexicon_entries (id, strong_number, language, lemma, transliteration, pronunciation, short_gloss, definition, usage, source)
    VALUES (@id, @strong_number, @language, @lemma, @transliteration, @pronunciation, @short_gloss, @definition, @usage, @source)
  `);
  newDb.transaction(() => { for (const row of lexRows) insLex.run(row); })();
  console.log(`  Copied ${lexRows.length} lexicon entries`);
} else {
  console.log("  No lexicon entries to copy");
}

console.log("Vacuuming new source.db …");
newDb.exec("VACUUM");
newDb.close();

// Replace old source.db with new one
fs.renameSync(NEW_SOURCE_TMP, SOURCE_PATH);
console.log("✓ source.db rebuilt");

// ── Build lxx.db ──────────────────────────────────────────────────────────────

// lxx.db has its own lookup table with just "STEPBIBLE_LXX"
const lxxTsMap = new Map<string, number>([["STEPBIBLE_LXX", 1]]);
// language: only "greek" — share the same IDs as lngMap
const lxxLngMap = new Map<string, number>();
for (const [val, id] of lngMap) {
  if (val === "greek") lxxLngMap.set(val, id);
}
// For other morph lookups in lxx.db, discover from LXX words only
function buildLxxLookup(col: string): Map<string, number> {
  const rows = oldDb.prepare(`SELECT DISTINCT ${col} FROM words WHERE text_source = 'STEPBIBLE_LXX' AND ${col} IS NOT NULL ORDER BY ${col}`).all() as { [key: string]: string }[];
  const map = new Map<string, number>();
  let id = 1;
  for (const row of rows) { map.set(row[col], id++); }
  return map;
}

const lxxPosMap = buildLxxLookup("part_of_speech");
const lxxPerMap = buildLxxLookup("person");
const lxxGenMap = buildLxxLookup("gender");
const lxxWnMap  = buildLxxLookup("word_number");
const lxxTenMap = buildLxxLookup("tense");
const lxxVoiMap = buildLxxLookup("voice");
const lxxMoMap  = buildLxxLookup("mood");
const lxxStMap  = buildLxxLookup("stem");
const lxxStaMap = buildLxxLookup("state");
const lxxVcMap  = buildLxxLookup("verb_case");

// Ensure "greek" exists in lxxLngMap (it must since LXX is always greek)
if (!lxxLngMap.has("greek")) lxxLngMap.set("greek", 1);

console.log("\nCreating lxx.db …");
const lxxDb = createNewSourceDb(LXX_PATH, 16384);
createSchema(lxxDb);

// Insert lookup values for lxx.db
createLookupTable(lxxDb, "text_sources",   lxxTsMap);
createLookupTable(lxxDb, "languages",      lxxLngMap);
createLookupTable(lxxDb, "parts_of_speech", lxxPosMap);
createLookupTable(lxxDb, "persons",        lxxPerMap);
createLookupTable(lxxDb, "genders",        lxxGenMap);
createLookupTable(lxxDb, "word_numbers",   lxxWnMap);
createLookupTable(lxxDb, "tenses",         lxxTenMap);
createLookupTable(lxxDb, "voices",         lxxVoiMap);
createLookupTable(lxxDb, "moods",          lxxMoMap);
createLookupTable(lxxDb, "stems",          lxxStMap);
createLookupTable(lxxDb, "states",         lxxStaMap);
createLookupTable(lxxDb, "verb_cases",     lxxVcMap);

// Copy LXX books to lxx.db
const insLxxBook = lxxDb.prepare(`
  INSERT INTO books (id, osis_code, name, testament, language, book_number, chapter_count, text_source)
  VALUES (@id, @osis_code, @name, @testament, @language, @book_number, @chapter_count, @text_source)
`);
const lxxBookRows = bookRows.filter(row => row.text_source === "STEPBIBLE_LXX");
lxxDb.transaction(() => { for (const row of lxxBookRows) insLxxBook.run(row); })();
console.log(`  Copied ${lxxBookRows.length} LXX books`);

// lxx.db words — LXX only
console.log("Copying LXX words to lxx.db …");
const lxxWordRows = oldDb.prepare(
  "SELECT * FROM words WHERE text_source = 'STEPBIBLE_LXX'"
).all() as Record<string, unknown>[];

const insLxxWord = lxxDb.prepare(`
  INSERT INTO words (
    id, word_id, book_id, chapter, verse, position_in_verse,
    surface_text, surface_norm, lemma, strong_number, morph_code,
    text_source_id, language_id, part_of_speech_id,
    person_id, gender_id, word_number_id, tense_id, voice_id,
    mood_id, stem_id, state_id, verb_case_id
  ) VALUES (
    @id, @word_id, @book_id, @chapter, @verse, @position_in_verse,
    @surface_text, @surface_norm, @lemma, @strong_number, @morph_code,
    @text_source_id, @language_id, @part_of_speech_id,
    @person_id, @gender_id, @word_number_id, @tense_id, @voice_id,
    @mood_id, @stem_id, @state_id, @verb_case_id
  )
`);

lxxDb.transaction(() => {
  for (const row of lxxWordRows) {
    insLxxWord.run({
      id:               row.id,
      word_id:          row.word_id,
      book_id:          row.book_id,
      chapter:          row.chapter,
      verse:            row.verse,
      position_in_verse: row.position_in_verse,
      surface_text:     row.surface_text,
      surface_norm:     row.surface_norm ?? null,
      lemma:            row.lemma ?? null,
      strong_number:    row.strong_number ?? null,
      morph_code:       row.morph_code ?? null,
      text_source_id:   1, // always "STEPBIBLE_LXX"
      language_id:      lxxLngMap.get("greek") ?? 1,
      part_of_speech_id: row.part_of_speech != null ? lxxPosMap.get(row.part_of_speech as string) ?? null : null,
      person_id:        row.person != null ? lxxPerMap.get(row.person as string) ?? null : null,
      gender_id:        row.gender != null ? lxxGenMap.get(row.gender as string) ?? null : null,
      word_number_id:   row.word_number != null ? lxxWnMap.get(row.word_number as string) ?? null : null,
      tense_id:         row.tense != null ? lxxTenMap.get(row.tense as string) ?? null : null,
      voice_id:         row.voice != null ? lxxVoiMap.get(row.voice as string) ?? null : null,
      mood_id:          row.mood != null ? lxxMoMap.get(row.mood as string) ?? null : null,
      stem_id:          row.stem != null ? lxxStMap.get(row.stem as string) ?? null : null,
      state_id:         row.state != null ? lxxStaMap.get(row.state as string) ?? null : null,
      verb_case_id:     row.verb_case != null ? lxxVcMap.get(row.verb_case as string) ?? null : null,
    });
  }
})();
console.log(`  Copied ${lxxWordRows.length} LXX words`);

console.log("Vacuuming lxx.db …");
lxxDb.exec("VACUUM");
lxxDb.close();
oldDb.close();

console.log("\n✓ Done!");
console.log(`  source.db: OSHB + SBLGNT (${srcWordRows.length.toLocaleString()} words)`);
console.log(`  lxx.db:    STEPBIBLE_LXX (${lxxWordRows.length.toLocaleString()} words)`);
console.log(`  Backup at: ${BACKUP_PATH}`);
console.log("\n  Restart the dev server to pick up the new databases.");
