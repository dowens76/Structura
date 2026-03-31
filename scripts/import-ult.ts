/**
 * Import script: UnfoldingWord Literal Text (en_ult)
 * Source: https://git.door43.org/unfoldingWord/en_ult
 *
 * Downloads the USFM archive, strips alignment markup, and stores clean
 * verse text in data/ult.db. Also ensures a translations record exists in
 * user.db for workspace 1 so ULT appears in the translation picker immediately.
 *
 * Run: npm run import:ult
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
// @ts-ignore — Node 18+ has native fetch; no extra import needed

const ULT_DB_PATH    = path.join(process.cwd(), "data", "ult.db");
const USER_DB_PATH   = path.join(process.cwd(), "data", "user.db");
const SOURCES_PATH   = path.join(process.cwd(), "data", "sources", "ult");
const ZIP_PATH       = path.join(SOURCES_PATH, "en_ult-master.zip");
const EXTRACT_PATH   = path.join(SOURCES_PATH, "en_ult-master");
const DOWNLOAD_URL   = "https://git.door43.org/unfoldingWord/en_ult/archive/master.zip";

// ── Paratext 3-letter code → OSIS book ID ─────────────────────────────────────

const PARATEXT_TO_OSIS: Record<string, string> = {
  GEN: "Gen",   EXO: "Exod",  LEV: "Lev",   NUM: "Num",   DEU: "Deut",
  JOS: "Josh",  JDG: "Judg",  RUT: "Ruth",  "1SA": "1Sam", "2SA": "2Sam",
  "1KI": "1Kgs","2KI": "2Kgs","1CH": "1Chr","2CH": "2Chr", EZR: "Ezra",
  NEH: "Neh",   EST: "Esth",  JOB: "Job",   PSA: "Ps",    PRO: "Prov",
  ECC: "Eccl",  SNG: "Song",  ISA: "Isa",   JER: "Jer",   LAM: "Lam",
  EZK: "Ezek",  DAN: "Dan",   HOS: "Hos",   JOL: "Joel",  AMO: "Amos",
  OBA: "Obad",  JON: "Jonah", MIC: "Mic",   NAM: "Nah",   HAB: "Hab",
  ZEP: "Zeph",  HAG: "Hag",   ZEC: "Zech",  MAL: "Mal",
  MAT: "Matt",  MRK: "Mark",  LUK: "Luke",  JHN: "John",  ACT: "Acts",
  ROM: "Rom",   "1CO": "1Cor","2CO": "2Cor", GAL: "Gal",   EPH: "Eph",
  PHP: "Phil",  COL: "Col",   "1TH": "1Thess","2TH": "2Thess",
  "1TI": "1Tim","2TI": "2Tim", TIT: "Titus", PHM: "Phlm",  HEB: "Heb",
  JAS: "Jas",   "1PE": "1Pet","2PE": "2Pet", "1JN": "1John","2JN": "2John",
  "3JN": "3John",JUD: "Jude", REV: "Rev",
};

// ── USFM stripping ─────────────────────────────────────────────────────────────

/**
 * Extract clean verse text from a USFM line body (everything after \v N ).
 * Handles USFM 3.0 alignment markers used by en_ult.
 */
