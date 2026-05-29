/**
 * Import script: Liddell-Scott-Jones Greek Lexicon
 * Source: STEPBible-Data (CC BY)
 * https://github.com/STEPBible/STEPBible-Data/tree/master/Lexicons
 *
 * Ingests two tab-separated files:
 *   TFLSJ  0-5624  — original Strong's G0001–G5624
 *   TFLSJ extra    — extended Strong's G6000–G21502 (LXX / proper nouns)
 *
 * Column layout (0-indexed):
 *   0  eStrong       — extended Strong's (G0001, G6002 …)
 *   1  dStrong       — display form with sense notes
 *   2  uStrong       — unique per sub-entry (G0001G, G0001H, H0175 …)
 *   3  Greek         — lexical form(s), comma-separated if multiple
 *   4  Transliteration
 *   5  Morph
 *   6  Gloss         — one-word brief gloss
 *   7  LSJ Meaning   — full HTML entry
 *
 * Storage schema
 * ──────────────
 *   strong_number   = uStrong  (unique per sub-entry)
 *   lemma           = unaccented, lowercase first Greek form (for lookup)
 *   transliteration = accented first Greek form (for display)
 *   pronunciation   = Latin transliteration (col 4)
 *   short_gloss     = col 6
 *   definition      = sanitised HTML from col 7
 *
 * Run: npm run import:lsj
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { ensureLexiconTable } from "./_ensure-lexicon-table";

const DB_PATH   = path.join(process.cwd(), "data", "lsj.db");
const CACHE_DIR = path.join(process.cwd(), "data", "sources", "lexicon", "lsj");

const BASE_URL  = "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/";

// File 1 has a double space before "0-5624" in the filename.
const FILES = [
  {
    filename: "TFLSJ  0-5624 - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt",
    label: "TFLSJ 0-5624",
  },
  {
    filename: "TFLSJ extra - Translators Formatted full LSJ Bible lexicon - STEPBible.org CC BY.txt",
    label: "TFLSJ extra",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip Greek diacritical marks (polytonic + combining) and lowercase. */
function unaccentGreek(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ᷀-᷿⃐-⃿]/g, "").toLowerCase();
}

/**
 * Extract the primary Greek form from the Greek column.
 * The field may contain comma-separated alternatives, e.g. "α, Ἀλφα" or "βίβλος, ου, ἡ".
 * We take the first token and strip trailing punctuation.
 */
function primaryGreekForm(greek: string): string {
  return greek.split(",")[0].trim().replace(/[.·;:!?]+$/, "").trim();
}

/**
 * Sanitise the STEPBible HTML for safe inline rendering.
 * - Converts javascript:void(0) anchors to <span> (keeps the title tooltip).
 * - Strips any remaining href attributes that look unsafe.
 */
function sanitiseHtml(html: string): string {
  // <a href="javascript:...">text</a>  →  <span title="...">text</span>
  html = html.replace(
    /<a\b([^>]*?)href="javascript:[^"]*"([^>]*?)>([\s\S]*?)<\/a>/gi,
    (_, before, after, content) => {
      const titleMatch = (before + after).match(/title="([^"]*)"/i);
      const titleAttr  = titleMatch ? ` title="${titleMatch[1]}"` : "";
      return `<span${titleAttr}>${content}</span>`;
    },
  );
  // Remove any residual javascript: hrefs that weren't caught above.
  html = html.replace(/\shref="javascript:[^"]*"/gi, "");
  return html;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  ensureLexiconTable(sqlite);
  const db = drizzle(sqlite, { schema });

  // Remove any previous LSJ import so re-runs are clean.
  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'LSJ'`).run();
  if (deleted.changes > 0) console.log(`  Cleared ${deleted.changes} existing LSJ entries.`);

  let totalInserted = 0;
  let totalSkipped  = 0;
  const BATCH = 500;
  const rows: (typeof schema.lexiconEntries.$inferInsert)[] = [];

  function flush() {
    if (!rows.length) return;
    db.insert(schema.lexiconEntries)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.lexiconEntries.strongNumber, schema.lexiconEntries.source],
        set: {
          lemma:           sql`excluded.lemma`,
          transliteration: sql`excluded.transliteration`,
          pronunciation:   sql`excluded.pronunciation`,
          shortGloss:      sql`excluded.short_gloss`,
          definition:      sql`excluded.definition`,
        },
      })
      .run();
    totalInserted += rows.length;
    rows.length = 0;
  }

  for (const { filename, label } of FILES) {
    const cachePath = path.join(CACHE_DIR, filename);
    const url = BASE_URL + encodeURIComponent(filename);

    if (!existsSync(cachePath)) {
      process.stdout.write(`Downloading ${label} … `);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const text = await res.text();
      writeFileSync(cachePath, text, "utf-8");
      process.stdout.write(`${(text.length / 1024).toFixed(0)} KB cached\n`);
    } else {
      process.stdout.write(`Using cached ${label}\n`);
    }

    const text  = readFileSync(cachePath, "utf-8");
    const lines = text.split(/\r?\n/);

    let fileEntries = 0;
    let fileSkipped = 0;
    let inData      = false;

    for (const line of lines) {
      // Data starts after the "===" separator that follows the column headers.
      if (!inData) {
        if (/^={5,}/.test(line)) inData = true;
        continue;
      }

      if (!line.trim()) continue;

      const cols = line.split("\t");
      if (cols.length < 7) { fileSkipped++; continue; }

      const eStrong = cols[0]?.trim();
      const uStrong = cols[2]?.trim();
      const greek   = cols[3]?.trim();
      const translit = cols[4]?.trim();
      const gloss   = cols[6]?.trim();
      const lsjHtml = cols[7]?.trim() ?? "";

      // Skip lines that don't look like data entries.
      if (!eStrong || !/^[GH]\d/.test(eStrong)) { fileSkipped++; continue; }
      if (!uStrong || !greek) { fileSkipped++; continue; }

      const primaryForm   = primaryGreekForm(greek);
      const lemma         = unaccentGreek(primaryForm);
      if (!lemma) { fileSkipped++; continue; }

      const definition = lsjHtml ? sanitiseHtml(lsjHtml) : null;

      rows.push({
        strongNumber:    uStrong,
        language:        "greek",
        lemma,
        transliteration: primaryForm,
        pronunciation:   translit || null,
        shortGloss:      gloss || null,
        definition,
        usage:           null,
        source:          "LSJ",
      });

      fileEntries++;
      if (rows.length >= BATCH) flush();
    }

    flush();
    totalSkipped += fileSkipped;
    console.log(`  → ${fileEntries.toLocaleString()} entries parsed, ${fileSkipped} skipped`);
  }

  console.log(`\nDone: ${totalInserted.toLocaleString()} LSJ entries imported, ${totalSkipped} skipped.`);

  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, transliteration, short_gloss
              FROM lexicon_entries WHERE source = 'LSJ' LIMIT 5`)
    .all() as { strong_number: string; lemma: string; transliteration: string; short_gloss: string }[];
  console.log("\nSample entries:");
  for (const s of sample) {
    console.log(`  [${s.strong_number}] ${s.transliteration} → ${s.lemma} | ${s.short_gloss}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
