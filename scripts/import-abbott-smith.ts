/**
 * Import script: Abbott-Smith Manual Greek Lexicon (TEI XML)
 * Source: https://github.com/translatable-exegetical-tools/Abbott-Smith
 * Uses abbott-smith.tei_lemma.xml which provides a @lemma attribute on each entry.
 * Stores the raw entry XML in the definition column for client-side rendering.
 *
 * Run: npm run import:abbott-smith
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

const DB_PATH    = path.join(process.cwd(), "data", "lexica.db");
const CACHE_DIR  = path.join(process.cwd(), "data", "sources", "lexicon");
const XML_FILE   = path.join(CACHE_DIR, "abbott-smith.tei_lemma.xml");
const SOURCE_URL = "https://raw.githubusercontent.com/translatable-exegetical-tools/Abbott-Smith/master/abbott-smith.tei_lemma.xml";

// TEI namespace used in the source XML — stored on each entry for standalone parsing.
const TEI_NS = "http://www.crosswire.org/2013/TEIOSIS/namespace";

// Return the text content of the first matching simple element (no deep nesting needed).
function extractFirst(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  // Strip tags from the content for plain-text gloss.
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Extract a named attribute value from an attribute string.
function attr(attrsStr: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = attrsStr.match(re);
  return m ? m[1] : "";
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Always re-download to ensure we have the latest version.
  console.log(`Fetching ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  const xmlContent = await res.text();
  writeFileSync(XML_FILE, xmlContent, "utf-8");
  console.log(`  Downloaded ${(xmlContent.length / 1024 / 1024).toFixed(1)} MB → ${XML_FILE}`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  // Remove existing AbbottSmith entries for a clean re-import.
  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'AbbottSmith'`).run();
  console.log(`  Cleared ${deleted.changes} existing AbbottSmith entries.`);

  const BATCH = 200;
  const rows: (typeof schema.lexiconEntries.$inferInsert)[] = [];
  let inserted = 0;
  let skipped = 0;

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

  // Match each <entry ...>...</entry> block (non-greedy, handles attributes).
  const entryRe = /<entry\b([^>]*?)>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xmlContent)) !== null) {
    const attrsStr  = match[1];
    const entryBody = match[2];

    // @lemma attribute — the normalised Greek lemma form.
    const lemma = attr(attrsStr, "lemma").trim();
    if (!lemma) { skipped++; continue; }

    // @strong attribute: "G1234" format for the Strong's number.
    const strongAttr = attr(attrsStr, "strong").trim();
    if (!strongAttr || !/^G\d+$/.test(strongAttr)) { skipped++; continue; }

    const strongNumber = strongAttr;   // e.g. "G2316"
    const headLemma    = lemma;

    // Short gloss — first <gloss> element, tags stripped.
    const shortGloss = extractFirst(entryBody, "gloss");

    // Full headword form (e.g. "ἄβυσσος, ου, ἡ") from <orth>.
    const orth = extractFirst(entryBody, "orth");

    // Raw XML of this entry, with explicit namespace so it can be parsed
    // standalone by DOMParser in the browser for XSL/CSS rendering.
    const rawXml = `<entry xmlns="${TEI_NS}" ${attrsStr}>${entryBody}</entry>`;

    rows.push({
      strongNumber,
      language:        "greek",
      lemma:           headLemma,
      transliteration: orth || null,
      pronunciation:   null,
      shortGloss:      shortGloss || null,
      definition:      rawXml,
      usage:           null,
      source:          "AbbottSmith",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped (no Strong's number).`);

  // Verify a sample entry.
  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, short_gloss FROM lexicon_entries WHERE source='AbbottSmith' LIMIT 3`)
    .all() as { strong_number: string; lemma: string; short_gloss: string }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number} ${s.lemma} — ${s.short_gloss}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
