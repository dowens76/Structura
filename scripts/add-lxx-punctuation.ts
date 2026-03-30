/**
 * scripts/add-lxx-punctuation.ts
 *
 * Adds Greek punctuation to LXX words in lxx.db using Swete's LXX text
 * (github.com/nathans/lxx-swete, CC BY-SA 4.0).
 *
 * The eliranwong/LXX-Rahlfs-1935 source strips all punctuation from its
 * word list; Swete's edition preserves punctuation attached to word tokens.
 * This script aligns the two by verse/position and appends trailing
 * punctuation to the existing surface_text values in lxx.db.
 *
 * Alignment strategy:
 *   – For each verse, if Swete and lxx.db have the same word count →
 *     transfer punctuation positionally (safe, edition-neutral).
 *   – If counts diverge (different recension) → skip that verse.
 *
 * Run AFTER import:lxx:
 *   npm run import:lxx:punct
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";

const LXX_DB_PATH  = path.join(process.cwd(), "data", "lxx.db");
const SOURCES_PATH = path.join(process.cwd(), "data", "sources", "swete");
const BASE_URL     = "https://raw.githubusercontent.com/nathans/lxx-swete/master/data";

// ── OSIS code → Swete filename ───────────────────────────────────────────────
// The Swete line format is: {bookNum}.{chapter}.{verse}<space>{word}
// bookNum matches the numeric prefix of the filename (e.g. "01" → 1).
const OSIS_TO_SWETE: Record<string, string> = {
  Gen:    "01.Genesis.txt",
  Exod:   "02.Exodus.txt",
  Lev:    "03.Leviticus.txt",
  Num:    "04.Numeri.txt",
  Deut:   "05.Deuteronomium.txt",
  JoshB:  "06.Josue.txt",       // Swete uses Vaticanus (= JoshB in eliranwong)
  JudgA:  "08.Judices.txt",     // Swete Judges closer to Alexandrinus (= JudgA)
  Ruth:   "10.Ruth.txt",
  "1Sam": "11.Regnorum_I.txt",
  "2Sam": "12.Regnorum_II.txt",
  "1Kgs": "13.Regnorum_III.txt",
  "2Kgs": "14.Regnorum_IV.txt",
  "1Chr": "15.Paralipomenon_I.txt",
  "2Chr": "16.Paralipomenon_II.txt",
  "1Esdr":"17.Esdras_A.txt",
  "2Esdr":"18.Esdras_B.txt",
  Esth:   "19.Esther.txt",
  Jdt:    "20.Judith.txt",
  TobBA:  "21.Tobias.txt",
  "1Macc":"23.Machabaeorum_i.txt",
  "2Macc":"24.Machabaeorum_ii.txt",
  "3Macc":"25.Machabaeorum_iii.txt",
  "4Macc":"26.Machabaeorum_iv.txt",
  Ps:     "27.Psalmi.txt",
  Odes:   "28.Odae.txt",
  Prov:   "29.Proverbia.txt",
  Song:   "31.Canticum.txt",
  Job:    "32.Job.txt",
  Wis:    "33.Sapientia_Salomonis.txt",
  Sir:    "34.Ecclesiasticus.txt",
  PsSol:  "35.Psalmi_Salomonis.txt",
  Hos:    "36.Osee.txt",
  Amos:   "37.Amos.txt",
  Mic:    "38.Michaeas.txt",
  Joel:   "39.Joel.txt",
  Obad:   "40.Abdias.txt",
  Jonah:  "41.Jonas.txt",
  Nah:    "42.Nahum.txt",
  Hab:    "43.Habacuc.txt",
  Zeph:   "44.Sophonias.txt",
  Hag:    "45.Aggaeus.txt",
  Zech:   "46.Zacharias.txt",
  Mal:    "47.Malachias.txt",
  Isa:    "48.Isaias.txt",
  Jer:    "49.Jeremias.txt",
  Bar:    "50.Baruch.txt",
  Lam:    "51.Threni_seu_Lamentationes.txt",
  EpJer:  "52.Epistula_Jeremiae.txt",
  Ezek:   "53.Ezechiel.txt",
  SusOG:  "54.Susanna_translatio_Graeca.txt",
  SusTh:  "55.Susanna_Theodotionis_versio.txt",
  DanOG:  "56.Daniel_translatio_Graeca.txt",
  DanTh:  "57.Daniel_Theodotionis_versio.txt",
  BelOG:  "58.Bel_et_Draco_translatio_Graeca.txt",
  BelTh:  "59.Bel_et_Draco_Theodotionis_versio.txt",
  // No Swete equivalent: JoshA, JudgB, TobS, Eccl (absent from Swete repo)
};

// Trailing punctuation chars that Swete attaches to word tokens
const TRAILING_PUNCT_RE = /[\u00B7\u0387\u037E\u003B.,;:\u2014\u2026\u2019''"]+$/;

mkdirSync(SOURCES_PATH, { recursive: true });

async function downloadSweteFile(filename: string): Promise<string> {
  const dest = path.join(SOURCES_PATH, filename);
  if (existsSync(dest)) return readFileSync(dest, "utf-8");
  const url = `${BASE_URL}/${encodeURIComponent(filename)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const text = await response.text();
  writeFileSync(dest, text, "utf-8");
  return text;
}

/**
 * Parse a Swete file into a Map from "chapter.verse" → ordered word list.
 * Line format: "{bookNum}.{chapter}.{verse} {word}"
 */
