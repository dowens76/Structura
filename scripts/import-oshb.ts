/**
 * Import script: Open Scriptures Hebrew Bible (OSHB)
 * Source: openscriptures/morphhb (bundled as npm package 'morphhb')
 * Parses OSIS XML files and inserts words into the SQLite database.
 *
 * Run: npm run import:oshb
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, count } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { parseOshbMorph, parseOshbLemma } from "../lib/morphology/oshb-parser";
import { OSIS_BOOKS_OT, OSIS_BOOK_NAMES } from "../lib/utils/osis";
import { getChapterCount } from "../lib/utils/scripture";

const DB_PATH = path.join(process.cwd(), "data", "source.db");
const WLC_PATH = path.join(process.cwd(), "node_modules", "morphhb", "wlc");

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// ── Lookup table helpers ──────────────────────────────────────────────────────
const lookupCache = new Map<string, number>();

function getLookupId(table: string, value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const key = `${table}:${value}`;
  if (lookupCache.has(key)) return lookupCache.get(key)!;
  // Check before inserting to avoid creating duplicates (no UNIQUE constraint on value).
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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["w", "verse", "chapter", "div", "seg", "note"].includes(name),
});

// OSHB filename stem → OSIS code (filename = osisCode + ".xml")
const OSHB_FILE_TO_OSIS: Record<string, string> = {
  Gen: "Gen", Exod: "Exod", Lev: "Lev", Num: "Num", Deut: "Deut",
  Josh: "Josh", Judg: "Judg", Ruth: "Ruth",
  "1Sam": "1Sam", "2Sam": "2Sam", "1Kgs": "1Kgs", "2Kgs": "2Kgs",
  "1Chr": "1Chr", "2Chr": "2Chr", Ezra: "Ezra", Neh: "Neh",
  Esth: "Esth", Job: "Job", Ps: "Ps", Prov: "Prov",
  Eccl: "Eccl", Song: "Song", Isa: "Isa", Jer: "Jer",
  Lam: "Lam", Ezek: "Ezek", Dan: "Dan", Hos: "Hos",
  Joel: "Joel", Amos: "Amos", Obad: "Obad", Jonah: "Jonah",
  Mic: "Mic", Nah: "Nah", Hab: "Hab", Zeph: "Zeph",
  Hag: "Hag", Zech: "Zech", Mal: "Mal",
};

const BOOK_FILES = readdirSync(WLC_PATH)
  .filter((f) => f.endsWith(".xml"))
  .sort();

function processWordElement(
  wEl: Record<string, unknown>,
  osisRef: string,
  bookId: number,
  chapter: number,
  verse: number,
  position: number
): schema.NewWord | null {
  const morphCode = String(wEl["@_morph"] ?? "");
  const lemmaRaw = String(wEl["@_lemma"] ?? "");
  const wordId = String(wEl["@_id"] ?? `${osisRef}.${position}`);
  const surfaceText = String(wEl["#text"] ?? "").trim();

  if (!surfaceText) return null;

  // Strip cantillation marks (keep consonants + vowel points)
  const surfaceNorm = surfaceText
    .replace(/[\u0591-\u05AF\u05BD-\u05C7]/g, "")
    .trim() || null;

  const { strongNumber, lemmaText } = parseOshbLemma(lemmaRaw);
  const morph = parseOshbMorph(morphCode);

  return {
    wordId,
    bookId,
    chapter,
    verse,
    positionInVerse: position,
    surfaceText,
    surfaceNorm,
    lemma: lemmaText,
    strongNumber,
    morphCode: morphCode || null,
    textSourceId:   reqLookupId("text_sources", "OSHB"),
    languageId:     reqLookupId("languages", "hebrew"),
    partOfSpeechId: getLookupId("parts_of_speech", morph.partOfSpeech),
    personId:       getLookupId("persons", morph.person),
    genderId:       getLookupId("genders", morph.gender),
    wordNumberId:   getLookupId("word_numbers", morph.wordNumber),
    tenseId:        getLookupId("tenses", morph.tense),
    voiceId:        getLookupId("voices", morph.voice),
    moodId:         getLookupId("moods", morph.mood),
    stemId:         getLookupId("stems", morph.stem),
    stateId:        getLookupId("states", morph.state),
    verbCaseId:     getLookupId("verb_cases", morph.verbCase),
  };
}

function insertBatch(wordBatch: schema.NewWord[], verseBatch: schema.NewVerse[]) {
  if (wordBatch.length === 0) return;
  db.insert(schema.words).values(wordBatch).onConflictDoNothing().run();
  if (verseBatch.length > 0) {
    db.insert(schema.verses).values(verseBatch).onConflictDoNothing().run();
  }
}

function getOrCreateBook(osisCode: string): number {
  const existing = db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(eq(schema.books.osisCode, osisCode))
    .get();
  if (existing) return existing.id;

  const bookName = OSIS_BOOK_NAMES[osisCode] ?? osisCode;
  const chapterCount = getChapterCount(osisCode);
  const [inserted] = db
    .insert(schema.books)
    .values({
      osisCode,
      name: bookName,
      testament: "OT",
      language: "hebrew",
      bookNumber: OSIS_BOOKS_OT.indexOf(osisCode) + 1,
      chapterCount,
      textSource: "OSHB",
    })
    .returning()
    .all();
  return inserted.id;
}

function importBook(xmlFile: string): void {
  const fileStem = xmlFile.replace(".xml", "");
  const osisCode = OSHB_FILE_TO_OSIS[fileStem];
  if (!osisCode) {
    console.warn(`  No OSIS code for ${xmlFile}, skipping`);
    return;
  }

  const bookId = getOrCreateBook(osisCode);

  const rawXml = readFileSync(path.join(WLC_PATH, xmlFile), "utf-8");

  // Merge <seg> punctuation elements into the text of the preceding <w> element.
  // e.g. </w><seg type="x-sof-pasuq">׃</seg>  →  ׃</w>
  //      </w><seg type="x-maqqef">־</seg>       →  ־</w>
  //      </w><seg type="x-paseq">׀</seg>        →  ׀</w>
  const xml = rawXml.replace(
    /<\/w>(\s*)<seg type="x-(?:sof-pasuq|maqqef|paseq)">([^<]+)<\/seg>/g,
    "$2</w>$1"
  );

  const parsed = xmlParser.parse(xml);

  const osisText = parsed?.osis?.osisText;
  if (!osisText) {
    console.error(`  Could not parse XML for ${xmlFile}`);
    return;
  }

  const divs = Array.isArray(osisText.div) ? osisText.div : osisText.div ? [osisText.div] : [];

  let totalWords = 0;
  const BATCH_SIZE = 500;
  let wordBatch: schema.NewWord[] = [];
  let verseBatch: schema.NewVerse[] = [];

  for (const div of divs) {
    if (!div) continue;
    const chapters = Array.isArray(div.chapter) ? div.chapter : div.chapter ? [div.chapter] : [];

    for (const chapter of chapters) {
      if (!chapter) continue;
      const chapterOsisId = String(chapter["@_osisID"] ?? "");
      const chNum = parseInt(chapterOsisId.split(".")[1] ?? "1", 10);

      const verses = Array.isArray(chapter.verse) ? chapter.verse : chapter.verse ? [chapter.verse] : [];

      for (const verse of verses) {
        if (!verse) continue;
        const verseOsisId = String(verse["@_osisID"] ?? "");
        const vParts = verseOsisId.split(".");
        const vNum = parseInt(vParts[2] ?? "1", 10);
        const osisRef = `${osisCode}.${chNum}.${vNum}`;

        verseBatch.push({ osisRef, bookId, chapter: chNum, verse: vNum, textSource: "OSHB" });

        const wElements = Array.isArray(verse.w) ? verse.w : [];
        let position = 1;

        for (const wEl of wElements) {
          if (!wEl || typeof wEl !== "object") continue;
          const word = processWordElement(
            wEl as Record<string, unknown>,
            osisRef, bookId, chNum, vNum, position
          );
          if (word) {
            wordBatch.push(word);
            position++;
            totalWords++;
          }
        }

        if (wordBatch.length >= BATCH_SIZE) {
          insertBatch(wordBatch, verseBatch);
          wordBatch = [];
          verseBatch = [];
        }
      }
    }
  }

  insertBatch(wordBatch, verseBatch);
  console.log(` ${totalWords.toLocaleString()} words`);
}

function main() {
  console.log("Importing OSHB (Open Scriptures Hebrew Bible)...\n");

  db.delete(schema.words).where(eq(schema.words.textSourceId, reqLookupId("text_sources", "OSHB"))).run();
  db.delete(schema.verses).where(eq(schema.verses.textSource, "OSHB")).run();
  // Do NOT delete books — preserve existing IDs so lxx.db and other references stay consistent.
  console.log("Cleared existing OSHB words and verses.\n");

  for (const file of BOOK_FILES) {
    process.stdout.write(`  ${file.replace(".xml", "").padEnd(8)}`);
    importBook(file);
  }

  const [result] = db
    .select({ total: count() })
    .from(schema.words)
    .where(eq(schema.words.textSourceId, reqLookupId("text_sources", "OSHB")))
    .all();

  console.log(`\nDone! Total OSHB words: ${result.total.toLocaleString()}`);
}

main();
