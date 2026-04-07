/**
 * Import script: Strong's Hebrew Dictionary from openscriptures/strongs
 * Source: https://github.com/openscriptures/strongs/blob/master/hebrew/StrongHebrewG.xml
 *
 * Populates lexicon_entries with source="HebrewStrong" — giving each
 * Strong's number (H1–H8674) its own concise definition drawn directly
 * from James Strong's original 1894 dictionary rather than from BDB.
 *
 * Run: npm run import:strongs-hebrew
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

const DB_PATH    = path.join(process.cwd(), "data", "lexica.db");
const CACHE_DIR  = path.join(process.cwd(), "data", "sources", "lexicon");
const CACHE_FILE = path.join(CACHE_DIR, "StrongHebrewG.xml");
const SOURCE_URL =
  "https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/StrongHebrewG.xml";

// ── XML helpers ───────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  removeNSPrefix: true,
  isArray: (name) => ["div", "item", "note", "w"].includes(name),
  allowBooleanAttributes: true,
});

/**
 * Recursively extract all text content from a fast-xml-parser node,
 * skipping attribute keys (prefixed "@_").
 */
function nodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, v]) => nodeText(v))
      .join("");
  }
  return "";
}

/** Strip remaining XML/HTML tags and collapse whitespace. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ── Entry parser ──────────────────────────────────────────────────────────────

interface ParsedEntry {
  strongNumber: string;
  lemma: string | null;
  transliteration: string | null;
  pronunciation: string | null;
  shortGloss: string | null;
  definition: string;          // HTML stored and rendered via dangerouslySetInnerHTML
  usage: string | null;
}

function parseEntry(div: Record<string, unknown>): ParsedEntry | null {
  // The <w> array — first element with @_ID is the headword
  const words = (div["w"] as Record<string, unknown>[] | undefined) ?? [];
  const headWord = words.find((w) => (w["@_ID"] as string | undefined)?.match(/^H\d+$/));
  if (!headWord) return null;

  const strongNumber = headWord["@_ID"] as string;
  const lemma        = (headWord["@_lemma"] as string | undefined) ?? null;
  const xlit         = (headWord["@_xlit"]  as string | undefined) ?? null;
  const pos          = (headWord["@_POS"]   as string | undefined) ?? null;

  // Notes keyed by type
  const notes = (div["note"] as Record<string, unknown>[] | undefined) ?? [];
  const noteMap: Record<string, string> = {};
  for (const note of notes) {
    const type = (note["@_type"] as string | undefined) ?? "";
    noteMap[type] = stripTags(nodeText(note));
  }

  // Numbered definition items
  const listNode = div["list"] as Record<string, unknown> | undefined;
  const items: string[] = listNode
    ? ((listNode["item"] as unknown[]) ?? []).map((i) => stripTags(nodeText(i)))
    : [];

  // shortGloss: the "explanation" note gives the core gloss (e.g. "father, in a literal...")
  const shortGloss = noteMap["explanation"]
    ? noteMap["explanation"].replace(/^\{|\}$/g, "").trim().slice(0, 200) || null
    : null;

  // usage: KJV translation renderings
  const usage = noteMap["translation"] ? `KJV: ${noteMap["translation"]}` : null;

  // etymology from exegesis note
  const etym = noteMap["exegesis"] ?? null;

  // Build HTML definition
  const parts: string[] = [];
  if (items.length > 0) {
    const liHtml = items.map((item) => {
      // Strip leading "N) " numbering from item text since we use <ol>
      const text = item.replace(/^\d+[a-z]*\)\s*/i, "");
      return `<li>${text}</li>`;
    });
    parts.push(`<ol class="she-list">${liHtml.join("")}</ol>`);
  }
  if (etym) {
    parts.push(`<p class="she-etym">${etym}</p>`);
  }
  if (usage) {
    parts.push(`<p class="she-kjv">${usage}</p>`);
  }
  const definition = `<div class="strong-hebrew-entry">${parts.join("")}</div>`;

  return {
    strongNumber,
    lemma,
    transliteration: xlit,
    pronunciation: pos,
    shortGloss,
    definition,
    usage,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (!existsSync(CACHE_FILE)) {
    console.log(`Fetching ${SOURCE_URL} …`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
    const text = await res.text();
    writeFileSync(CACHE_FILE, text, "utf-8");
    console.log(`  Cached ${(text.length / 1024).toFixed(0)} KB → ${CACHE_FILE}`);
  } else {
    console.log(`Using cached ${CACHE_FILE}`);
  }

  console.log("Parsing XML …");
  const xmlText = readFileSync(CACHE_FILE, "utf-8");
  const parsed  = parser.parse(xmlText);

  // Navigate: osis → osisText → div (glossary) → div[] (entries)
  const osisText  = parsed?.osis?.osisText;
  const outerDivs = osisText?.div as Record<string, unknown>[] | undefined;
  const glossary  = outerDivs?.find(
    (d) => (d["@_type"] as string | undefined) === "glossary"
  );
  if (!glossary) throw new Error("Could not find <div type='glossary'> in parsed XML");

  const entryDivs = (glossary["div"] as Record<string, unknown>[] | undefined) ?? [];
  console.log(`  Found ${entryDivs.length} entry elements`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  let inserted = 0;
  let skipped  = 0;
  const BATCH  = 500;
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
        },
      })
      .run();
    inserted += rows.length;
    rows.length = 0;
    process.stdout.write(`\r  ${inserted} entries…`);
  }

  for (const div of entryDivs) {
    if ((div["@_type"] as string | undefined) !== "entry") { skipped++; continue; }

    const entry = parseEntry(div);
    if (!entry) { skipped++; continue; }

    rows.push({
      strongNumber:    entry.strongNumber,
      language:        "hebrew",
      lemma:           entry.lemma,
      transliteration: entry.transliteration,
      pronunciation:   entry.pronunciation,
      shortGloss:      entry.shortGloss,
      definition:      entry.definition,
      usage:           entry.usage,
      source:          "HebrewStrong",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} Strong's Hebrew entries inserted/updated (${skipped} skipped).`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
