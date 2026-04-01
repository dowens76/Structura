/**
 * Import script: Hebrew lexicon from eliranwong/unabridged-BDB-Hebrew-lexicon (DictBDB.json)
 * Populates the lexicon_entries table with full unabridged BDB entries for Hebrew words.
 *
 * Run: npm run import:hebrew-lexicon
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

const DB_PATH    = path.join(process.cwd(), "data", "lexica.db");
const CACHE_DIR  = path.join(process.cwd(), "data", "sources", "lexicon");
const CACHE_FILE = path.join(CACHE_DIR, "DictBDB.json");
const SOURCE_URL =
  "https://raw.githubusercontent.com/eliranwong/unabridged-BDB-Hebrew-lexicon/master/DictBDB.json";

interface DictEntry {
  top: string; // "H1", "H2", …  (or "DictInfo" for the header record)
  def: string; // Full HTML string for the entry
}

// ── HTML extraction helpers ────────────────────────────────────────────────────

/**
 * Extract the Hebrew lemma from the first <font class='c3'>…</font> inside
 * a <heb> tag, falling back to the raw <heb> text content.
 */
function extractLemma(html: string): string | null {
  const fontMatch = html.match(/<font[^>]*class=['"]c3['"][^>]*>([^<]+)<\/font>/);
  if (fontMatch) return fontMatch[1].trim() || null;
  const hebMatch = html.match(/<heb>([^<]+)/);
  if (hebMatch) return hebMatch[1].trim() || null;
  return null;
}

/**
 * Extract the transliteration from the opening bold tag: <b>H1. ab</b> → "ab"
 */
function extractTranslit(html: string): string | null {
  const m = html.match(/<b>H\d+\.\s*([^<]+)<\/b>/);
  return m ? m[1].trim() || null : null;
}

/**
 * Build a short gloss from bold elements beyond the first (which is the
 * Strong# + transliteration heading).  POS labels and gloss words are joined
 * with "; " and capped at 200 characters.
 */
function extractGloss(html: string): string | null {
  const bolds = [...html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1].trim());
  const candidates = bolds.slice(1).filter((t) => t && !/^\d/.test(t));
  const gloss = candidates.join("; ").slice(0, 200);
  return gloss || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Download (or load from cache)
  if (!existsSync(CACHE_FILE)) {
    console.log(`Fetching ${SOURCE_URL} …`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
    const text = await res.text();
    writeFileSync(CACHE_FILE, text, "utf-8");
    console.log(`  Cached ${(text.length / 1024 / 1024).toFixed(1)} MB → ${CACHE_FILE}`);
  } else {
    console.log(`Using cached ${CACHE_FILE}`);
  }

  console.log("Parsing JSON …");
  const entries: DictEntry[] = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  console.log(`  Found ${entries.length} total records`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  let inserted = 0;
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
          usage:           sql`excluded.usage`,
          source:          sql`excluded.source`,
        },
      })
      .run();
    inserted += rows.length;
    rows.length = 0;
    process.stdout.write(`\r  ${inserted} entries…`);
  }

  for (const entry of entries) {
    // Skip the DictInfo header and anything that isn't a Strong's entry
    if (!/^H\d+$/.test(entry.top)) continue;

    rows.push({
      strongNumber:    entry.top,
      language:        "hebrew",
      lemma:           extractLemma(entry.def),
      transliteration: extractTranslit(entry.def),
      pronunciation:   null,
      shortGloss:      extractGloss(entry.def),
      definition:      entry.def,   // full HTML — rendered in LexiconPane
      usage:           null,
      source:          "BDB",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} Hebrew entries inserted/updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
