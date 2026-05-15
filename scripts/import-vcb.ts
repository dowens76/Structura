/**
 * Import script: Biblica® Open Vietnamese Contemporary Bible 2015 (VCB)
 * Source: https://www.open.bible/bibles/vietnamese-biblica-text-bible
 * License: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/
 *
 * Attribution (required by CC BY-SA):
 *   Vietnamese Contemporary Bible (VCB)
 *   Copyright © 1998, 2002, 2015 by Biblica, Inc.®
 *   Used with permission. All rights reserved worldwide.
 *   www.biblica.com
 *
 * Downloads the USFM archive, strips footnotes and formatting markers, and
 * stores clean verse text in data/vcb.db.  Also ensures a translations record
 * exists in user.db for workspace 1 so VCB appears in the translation picker.
 *
 * Run: npm run import:vcb
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from "fs";
import path from "path";

const VCB_DB_PATH  = path.join(process.cwd(), "data", "vcb.db");
const USER_DB_PATH = path.join(process.cwd(), "data", "user.db");
const SOURCES_PATH = path.join(process.cwd(), "data", "sources", "vcb");
const ZIP_PATH     = path.join(SOURCES_PATH, "vcb-usfm.zip");
const EXTRACT_PATH = path.join(SOURCES_PATH, "release");
const DOWNLOAD_URL = "https://openbible-api-1.biblica.com/artifactContent/64c02575a4e86765a266c759";

const ATTRIBUTION =
  "Vietnamese Contemporary Bible (VCB) Copyright © 1998, 2002, 2015 by Biblica, Inc.® " +
  "Used with permission. All rights reserved worldwide. www.biblica.com. " +
  "Licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).";

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
 * Strips all USFM markup from a raw verse line, returning clean readable text.
 * Removes footnotes (\f...\f*) and cross-references (\x...\x*) entirely.
 * Poetry continuation lines (\q1, \q2) contribute their text to the verse.
 */
