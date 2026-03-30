/**
 * Import script: Septuagint (LXX) from LXX-Rahlfs-1935
 * Source: https://github.com/eliranwong/LXX-Rahlfs-1935
 * License: CC BY-NC-SA 4.0 (non-commercial, for research use)
 *
 * Downloads and parses three files:
 *   - 01_wordlist_unicode/text_accented.csv    → word_id, lexeme_id, greek_text
 *   - 03a_morphology.../patched_623685.csv     → word_id, morph_code
 *   - 08_versification/001_verse_c_modified_KEEP.csv → verse_ref, first_word_id
 *
 * Run: npm run import:lxx
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, count } from "drizzle-orm";
import { mkdirSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { OSIS_BOOK_NAMES } from "../lib/utils/osis";

const SOURCE_DB_PATH = path.join(process.cwd(), "data", "source.db");
const LXX_DB_PATH    = path.join(process.cwd(), "data", "lxx.db");
const SOURCES_PATH = path.join(process.cwd(), "data", "sources", "lxx");
const BASE_URL = "https://raw.githubusercontent.com/eliranwong/LXX-Rahlfs-1935/master";

// LXX words are stored in a separate lxx.db (optimized archive)
if (existsSync(LXX_DB_PATH)) unlinkSync(LXX_DB_PATH);
const sqlite = new Database(LXX_DB_PATH);
sqlite.pragma("page_size = 16384");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = OFF"); // off during bulk load

// Create the same schema as source.db
sqlite.exec(`
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
  CREATE INDEX IF NOT EXISTS words_source_idx ON words (text_source_id);

  CREATE TABLE IF NOT EXISTS verses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    osis_ref    TEXT NOT NULL UNIQUE,
    book_id     INTEGER NOT NULL,
    chapter     INTEGER NOT NULL,
    verse       INTEGER NOT NULL,
    text_source TEXT NOT NULL
  );
`);

// Copy ALL books from source.db into lxx.db (preserving IDs so cross-db bookId lookups work)
const sourceDb = new Database(SOURCE_DB_PATH, { readonly: true });
const allBooks = sourceDb.prepare(
  "SELECT id, osis_code, name, testament, language, book_number, chapter_count, text_source FROM books"
).all() as Record<string, unknown>[];
const insBook = sqlite.prepare(
  "INSERT OR IGNORE INTO books (id, osis_code, name, testament, language, book_number, chapter_count, text_source) VALUES (@id, @osis_code, @name, @testament, @language, @book_number, @chapter_count, @text_source)"
);
sqlite.transaction(() => { for (const b of allBooks) insBook.run(b); })();
console.log(`Copied ${allBooks.length} books from source.db (preserving IDs)`);
sourceDb.close();

const db = drizzle(sqlite, { schema });

// ── Lookup table helpers ──────────────────────────────────────────────────────
const lookupCache = new Map<string, number>();

function getLookupId(table: string, value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const key = `${table}:${value}`;
  if (lookupCache.has(key)) return lookupCache.get(key)!;
  const existing = sqlite.prepare(`SELECT id FROM ${table} WHERE value = ? LIMIT 1`).get(value) as { id: number } | undefined;
  if (existing) { lookupCache.set(key, existing.id); return existing.id; }
  sqlite.prepare(`INSERT INTO ${table} (value) VALUES (?)`).run(value);
  const id = (sqlite.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  lookupCache.set(key, id);
  return id;
}

function reqLookupId(table: string, value: string): number {
  return getLookupId(table, value)!;
}

mkdirSync(SOURCES_PATH, { recursive: true });

async function downloadFile(remotePath: string, localName: string): Promise<string> {
  const dest = path.join(SOURCES_PATH, localName);
  if (existsSync(dest)) {
    process.stdout.write(` (cached)`);
    return dest;
  }
  const url = `${BASE_URL}/${remotePath}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  writeFileSync(dest, await response.text(), "utf-8");
  return dest;
}

function parseLxxMorph(code: string) {
  const result = {
    partOfSpeech: null as string | null,
    verbCase: null as string | null,
    wordNumber: null as string | null,
    gender: null as string | null,
    tense: null as string | null,
    voice: null as string | null,
    mood: null as string | null,
    person: null as string | null,
  };

  if (!code) return result;

  const [pos, features] = code.split(".");

  const posMap: Record<string, string> = {
    N: "noun", V: "verb", A: "adjective", D: "adverb",
    P: "preposition", C: "conjunction", RA: "article",
    RD: "demonstrative pronoun", RI: "interrogative pronoun",
    RP: "personal pronoun", RR: "relative pronoun",
    X: "particle", I: "interjection",
  };
  result.partOfSpeech = posMap[pos] ?? pos.toLowerCase();

  if (!features) return result;

  const caseMap: Record<string, string> = {
    N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative",
  };
  const numMap: Record<string, string> = { S: "singular", P: "plural" };
  const genMap: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" };
  const tenseMap: Record<string, string> = {
    P: "present", I: "imperfect", F: "future", A: "aorist", R: "perfect", X: "pluperfect",
  };
  const voiceMap: Record<string, string> = { A: "active", M: "middle", P: "passive" };
  const moodMap: Record<string, string> = {
    I: "indicative", S: "subjunctive", D: "imperative",
    O: "optative", N: "infinitive", P: "participle",
  };

  if (pos === "V") {
    result.tense = tenseMap[features[0]] ?? null;
    result.voice = voiceMap[features[1]] ?? null;
    result.mood = moodMap[features[2]] ?? null;
    if (features[3] && ["1", "2", "3"].includes(features[3])) result.person = features[3];
    if (features[4]) result.wordNumber = numMap[features[4]] ?? null;
  } else {
    if (features[0]) result.verbCase = caseMap[features[0]] ?? null;
    if (features[1]) result.wordNumber = numMap[features[1]] ?? null;
    if (features[2]) result.gender = genMap[features[2]] ?? null;
  }

  return result;
}

const LXX_BOOK_ORDER = [
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth",
  "1Sam", "2Sam", "1Kgs", "2Kgs", "1Chr", "2Chr", "Ezra", "Neh",
  "Esth", "Jdt", "Tob", "1Macc", "2Macc", "3Macc", "4Macc",
  "Job", "Ps", "Prov", "Eccl", "Song", "Wis", "Sir",
  "Isa", "Jer", "Lam", "EpJer", "Bar", "Ezek", "Dan",
  "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah",
  "Hab", "Zeph", "Hag", "Zech", "Mal",
];

async function main() {
  console.log("Importing LXX (Septuagint) from eliranwong/LXX-Rahlfs-1935...\n");
  console.log("License: CC BY-NC-SA 4.0 - for research/non-commercial use\n");

  console.log("Downloading data files...");

  process.stdout.write("  Verse map...");
  const verseMapPath = await downloadFile(
    "08_versification/001_verse_c_modified_KEEP.csv", "verse_map.csv"
  );
  console.log(" ok");

  process.stdout.write("  Word text (~16MB)...");
  const wordTextPath = await downloadFile(
    "01_wordlist_unicode/text_accented.csv", "text_accented.csv"
  );
  console.log(" ok");

  process.stdout.write("  Morphology (~8MB)...");
  const morphPath = await downloadFile(
    "03a_morphology_with_JTauber_patches/patched_623685.csv", "morphology.csv"
  );
  console.log(" ok");

  // Build verse map: word_id → osisRef
  console.log("\nBuilding verse→word index...");
  const verseLines = readFileSync(verseMapPath, "utf-8").split("\n").filter(l => l.trim());
  const verseStarts: Array<{ osisRef: string; startWordId: number }> = [];

  for (const line of verseLines) {
    const [ref, wordIdStr] = line.split("\t");
    if (!ref || !wordIdStr) continue;
    const parts = ref.split(".");
    if (parts.length < 3) continue;
    const osisRef = `${parts[0]}.${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
    verseStarts.push({ osisRef, startWordId: parseInt(wordIdStr, 10) });
  }

  // Sort verseStarts by word ID for binary search
  verseStarts.sort((a, b) => a.startWordId - b.startWordId);
  const verseStartIds = verseStarts.map(v => v.startWordId);

  function getVerseForWordId(wordId: number): string | undefined {
    // Binary search for the verse that contains this word_id
    let lo = 0, hi = verseStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (verseStartIds[mid] <= wordId) lo = mid + 1;
      else hi = mid - 1;
    }
    const idx = lo - 1;
    if (idx < 0) return undefined;
    return verseStarts[idx].osisRef;
  }

  console.log(`  ${verseStarts.length.toLocaleString()} verse boundaries loaded`);

  // Load morphology
  console.log("Loading morphology...");
  const morphLines = readFileSync(morphPath, "utf-8").split("\n");
  const morphMap = new Map<number, string>();
  for (const line of morphLines) {
    const [idStr, code] = line.split("\t");
    if (!idStr || !code) continue;
    morphMap.set(parseInt(idStr, 10), code.trim());
  }
  console.log(`  ${morphMap.size.toLocaleString()} morphology entries loaded`);

  // lxx.db is freshly created — no need to clear old data

  const bookIdMap = new Map<string, number>();
  const seenVerses = new Set<string>();
  const versePositions = new Map<string, number>();

  const BATCH_SIZE = 1000;
  let wordBatch: schema.NewWord[] = [];
  let verseBatch: schema.NewVerse[] = [];
  let totalWords = 0;

  function flush() {
    if (wordBatch.length === 0) return;
    db.insert(schema.words).values(wordBatch).onConflictDoNothing().run();
    if (verseBatch.length > 0)
      db.insert(schema.verses).values(verseBatch).onConflictDoNothing().run();
    wordBatch = [];
    verseBatch = [];
  }

  function getOrCreateBook(osisCode: string): number {
    if (bookIdMap.has(osisCode)) return bookIdMap.get(osisCode)!;
    const existing = db.select({ id: schema.books.id }).from(schema.books)
      .where(eq(schema.books.osisCode, osisCode)).get();
    if (existing) { bookIdMap.set(osisCode, existing.id); return existing.id; }
    const [ins] = db.insert(schema.books).values({
      osisCode,
      name: OSIS_BOOK_NAMES[osisCode] ?? osisCode,
      testament: "LXX",
      language: "greek",
      bookNumber: LXX_BOOK_ORDER.indexOf(osisCode) + 1,
      chapterCount: 50,
      textSource: "STEPBIBLE_LXX",
    }).returning().all();
    bookIdMap.set(osisCode, ins.id);
    return ins.id;
  }

  console.log("Importing words...");
  const textLines = readFileSync(wordTextPath, "utf-8").split("\n");

  for (const line of textLines) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const wordId = parseInt(cols[0], 10);
    const surfaceText = cols[2]?.trim();
    if (!surfaceText || !wordId) continue;

    const osisRef = getVerseForWordId(wordId);
    if (!osisRef) continue;

    const [bookCode, chStr, vStr] = osisRef.split(".");
    const chapter = parseInt(chStr, 10);
    const verse = parseInt(vStr, 10);
    if (!chapter || !verse || isNaN(chapter) || isNaN(verse)) continue;
    const bookId = getOrCreateBook(bookCode);

    const morphCode = morphMap.get(wordId) ?? "";
    const morph = parseLxxMorph(morphCode);
    const pos = (versePositions.get(osisRef) ?? 0) + 1;
    versePositions.set(osisRef, pos);

    if (!seenVerses.has(osisRef)) {
      seenVerses.add(osisRef);
      verseBatch.push({ osisRef, bookId, chapter, verse, textSource: "STEPBIBLE_LXX" });
    }

    wordBatch.push({
      wordId: `LXX.${wordId}`,
      bookId,
      chapter,
      verse,
      positionInVerse: pos,
      surfaceText,
      surfaceNorm: null,
      lemma: null,
      strongNumber: null,
      morphCode: morphCode || null,
      textSourceId:   reqLookupId("text_sources", "STEPBIBLE_LXX"),
      languageId:     reqLookupId("languages", "greek"),
      partOfSpeechId: getLookupId("parts_of_speech", morph.partOfSpeech),
      personId:       getLookupId("persons", morph.person),
      genderId:       getLookupId("genders", morph.gender),
      wordNumberId:   getLookupId("word_numbers", morph.wordNumber),
      tenseId:        getLookupId("tenses", morph.tense),
      voiceId:        getLookupId("voices", morph.voice),
      moodId:         getLookupId("moods", morph.mood),
      stemId:         null,
      stateId:        null,
      verbCaseId:     getLookupId("verb_cases", morph.verbCase),
    });

    totalWords++;
    if (wordBatch.length >= BATCH_SIZE) {
      flush();
      if (totalWords % 100000 === 0) process.stdout.write(`  ${totalWords.toLocaleString()}...\n`);
    }
  }
  flush();

  const [result] = db.select({ total: count() }).from(schema.words).all();
  console.log(`\nDone! Total LXX words: ${result.total.toLocaleString()}`);
}

main().catch(console.error);
