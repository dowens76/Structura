/**
 * Import script: Abbott-Smith Manual Greek Lexicon (TEI XML)
 * Source: https://github.com/translatable-exegetical-tools/Abbott-Smith
 * Populates the lexicon_entries table with AbbottSmith source entries.
 *
 * Run: npm run import:abbott-smith
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

const DB_PATH    = path.join(process.cwd(), "data", "lexica.db");
const CACHE_DIR  = path.join(process.cwd(), "data", "sources", "lexicon");
const XML_FILE   = path.join(CACHE_DIR, "abbott-smith.tei.xml");
const SOURCE_URL = "https://raw.githubusercontent.com/translatable-exegetical-tools/Abbott-Smith/master/abbott-smith.tei.xml";

// Strip XML tags and normalize whitespace, preserving meaningful text content.
// Footnote <note> elements are removed entirely.
function stripTags(xml: string): string {
  return xml
    .replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Return the stripped text of the first matching element, or "".
function extractFirst(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? stripTags(m[1]) : "";
}

// Remove a balanced XML element (and all its content) from the string.
// Handles elements with attributes and nested children of the same tag.
function removeElement(xml: string, tag: string): string {
  const open  = new RegExp(`<${tag}\\b[^>]*>`, "g");
  const close = `</${tag}>`;
  let result = xml;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    open.lastIndex = 0;
    match = open.exec(result);
    if (!match) break;
    const start = match.index;
    let depth = 1;
    let i = start + match[0].length;
    while (i < result.length && depth > 0) {
      if (result.startsWith(close, i)) {
        depth--;
        if (depth === 0) {
          result = result.slice(0, start) + " " + result.slice(i + close.length);
          break;
        }
        i += close.length;
      } else if (new RegExp(`^<${tag}\\b`).test(result.slice(i))) {
        depth++;
        i++;
      } else {
        i++;
      }
    }
    if (depth > 0) break; // safety: unterminated element
  }
  return result;
}

// Extract the full definition text from an entry by removing structural metadata
// (form, note, etym) and returning all remaining text content (all sense elements).
function extractDefinition(entryXml: string): string {
  let xml = entryXml;
  xml = removeElement(xml, "form");
  xml = removeElement(xml, "note");
  xml = removeElement(xml, "etym");
  return stripTags(xml);
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Always re-download to ensure we have the latest version.
  console.log(`Fetching ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  const xmlContent = await res.text();
  writeFileSync(XML_FILE, xmlContent, "utf-8");
  console.log(`  Downloaded ${(xmlContent.length / 1024).toFixed(0)} KB → ${XML_FILE}`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  // First, remove all existing AbbottSmith entries so we get a clean re-import.
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

  // Match each <entry n="...">...</entry> block.
  // The regex is non-greedy and uses a lookahead to handle end-of-text correctly.
  const entryRe = /<entry\s+n="([^"]+)">([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xmlContent)) !== null) {
    const nAttr    = match[1];
    const entryXml = match[2];

    // n attribute format: "lemma|GN" — skip entries without a Strong's number.
    const pipeIdx = nAttr.indexOf("|");
    if (pipeIdx < 0) { skipped++; continue; }

    const lemma  = nAttr.slice(0, pipeIdx).trim();
    const rawNum = nAttr.slice(pipeIdx + 1).trim();

    // Must be a valid Gxxx token.
    if (!/^G\d+$/.test(rawNum)) { skipped++; continue; }
    if (!lemma) { skipped++; continue; }

    const strongNumber = rawNum; // e.g. "G1", "G2316"

    // <orth> — full headword with declension/gender suffix, e.g. "ἄβυσσος, ου, ἡ"
    const orth = extractFirst(entryXml, "orth");

    // First <gloss> is the short English translation
    const shortGloss = extractFirst(entryXml, "gloss");

    // Full definition: all sense content, stripped of metadata elements
    const definition = extractDefinition(entryXml);

    rows.push({
      strongNumber,
      language:        "greek",
      lemma,
      transliteration: orth || null,
      pronunciation:   null,
      shortGloss:      shortGloss || null,
      definition:      definition || null,
      usage:           null,
      source:          "AbbottSmith",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);

  // Verify a sample entry
  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, short_gloss FROM lexicon_entries WHERE source='AbbottSmith' LIMIT 3`)
    .all() as { strong_number: string; lemma: string; short_gloss: string }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number} ${s.lemma} — ${s.short_gloss}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
