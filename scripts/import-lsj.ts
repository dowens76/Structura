/**
 * Import script: Liddell-Scott-Jones Greek Lexicon (Unicode edition)
 * Source: https://github.com/gcelano/LSJ_GreekUnicode
 *
 * Downloads 27 XML files (grc.lsj.perseus-eng1.xml … eng27.xml),
 * parses each <entryFree> element, and stores entries in lsj.db.
 *
 * Lemma key design
 * ----------------
 * LXX words are stored with *unaccented* lowercase lemmas (e.g. "αρχη").
 * The LSJ headwords are fully accented (e.g. "ἀρχή").  To make the
 * lookup work without changing the API, we strip diacritical marks and
 * lowercase the LSJ headword before storing it in the `lemma` column.
 * The original accented headword goes in `transliteration` for display.
 *
 * The `strong_number` column (NOT NULL, unique with source) is populated
 * with the entry's `id` attribute (e.g. "n1234"), which is globally
 * unique within the LSJ corpus.
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
const BASE_URL  = "https://raw.githubusercontent.com/gcelano/LSJ_GreekUnicode/master";
const FILE_COUNT = 27;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip Greek diacritical marks (polytonic + combining) and lowercase. */
function unaccentGreek(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Remove trailing ASCII digits used in LSJ to disambiguate homophones. */
function stripTrailingDigits(s: string): string {
  return s.replace(/\d+$/, "").trim();
}

function hasGreek(s: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/i.test(s);
}

/** Strip redundant TEI attributes and normalize whitespace to shrink stored XML ~59%. */
function compressXml(xml: string): string {
  return xml
    .replace(/ TEIform="[^"]*"/g, "")
    .replace(/ opt="[^"]*"/g, "")
    .replace(/ default="[^"]*"/g, "")
    .replace(/ extent="[^"]*"/g, "")
    .replace(/ n="urn:[^"]*"/g, "")
    .replace(/\s+/g, " ");
}

/** Extract the value of the first occurrence of a named XML attribute. */
function attrValue(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? m[1] : "";
}

/** Return the plain-text content of the first <tr> element in `xml`. */
function firstTrText(xml: string): string {
  const m = xml.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
  const BATCH = 300;
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
          shortGloss:      sql`excluded.short_gloss`,
          definition:      sql`excluded.definition`,
          source:          sql`excluded.source`,
        },
      })
      .run();
    totalInserted += rows.length;
    rows.length = 0;
  }

  for (let i = 1; i <= FILE_COUNT; i++) {
    const filename  = `grc.lsj.perseus-eng${i}.xml`;
    const cachePath = path.join(CACHE_DIR, filename);
    const url       = `${BASE_URL}/${filename}`;

    if (!existsSync(cachePath)) {
      process.stdout.write(`Downloading ${filename} … `);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      const xml = await res.text();
      writeFileSync(cachePath, xml, "utf-8");
      process.stdout.write(`${(xml.length / 1024).toFixed(0)} KB cached\n`);
    } else {
      process.stdout.write(`Using cached ${filename}\n`);
    }

    const xml = readFileSync(cachePath, "utf-8");

    // Extract each <entryFree …>…</entryFree> block.
    const entryRe = /<entryFree\b([^>]*)>([\s\S]*?)<\/entryFree>/g;
    let match: RegExpExecArray | null;
    let fileEntries = 0;
    let fileSkipped = 0;

    while ((match = entryRe.exec(xml)) !== null) {
      const attrsStr  = match[1];
      const entryBody = match[2];

      const entryId = attrValue(attrsStr, "id").trim();
      const rawKey  = attrValue(attrsStr, "key").trim();

      if (!entryId || !rawKey) { fileSkipped++; continue; }

      // Headword: strip trailing disambiguation digit, must contain Greek.
      const headword = stripTrailingDigits(rawKey);
      if (!hasGreek(headword)) { fileSkipped++; continue; }

      const lemma       = unaccentGreek(headword);   // unaccented, lowercase
      const shortGloss  = firstTrText(entryBody).slice(0, 300) || null;

      // Store the entry XML, stripped of redundant TEI attributes (~59% smaller).
      const rawXml = compressXml(`<entryFree${attrsStr}>${entryBody}</entryFree>`);

      rows.push({
        strongNumber:    entryId,      // "n1234" — unique per entry
        language:        "greek",
        lemma,                         // unaccented for LXX lemma matching
        transliteration: headword,     // accented headword for display
        pronunciation:   null,
        shortGloss,
        definition:      rawXml,
        usage:           null,
        source:          "LSJ",
      });

      fileEntries++;
      if (rows.length >= BATCH) flush();
    }

    flush();
    totalSkipped += fileSkipped;
    process.stdout.write(
      `  → ${fileEntries.toLocaleString()} entries parsed, ${fileSkipped} skipped\n`
    );
  }

  console.log(`\nDone: ${totalInserted.toLocaleString()} LSJ entries imported, ${totalSkipped} skipped.`);

  // Verify a sample.
  const sample = sqlite
    .prepare(`SELECT id, strong_number, lemma, transliteration, short_gloss
              FROM lexicon_entries WHERE source = 'LSJ' LIMIT 5`)
    .all() as { id: number; strong_number: string; lemma: string; transliteration: string; short_gloss: string }[];
  console.log("\nSample entries:");
  for (const s of sample) {
    console.log(`  [${s.strong_number}] ${s.transliteration} → ${s.lemma} | ${s.short_gloss}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