function parseSweteFile(content: string): Map<string, string[]> {
  const verseMap = new Map<string, string[]>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Split on first whitespace
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx < 0) continue;
    const ref  = trimmed.slice(0, spaceIdx);
    const word = trimmed.slice(spaceIdx + 1).trim();
    if (!word) continue;
    const parts = ref.split(".");
    if (parts.length < 3) continue;
    const key = `${parseInt(parts[1], 10)}.${parseInt(parts[2], 10)}`;
    const arr = verseMap.get(key) ?? [];
    arr.push(word);
    verseMap.set(key, arr);
  }
  return verseMap;
}

function extractTrailingPunct(word: string): string {
  return word.match(TRAILING_PUNCT_RE)?.[0] ?? "";
}

async function processBook(
  sqlite: Database.Database,
  osisCode: string,
  bookId: number,
  sweteFilename: string,
): Promise<{ versesAligned: number; versesSkipped: number; wordsUpdated: number }> {
  let content: string;
  try {
    content = await downloadSweteFile(sweteFilename);
  } catch (e) {
    console.error(`    download error: ${e}`);
    return { versesAligned: 0, versesSkipped: 0, wordsUpdated: 0 };
  }

  const sweteVerses = parseSweteFile(content);

  // Get all distinct (chapter, verse) pairs for this book from lxx.db
  const verseRows = sqlite.prepare(
    "SELECT DISTINCT chapter, verse FROM words WHERE book_id = ? ORDER BY chapter, verse"
  ).all(bookId) as Array<{ chapter: number; verse: number }>;

  const updateStmt = sqlite.prepare(
    "UPDATE words SET surface_text = ? WHERE book_id = ? AND chapter = ? AND verse = ? AND position_in_verse = ?"
  );

  let versesAligned = 0;
  let versesSkipped = 0;
  let wordsUpdated  = 0;

  const applyUpdates = sqlite.transaction(
    (updates: Array<{ text: string; chapter: number; verse: number; pos: number }>) => {
      for (const u of updates) {
        updateStmt.run(u.text, bookId, u.chapter, u.verse, u.pos);
      }
    }
  );

  for (const { chapter, verse } of verseRows) {
    const key = `${chapter}.${verse}`;
    const sweteWords = sweteVerses.get(key);
    if (!sweteWords || sweteWords.length === 0) {
      versesSkipped++;
      continue;
    }

    // Get lxx.db words for this verse ordered by position
    const dbWords = sqlite.prepare(
      "SELECT word_id, position_in_verse, surface_text FROM words " +
      "WHERE book_id = ? AND chapter = ? AND verse = ? ORDER BY position_in_verse"
    ).all(bookId, chapter, verse) as Array<{ word_id: string; position_in_verse: number; surface_text: string }>;

    if (dbWords.length !== sweteWords.length) {
      versesSkipped++;
      continue;
    }

    // Positional alignment
    const updates: Array<{ text: string; chapter: number; verse: number; pos: number }> = [];
    for (let i = 0; i < dbWords.length; i++) {
      const punct = extractTrailingPunct(sweteWords[i]);
      if (punct) {
        updates.push({
          text: dbWords[i].surface_text + punct,
          chapter,
          verse,
          pos: dbWords[i].position_in_verse,
        });
      }
    }

    if (updates.length > 0) {
      applyUpdates(updates);
      wordsUpdated += updates.length;
    }
    versesAligned++;
  }

  return { versesAligned, versesSkipped, wordsUpdated };
}

async function main() {
  if (!existsSync(LXX_DB_PATH)) {
    console.error(`lxx.db not found at ${LXX_DB_PATH}. Run npm run import:lxx first.`);
    process.exit(1);
  }

  const sqlite = new Database(LXX_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = OFF");

  // Get all LXX books that have Swete mappings
  const books = sqlite.prepare(
    "SELECT id, osis_code FROM books ORDER BY book_number, osis_code"
  ).all() as Array<{ id: number; osis_code: string }>;

  console.log("Adding Greek punctuation to LXX words from Swete text...\n");

  let totalVersesAligned = 0;
  let totalVersesSkipped = 0;
  let totalWordsUpdated  = 0;

  for (const book of books) {
    const sweteFile = OSIS_TO_SWETE[book.osis_code];
    if (!sweteFile) continue; // No Swete equivalent (Eccl, JoshA, JudgB, TobS, etc.)

    // Check if this book has any words in lxx.db
    const wordCount = (sqlite.prepare(
      "SELECT COUNT(*) as c FROM words WHERE book_id = ?"
    ).get(book.id) as { c: number }).c;
    if (wordCount === 0) continue;

    process.stdout.write(`  ${book.osis_code.padEnd(8)} downloading ${sweteFile}...`);

    const { versesAligned, versesSkipped, wordsUpdated } = await processBook(
      sqlite, book.osis_code, book.id, sweteFile
    );

    console.log(` aligned=${versesAligned} skipped=${versesSkipped} punct_words=${wordsUpdated}`);

    totalVersesAligned += versesAligned;
    totalVersesSkipped += versesSkipped;
    totalWordsUpdated  += wordsUpdated;
  }

  sqlite.close();

  console.log("\n── Summary ──────────────────────────────────");
  console.log(`Verses aligned:  ${totalVersesAligned.toLocaleString()}`);
  console.log(`Verses skipped:  ${totalVersesSkipped.toLocaleString()}`);
  console.log(`Words with punct: ${totalWordsUpdated.toLocaleString()}`);
  console.log("\nDone! Run the dev server to see punctuation in the LXX text.");
}

main().catch(console.error);
