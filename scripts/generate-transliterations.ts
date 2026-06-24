/**
 * Populate the `transliteration` column on the words table for all OSHB
 * (Hebrew) and SBLGNT (Greek) words using the SBL academic scheme.
 *
 * Run: npx tsx scripts/generate-transliterations.ts
 */

import Database from "better-sqlite3";
import path from "path";
import { transliterateHebrew } from "../lib/transliteration/hebrew-sbl";
import { transliterateGreek } from "../lib/transliteration/greek-sbl";

const DB_PATH = path.join(process.cwd(), "data", "source.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Add column if it doesn't exist ────────────────────────────────────────────
const cols = (db.prepare("PRAGMA table_info(words)").all() as { name: string }[]).map((c) => c.name);
if (!cols.includes("transliteration")) {
  db.exec("ALTER TABLE words ADD COLUMN transliteration TEXT");
  console.log("Added transliteration column.");
}

// ── Load lookup maps ──────────────────────────────────────────────────────────
const langRows = db.prepare("SELECT id, value FROM languages").all() as { id: number; value: string }[];
const langById: Record<number, string> = {};
for (const r of langRows) langById[r.id] = r.value;

// ── Process in batches ────────────────────────────────────────────────────────
const BATCH = 5000;
const total = (db.prepare("SELECT COUNT(*) as n FROM words WHERE text_source_id IN (SELECT id FROM text_sources WHERE value IN ('OSHB','SBLGNT'))").get() as { n: number }).n;
console.log(`Processing ${total} words…`);

const update = db.prepare("UPDATE words SET transliteration = ? WHERE id = ?");

type WordRow = { id: number; surface_text: string; language_id: number };
const selectBatch = db.prepare(
  `SELECT w.id, w.surface_text, w.language_id
   FROM words w
   JOIN text_sources ts ON ts.id = w.text_source_id
   WHERE ts.value IN ('OSHB', 'SBLGNT')
   LIMIT ? OFFSET ?`
);

let offset = 0;
let done   = 0;

const runBatch = db.transaction((rows: WordRow[]) => {
  for (const row of rows) {
    const lang  = langById[row.language_id];
    const input = row.surface_text.replace(/\//g, "");
    let translit: string;
    try {
      translit = lang === "hebrew"
        ? transliterateHebrew(input)
        : transliterateGreek(input);
    } catch {
      translit = "";
    }
    update.run(translit, row.id);
  }
});

while (offset < total) {
  const rows = selectBatch.all(BATCH, offset) as WordRow[];
  if (rows.length === 0) break;
  runBatch(rows);
  done   += rows.length;
  offset += rows.length;
  process.stdout.write(`\r  ${done}/${total} (${Math.round(done / total * 100)}%)`);
}

console.log("\nDone.");
db.close();
