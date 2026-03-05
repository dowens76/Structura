/**
 * Import script: MorphGNT SBLGNT (Greek New Testament)
 * Source: https://github.com/morphgnt/sblgnt
 * Downloads text files from GitHub and inserts words into SQLite.
 *
 * Run: npm run import:morphgnt
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, count } from "drizzle-orm";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { parseMorphgntCode, MORPHGNT_FILES } from "../lib/morphology/morphgnt-parser";
import { OSIS_BOOKS_NT, OSIS_BOOK_NAMES } from "../lib/utils/osis";
import { getChapterCount } from "../lib/utils/scripture";

const DB_PATH = path.join(process.cwd(), "data", "structura.db");
const SOURCES_PATH = path.join(process.cwd(), "data", "sources", "morphgnt");
const BASE_URL = "https://raw.githubusercontent.com/morphgnt/sblgnt/master";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

mkdirSync(SOURCES_PATH, { recursive: true });

async function downloadFile(filename: string): Promise<void> {
  const dest = path.join(SOURCES_PATH, filename);
  if (existsSync(dest)) return;
  const url = `${BASE_URL}/${filename}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  writeFileSync(dest, await response.text(), "utf-8");
}

function parseRefCode(refCode: string): { chapter: number; verse: number } {
  // refCode is 6 digits: BBCCVV
  const chapter = parseInt(refCode.slice(2, 4), 10);
  const verse = parseInt(refCode.slice(4, 6), 10);
  return { chapter, verse };
}

function getOrCreateBook(
  osisCode: string,
  bookNumber: number
): number {
  const existing = db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(eq(schema.books.osisCode, osisCode))
    .get();
  if (existing) return existing.id;

  const [inserted] = db
    .insert(schema.books)
    .values({
      osisCode,
      name: OSIS_BOOK_NAMES[osisCode] ?? osisCode,
      testament: "NT",
      language: "greek",
      bookNumber,
      chapterCount: getChapterCount(osisCode),
      textSource: "SBLGNT",
    })
    .returning()
    .all();
  return inserted.id;
}

function importBook(
  fileInfo: (typeof MORPHGNT_FILES)[0],
  bookId: number
): number {
  const filePath = path.join(SOURCES_PATH, fileInfo.filename);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const BATCH_SIZE = 500;
  let wordBatch: schema.NewWord[] = [];
  let verseBatch: schema.NewVerse[] = [];
  const seenVerses = new Set<string>();

  let totalWords = 0;
  let position = 1;
  let lastVerseRef = "";

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;

    const [refCode, posCode, parseCode, textRaw, , normalized, lemma] = parts;

    const { chapter, verse } = parseRefCode(refCode);
    const osisRef = `${fileInfo.osisCode}.${chapter}.${verse}`;

    if (osisRef !== lastVerseRef) {
      position = 1;
      lastVerseRef = osisRef;
      if (!seenVerses.has(osisRef)) {
        seenVerses.add(osisRef);
        verseBatch.push({ osisRef, bookId, chapter, verse, textSource: "SBLGNT" });
      }
    }

    // Strip trailing punctuation for surface text
    const surfaceText = textRaw.replace(/[.,;:·?!'"»«\u037E\u0387\u002C\u002E]+$/, "");
    const morph = parseMorphgntCode(posCode, parseCode);
    const wordId = `GNT.${fileInfo.prefix}.${chapter}.${verse}.${position}`;

    wordBatch.push({
      wordId,
      osisRef,
      bookId,
      chapter,
      verse,
      positionInVerse: position,
      surfaceText: surfaceText || textRaw,
      surfaceNorm: normalized || null,
      lemma: lemma || null,
      strongNumber: null,
      morphCode: `${posCode} ${parseCode}`,
      partOfSpeech: morph.partOfSpeech,
      person: morph.person,
      gender: morph.gender,
      wordNumber: morph.wordNumber,
      tense: morph.tense,
      voice: morph.voice,
      mood: morph.mood,
      stem: null,
      state: null,
      verbCase: morph.verbCase,
      language: "greek",
      textSource: "SBLGNT",
    });

    position++;
    totalWords++;

    if (wordBatch.length >= BATCH_SIZE) {
      db.insert(schema.words).values(wordBatch).onConflictDoNothing().run();
      db.insert(schema.verses).values(verseBatch).onConflictDoNothing().run();
      wordBatch = [];
      verseBatch = [];
    }
  }

  if (wordBatch.length > 0) {
    db.insert(schema.words).values(wordBatch).onConflictDoNothing().run();
    db.insert(schema.verses).values(verseBatch).onConflictDoNothing().run();
  }

  return totalWords;
}

async function main() {
  console.log("Importing MorphGNT SBLGNT (Greek New Testament)...\n");

  db.delete(schema.words).where(eq(schema.words.textSource, "SBLGNT")).run();
  db.delete(schema.verses).where(eq(schema.verses.textSource, "SBLGNT")).run();
  db.delete(schema.books).where(eq(schema.books.textSource, "SBLGNT")).run();
  console.log("Cleared existing SBLGNT data.\n");

  for (let i = 0; i < MORPHGNT_FILES.length; i++) {
    const fileInfo = MORPHGNT_FILES[i];
    process.stdout.write(`  Downloading ${fileInfo.filename}...`);
    try {
      await downloadFile(fileInfo.filename);
      console.log(" ok");
    } catch (e) {
      console.error(` FAILED: ${e}`);
      continue;
    }

    const bookId = getOrCreateBook(fileInfo.osisCode, OSIS_BOOKS_NT.indexOf(fileInfo.osisCode) + 1);

    process.stdout.write(`  Importing ${fileInfo.osisCode.padEnd(8)}`);
    const cnt = importBook(fileInfo, bookId);
    console.log(` ${cnt.toLocaleString()} words`);
  }

  const [result] = db
    .select({ total: count() })
    .from(schema.words)
    .where(eq(schema.words.textSource, "SBLGNT"))
    .all();

  console.log(`\nDone! Total SBLGNT words: ${result.total.toLocaleString()}`);
}

main().catch(console.error);