function stripUsfm(raw: string): string {
  let s = raw;

  // Remove footnotes entirely: \f + footnote text \f*
  s = s.replace(/\\f\s+.*?\\f\*/g, "");

  // Remove cross-references entirely: \x + xref text \x*
  s = s.replace(/\\x\s+.*?\\x\*/g, "");

  // Remove figure markers entirely: \fig ...\fig*
  s = s.replace(/\\fig\b.*?\\fig\*/g, "");

  // Paired inline markers — keep inner text: \add text\add*, \nd text\nd*, etc.
  // Handles optional + prefix for nested markers (e.g. \+xt)
  s = s.replace(/\\\+?[a-z]+[0-9]*\s+(.*?)\\\+?[a-z]+[0-9]*\*/g, "$1");

  // Remove remaining standalone markers: \p, \q1, \b, \s1, etc.
  s = s.replace(/\\\+?[a-z]+[0-9]*/g, "");

  // Remove leftover \* and pipe-delimited attribute strings
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
      const text = stripUsfm(currentLines.join(" "));
      if (text) results.push({ chapter: currentChapter, verse: currentVerse, text });
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

    // Verse marker — may be preceded by a paragraph/poetry marker on same line
    const vMatch = /(?:^|\\[a-z]+[0-9]*\s+)\\v\s+(\d+)(?:\s+(.*))?$/.exec(trimmed);
    if (vMatch) {
      flush();
      currentVerse = parseInt(vMatch[1], 10);
      if (vMatch[2]) currentLines.push(vMatch[2]);
      continue;
    }

    // Continuation line: anything while inside a verse, except book-level headers
    if (
      currentVerse > 0 &&
      trimmed &&
      !trimmed.startsWith("\\id") &&
      !trimmed.startsWith("\\h") &&
      !trimmed.startsWith("\\toc") &&
      !trimmed.startsWith("\\mt") &&
      !trimmed.startsWith("\\usfm") &&
      !trimmed.startsWith("\\ide") &&
      !trimmed.startsWith("\\ms") &&
      !trimmed.startsWith("\\cl") &&
      !trimmed.startsWith("\\mr") &&
      !trimmed.startsWith("\\s")   // section headings (\s, \s1, \s2…)
    ) {
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
  console.log("=== Biblica® Open Vietnamese Contemporary Bible 2015 (VCB) Import ===\n");

  mkdirSync(SOURCES_PATH, { recursive: true });
  mkdirSync(path.join(process.cwd(), "data"), { recursive: true });

  // 1. Download + extract
  await downloadZip();
  await unzipArchive();

  // Find USFM directory — scan for subdirectory containing .usfm files
  let usfmDir: string | null = null;
  function findUsfmDir(dir: string): string | null {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some(e => e.isFile() && e.name.endsWith(".usfm"))) return dir;
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = findUsfmDir(path.join(dir, e.name));
        if (found) return found;
      }
    }
    return null;
  }
  usfmDir = findUsfmDir(SOURCES_PATH);
  if (!usfmDir) throw new Error("Could not find USFM files in extracted archive.");
  console.log(`\nUSFM files found in: ${usfmDir}`);

  // 2. Create vcb.db
  console.log("\nCreating data/vcb.db ...");
  if (existsSync(VCB_DB_PATH)) {
    const old = new Database(VCB_DB_PATH);
    old.exec("DROP TABLE IF EXISTS vcb_verses; DROP TABLE IF EXISTS metadata;");
    old.close();
  }
  const vcbDb = new Database(VCB_DB_PATH);
  vcbDb.pragma("journal_mode = WAL");
  vcbDb.pragma("synchronous = NORMAL");
  vcbDb.exec(`
    CREATE TABLE IF NOT EXISTS vcb_verses (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      book    TEXT    NOT NULL,
      chapter INTEGER NOT NULL,
      verse   INTEGER NOT NULL,
      text    TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vcb_book_ch_idx ON vcb_verses(book, chapter);

    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Store required CC BY-SA attribution
  vcbDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
    .run("attribution", ATTRIBUTION);
  vcbDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
    .run("license", "CC BY-SA 4.0");
  vcbDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
    .run("license_url", "https://creativecommons.org/licenses/by-sa/4.0/");

  const insertVerse = vcbDb.prepare(
    "INSERT INTO vcb_verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)"
  );

  // 3. Parse and import USFM files
  // VCB filenames are plain "GEN.usfm", "JHN.usfm" — no numeric prefix
  const usfmFiles = readdirSync(usfmDir)
    .filter(f => f.endsWith(".usfm"))
    .sort();

  console.log(`Found ${usfmFiles.length} USFM files to import.\n`);

  let totalVerses = 0;
  let skippedFiles = 0;

  const importAll = vcbDb.transaction(() => {
    for (const filename of usfmFiles) {
      // Match plain "GEN.usfm" or prefixed "01-GEN.usfm"
      const match = /^(?:\d{2}-)?([A-Z0-9]+)\.usfm$/.exec(filename);
      if (!match) { skippedFiles++; continue; }
      const paratextCode = match[1];
      const osisBook = PARATEXT_TO_OSIS[paratextCode];
      if (!osisBook) {
        console.warn(`  Warning: No OSIS mapping for "${paratextCode}" (${filename})`);
        skippedFiles++;
        continue;
      }

      const content = readFileSync(path.join(usfmDir!, filename), "utf-8");
      const verses = parseUsfm(content);

      for (const { chapter, verse, text } of verses) {
        insertVerse.run(osisBook, chapter, verse, text);
      }

      totalVerses += verses.length;
      process.stdout.write(`  ${osisBook.padEnd(6)} ${verses.length} verses\n`);
    }
  });

  importAll();
  vcbDb.close();

  console.log(`\n✓ Imported ${totalVerses.toLocaleString()} verses from ${usfmFiles.length - skippedFiles} books.`);
  if (skippedFiles > 0) console.log(`  (${skippedFiles} files skipped)`);
  console.log(`\nAttribution stored in vcb.db:`);
  console.log(`  ${ATTRIBUTION}`);

  // 4. Ensure translations record in user.db for workspace 1
  if (!existsSync(USER_DB_PATH)) {
    console.log("\nNote: user.db not found — skipping translations record.");
    console.log("      Run 'npm run import:vcb' again after starting the app once.");
    return;
  }

  console.log("\nEnsuring VCB translations record in user.db ...");
  const userDb = new Database(USER_DB_PATH);

  const hasTable = userDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='translations'"
  ).get() as { name: string } | undefined;

  if (!hasTable) {
    userDb.close();
    console.log("  translations table not found — start the app once, then re-run.");
    return;
  }

  // On a fresh CI runner user.db has the schema but empty tables.
  // Ensure the seed rows expected by the foreign-key constraint exist.
  userDb.prepare(
    "INSERT OR IGNORE INTO users (id, name, email) VALUES (1, 'User', 'user@structura.app')"
  ).run();
  userDb.prepare(
    "INSERT OR IGNORE INTO workspaces (id, user_id, name) VALUES (1, 1, 'Default')"
  ).run();

  const existing = userDb.prepare(
    "SELECT id FROM translations WHERE workspace_id = 1 AND abbreviation = 'VCB' LIMIT 1"
  ).get() as { id: number } | undefined;

  if (existing) {
    console.log(`  VCB translation record already exists (id=${existing.id}).`);
  } else {
    userDb.prepare(
      "INSERT INTO translations (workspace_id, name, abbreviation, language) VALUES (1, 'Vietnamese Contemporary Bible 2015', 'VCB', 'Vietnamese')"
    ).run();
    const newRec = userDb.prepare(
      "SELECT id FROM translations WHERE workspace_id = 1 AND abbreviation = 'VCB' LIMIT 1"
    ).get() as { id: number };
    console.log(`  Created VCB translation record (id=${newRec.id}).`);
  }

  userDb.close();
  console.log("\nDone! Open the app and select VCB from the translation picker.");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
