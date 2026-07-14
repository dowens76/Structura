/**
 * Import script: Brown-Driver-Briggs Hebrew-English Lexicon (BDB)
 * Source: https://github.com/openscriptures/HebrewLexicon
 *
 * Replaces the old eliranwong/unabridged-BDB-Hebrew-lexicon JSON import.
 * Joins two files from the same OpenScriptures project:
 *   - LexicalIndex.xml   maps every Strong's number (and the letter-keyed
 *                        inseparable-prefix particles, e.g. strong="b" for
 *                        the ב preposition) to a BDB entry id, and gives a
 *                        clean headword/transliteration/short gloss.
 *   - BrownDriverBriggs.xml  the actual structured BDB entries, keyed by
 *                        that same entry id. Stored verbatim (raw XML) in
 *                        the definition column for client-side rendering,
 *                        matching the Abbott-Smith/LSJ pattern.
 *
 * The letter-keyed particle entries (b, c, d, i, k, l, m, s) are not part
 * of the canonical H1-H8674 range but are included deliberately: they are
 * the exact same single-letter codes lib/morphology/oshb-parser.ts's
 * PREFIX_MAP already decodes from OSHB morph codes, so storing them here
 * with source="BDB" gives Hebrew prefix particles their own real lexicon
 * entry, keyed the same way the rest of the app already looks things up.
 *
 * Run: npm run import:bdb
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { ensureLexiconTable } from "./_ensure-lexicon-table";

const DB_PATH   = path.join(process.cwd(), "data", "bdb.db");
const CACHE_DIR = path.join(process.cwd(), "data", "sources", "lexicon", "bdb");
const LEX_INDEX_FILE = path.join(CACHE_DIR, "LexicalIndex.xml");
const BDB_FILE        = path.join(CACHE_DIR, "BrownDriverBriggs.xml");
const LEX_INDEX_URL =
  "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/LexicalIndex.xml";
const BDB_URL =
  "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/BrownDriverBriggs.xml";

// Default namespace declared by the source XML files; re-attached to each
// extracted fragment so it remains well-formed and parseable standalone.
const LEXICON_NS = "http://openscriptures.github.com/morphhb/namespace";

async function fetchCached(url: string, file: string): Promise<string> {
  if (existsSync(file)) {
    console.log(`Using cached ${file}`);
    return require("fs").readFileSync(file, "utf-8") as string;
  }
  console.log(`Fetching ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  writeFileSync(file, text, "utf-8");
  console.log(`  Cached ${(text.length / 1024 / 1024).toFixed(1)} MB → ${file}`);
  return text;
}

// Extract a named attribute value from an attribute string.
function attr(attrsStr: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = attrsStr.match(re);
  return m ? m[1] : "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface LexIndexEntry {
  lemma: string | null;
  xlit: string | null;
  shortGloss: string | null;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  const lexIndexXml = await fetchCached(LEX_INDEX_URL, LEX_INDEX_FILE);
  const bdbXml = await fetchCached(BDB_URL, BDB_FILE);

  // ── Pass 1: parse LexicalIndex.xml entries ────────────────────────────────
  console.log("Parsing LexicalIndex.xml …");
  const strongToBdbId = new Map<string, string>();
  const strongToInfo = new Map<string, LexIndexEntry>();
  let duplicateStrongs = 0;

  const indexEntryRe = /<entry\b([^>]*?)>([\s\S]*?)<\/entry>/g;
  const xrefRe = /<xref\b([^>]*?)\/>/g;
  let im: RegExpExecArray | null;
  let indexEntryCount = 0;

  while ((im = indexEntryRe.exec(lexIndexXml)) !== null) {
    indexEntryCount++;
    const body = im[2];

    const wMatch = body.match(/<w\b([^>]*?)>([\s\S]*?)<\/w>/);
    const xlit = wMatch ? attr(wMatch[1], "xlit") || null : null;
    const lemma = wMatch ? stripTags(wMatch[2]) || null : null;

    const defMatch = body.match(/<def\b[^>]*>([\s\S]*?)<\/def>/);
    const shortGloss = defMatch ? stripTags(defMatch[1]) || null : null;

    xrefRe.lastIndex = 0;
    let xm: RegExpExecArray | null;
    while ((xm = xrefRe.exec(body)) !== null) {
      const bdbId = attr(xm[1], "bdb");
      const strongAttr = attr(xm[1], "strong");
      if (!bdbId || !strongAttr) continue;

      const key = /^\d+$/.test(strongAttr) ? `H${strongAttr}` : strongAttr.toLowerCase();
      if (strongToBdbId.has(key)) {
        duplicateStrongs++;
        continue; // first-wins
      }
      strongToBdbId.set(key, bdbId);
      strongToInfo.set(key, { lemma, xlit, shortGloss });
    }
  }
  console.log(
    `  ${indexEntryCount} index entries → ${strongToBdbId.size} Strong's-number/particle keys ` +
    `(${duplicateStrongs} duplicate xrefs skipped)`
  );

  // ── Pass 2: parse BrownDriverBriggs.xml entries ───────────────────────────
  console.log("Parsing BrownDriverBriggs.xml …");
  const bdbIdToEntryXml = new Map<string, string>();
  const bdbEntryRe = /<entry\b([^>]*?)>([\s\S]*?)<\/entry>/g;
  let bm: RegExpExecArray | null;
  let bdbEntryCount = 0;

  while ((bm = bdbEntryRe.exec(bdbXml)) !== null) {
    bdbEntryCount++;
    const attrsStr = bm[1];
    const body = bm[2];
    const id = attr(attrsStr, "id");
    if (!id) continue;
    bdbIdToEntryXml.set(id, `<entry xmlns="${LEXICON_NS}" ${attrsStr}>${body}</entry>`);
  }
  console.log(`  ${bdbEntryCount} BDB entries parsed`);

  // ── Join and write ─────────────────────────────────────────────────────────
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  ensureLexiconTable(sqlite);
  const db = drizzle(sqlite, { schema });

  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'BDB'`).run();
  console.log(`  Cleared ${deleted.changes} existing BDB entries.`);

  const BATCH = 200;
  const rows: (typeof schema.lexiconEntries.$inferInsert)[] = [];
  let inserted = 0;
  const unmatched: string[] = [];

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
    inserted += rows.length;
    rows.length = 0;
    process.stdout.write(`\r  ${inserted} entries…`);
  }

  const canonicalKeys: string[] = [];
  for (let n = 1; n <= 8674; n++) canonicalKeys.push(`H${n}`);
  for (const key of strongToBdbId.keys()) {
    if (!/^H\d+$/.test(key)) canonicalKeys.push(key); // letter-keyed particles
  }

  for (const key of canonicalKeys) {
    const bdbId = strongToBdbId.get(key);
    if (!bdbId) { unmatched.push(key); continue; }

    const definition = bdbIdToEntryXml.get(bdbId);
    if (!definition) { unmatched.push(key); continue; }

    const info = strongToInfo.get(key)!;

    rows.push({
      strongNumber:    key,
      language:        "hebrew",
      lemma:           info.lemma,
      transliteration: info.xlit,
      pronunciation:   null,
      shortGloss:      info.shortGloss,
      definition,
      usage:           null,
      source:          "BDB",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} BDB entries inserted/updated.`);
  console.log(`  ${unmatched.length} Strong's numbers with no BDB match.`);
  if (unmatched.length > 0 && unmatched.length <= 30) {
    console.log(`  Unmatched: ${unmatched.join(", ")}`);
  } else if (unmatched.length > 30) {
    console.log(`  First 30 unmatched: ${unmatched.slice(0, 30).join(", ")}`);
  }

  // Validate every stored definition parses as well-formed XML (best-effort:
  // just check balanced/matching root tag, since a full XML parse isn't
  // available in this Node script without an extra dependency).
  const badXml = sqlite
    .prepare(`SELECT strong_number FROM lexicon_entries WHERE source='BDB' AND definition NOT LIKE '<entry%</entry>'`)
    .all() as { strong_number: string }[];
  if (badXml.length > 0) {
    console.log(`  WARNING: ${badXml.length} entries have malformed-looking definition XML: ${badXml.map(r => r.strong_number).slice(0, 10).join(", ")}`);
  }

  // Sample.
  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, transliteration, short_gloss FROM lexicon_entries WHERE source='BDB' AND strong_number IN ('H1','H121','b','c','i','s') ORDER BY strong_number`)
    .all() as { strong_number: string; lemma: string; transliteration: string; short_gloss: string }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number}  ${s.lemma}  (${s.transliteration}) — ${s.short_gloss}`);

  sqlite.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