function stripUsfm(raw: string): string {
  let s = raw;

  // Remove \zaln-s |...attributes...\* … content … \zaln-e\*
  // The content between zaln-s and zaln-e is kept; only the wrapper tags are removed.
  s = s.replace(/\\zaln-s\s+\|[^*]*\\\*/g, "");
  s = s.replace(/\\zaln-e\\\*/g, "");

  // Replace \w word|metadata\w* with just the word
  s = s.replace(/\\w\s+(.*?)\|[^\\]*\\w\*/g, "$1");

  // Remove remaining inline markers: \add…\add*, \nd…\nd*, \sc…\sc*, etc.
  // Keep the inner text
  s = s.replace(/\\[a-z]+[0-9]*\s+(.*?)\\[a-z]+[0-9]*\*/g, "$1");

  // Remove standalone opening markers like \p, \m, \q1, \b, \s1, etc.
  s = s.replace(/\\[a-z]+[0-9]*/g, "");

  // Remove leftover \* or |...
  s = s.replace(/\\\*/g, "");
  s = s.replace(/\|[^\s]*/g, "");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ── Parse one USFM file → array of { chapter, verse, text } ──────────────────

interface VerseEntry {
  chapter: number;
  verse: number;
  text: string;
}

function parseUsfm(content: string): VerseEntry[] {
  const lines = content.split(/\r?\n/);
  const results: VerseEntry[] = [];
  let currentChapter = 0;
  let currentVerse = 0;
  let currentLines: string[] = [];

  function flush() {
    if (currentChapter > 0 && currentVerse > 0 && currentLines.length > 0) {
      const raw = currentLines.join(" ");
      const text = stripUsfm(raw);
      if (text) {
        results.push({ chapter: currentChapter, verse: currentVerse, text });
      }
    }
    currentLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Chapter marker
    const chMatch = /^\\c\s+(\d+)/.exec(trimmed);
    if (chMatch) {
      flush();
      currentChapter = parseInt(chMatch[1], 10);
      currentVerse = 0;
      continue;
    }

    // Verse marker — may be at the start OR preceded by a paragraph/poetry marker
    // e.g. "\v 1 text..." (prose) or "\q1 \v 1 text..." (poetry)
    const vMatch = /(?:^|\\[a-z]+[0-9]*\s+)\\v\s+(\d+)(?:\s+(.*))?$/.exec(trimmed);
    if (vMatch) {
      flush();
      currentVerse = parseInt(vMatch[1], 10);
      if (vMatch[2]) currentLines.push(vMatch[2]);
      continue;
    }

    // Continuation line for the current verse (skip book-level headers and milestone markers)
    if (currentVerse > 0 && trimmed && !trimmed.startsWith("\\id") && !trimmed.startsWith("\\h")
        && !trimmed.startsWith("\\toc") && !trimmed.startsWith("\\mt") && !trimmed.startsWith("\\usfm")
        && !trimmed.startsWith("\\ide") && !trimmed.startsWith("\\ts") && !trimmed.startsWith("\\ms")
        && !trimmed.startsWith("\\cl") && !trimmed.startsWith("\\mr") && !trimmed.startsWith("\\s")) {
      currentLines.push(trimmed);
    }
  }
  flush();

  return results;
}

// ── Download + unzip ──────────────────────────────────────────────────────────

async function downloadZip(): Promise<void> {
  if (existsSync(ZIP_PATH)) {
    console.log("  Using cached zip:", ZIP_PATH);
    return;
  }
  console.log("  Downloading", DOWNLOAD_URL, "...");
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(ZIP_PATH, buf);
  console.log(`  Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

async function unzipArchive(): Promise<void> {
  if (existsSync(EXTRACT_PATH)) {
    console.log("  Using cached extraction:", EXTRACT_PATH);
    return;
  }
  console.log("  Extracting...");
  // Use JSZip (already a dependency)
  const JSZip = (await import("jszip")).default;
  const buf = readFileSync(ZIP_PATH);
  const zip = await JSZip.loadAsync(buf);
  mkdirSync(EXTRACT_PATH, { recursive: true });

  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const destPath = path.join(SOURCES_PATH, relativePath);
    mkdirSync(path.dirname(destPath), { recursive: true });
    const content = await file.async("nodebuffer");
    writeFileSync(destPath, content);
  }
  console.log("  Extraction complete.");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== UnfoldingWord Literal Text (en_ult) Import ===\n");

  // Ensure output directories exist
  mkdirSync(SOURCES_PATH, { recursive: true });
  mkdirSync(path.join(process.cwd(), "data"), { recursive: true });

  // 1. Download + extract
  await downloadZip();
  await unzipArchive();

  // Find the extracted directory — scan SOURCES_PATH for any subdirectory containing .usfm files
  let usfmDir = EXTRACT_PATH;
  const subdirs = readdirSync(SOURCES_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(SOURCES_PATH, d.name));
  for (const dir of subdirs) {
    const files = readdirSync(dir);
    if (files.some(f => f.endsWith(".usfm"))) {
      usfmDir = dir;
      break;
    }
  }

  // 2. Create ult.db
  console.log("\nCreating data/ult.db ...");
  if (existsSync(ULT_DB_PATH)) {
    const old = new Database(ULT_DB_PATH);
    old.exec("DROP TABLE IF EXISTS ult_verses");
    old.close();
  }
  const ultDb = new Database(ULT_DB_PATH);
  ultDb.pragma("journal_mode = WAL");
  ultDb.pragma("synchronous = NORMAL");
  ultDb.exec(`
    CREATE TABLE IF NOT EXISTS ult_verses (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      book    TEXT    NOT NULL,
      chapter INTEGER NOT NULL,
      verse   INTEGER NOT NULL,
      text    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ult_book_ch_idx ON ult_verses(book, chapter);
  `);

  const insertVerse = ultDb.prepare(
    "INSERT INTO ult_verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)"
  );

  // 3. Parse and import USFM files
  const usfmFiles = readdirSync(usfmDir)
    .filter(f => f.endsWith(".usfm") && !f.startsWith("A0"))
    .sort();

  console.log(`Found ${usfmFiles.length} USFM files to import.\n`);

  let totalVerses = 0;
  let skippedFiles = 0;

  const importAll = ultDb.transaction(() => {
    for (const filename of usfmFiles) {
      // Extract Paratext code from filename like "01-GEN.usfm" or "41-MAT.usfm"
      const match = /^\d{2}-([A-Z0-9]+)\.usfm$/.exec(filename);
      if (!match) { skippedFiles++; continue; }
      const paratextCode = match[1];
      const osisBook = PARATEXT_TO_OSIS[paratextCode];
      if (!osisBook) {
        console.warn(`  Warning: No OSIS mapping for Paratext code "${paratextCode}" (${filename})`);
        skippedFiles++;
        continue;
      }

      const filePath = path.join(usfmDir, filename);
      const content = readFileSync(filePath, "utf-8");
      const verses = parseUsfm(content);

      for (const { chapter, verse, text } of verses) {
        insertVerse.run(osisBook, chapter, verse, text);
      }

      totalVerses += verses.length;
      process.stdout.write(`  ${osisBook.padEnd(6)} ${verses.length} verses\n`);
    }
  });

  importAll();
  ultDb.close();

  console.log(`\n✓ Imported ${totalVerses.toLocaleString()} verses from ${usfmFiles.length - skippedFiles} books.`);
  if (skippedFiles > 0) console.log(`  (${skippedFiles} files skipped)`);

  // 4. Ensure translations record exists in user.db for workspace 1
  if (!existsSync(USER_DB_PATH)) {
    console.log("\nNote: user.db not found — skipping translations record creation.");
    console.log("      Run 'npm run import:ult' again after the app has been started once.");
    return;
  }

  console.log("\nEnsuring ULT translations record in user.db ...");
  const userDb = new Database(USER_DB_PATH);

  // Check if translations table exists
  const hasTable = (userDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='translations'"
  ).get() as { name: string } | undefined);

  if (!hasTable) {
    userDb.close();
    console.log("  translations table not found — start the app once first, then re-run this script.");
    return;
  }

  // Upsert: insert if not present (by abbreviation + workspace_id)
  const existing = userDb.prepare(
    "SELECT id FROM translations WHERE workspace_id = 1 AND abbreviation = 'ULT' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (existing) {
    console.log(`  ULT translation record already exists (id=${existing.id}).`);
  } else {
    userDb.prepare(
      "INSERT INTO translations (workspace_id, name, abbreviation, language) VALUES (1, 'UnfoldingWord Literal Text', 'ULT', 'English')"
    ).run();
    const newRec = userDb.prepare(
      "SELECT id FROM translations WHERE workspace_id = 1 AND abbreviation = 'ULT' LIMIT 1"
    ).get() as { id: number };
    console.log(`  Created ULT translation record (id=${newRec.id}).`);
  }

  userDb.close();
  console.log("\nDone! Run the app and open any chapter to see ULT in the translation picker.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
