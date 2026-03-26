/**
 * Import script: Greek lexicon from Abbott-Smith's Manual Greek Lexicon of the NT
 * Source: https://github.com/translatable-exegetical-tools/Abbott-Smith
 * Populates the lexicon_entries table with Greek entries keyed by Strong's number.
 *
 * Run: npm run import:greek-lexicon
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";

const DB_PATH = path.join(process.cwd(), "data", "structura.db");
const CACHE_DIR = path.join(process.cwd(), "data", "sources", "lexicon");
const CACHE_FILE = path.join(CACHE_DIR, "abbott-smith.tei.xml");
const SOURCE_URL =
  "https://raw.githubusercontent.com/translatable-exegetical-tools/Abbott-Smith/master/abbott-smith.tei.xml";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  removeNSPrefix: true, // strip TEI namespace prefixes (xml:lang → lang, etc.)
  isArray: (name) =>
    ["entry", "entryFree", "sense", "gloss", "note", "form", "orth", "seg", "re", "ref"].includes(name),
});

// ── Text helpers ──────────────────────────────────────────────────────────────

/** Recursively flatten any parsed XML node to plain text, skipping ref/foreign tags
 *  that would clutter the definition with scripture citations. */
function flattenText(node: unknown, skipTags: Set<string> = new Set()): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node
      .map((n) => flattenText(n, skipTags))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const parts: string[] = [];
    if (obj["#text"] !== undefined) parts.push(flattenText(obj["#text"], skipTags));
    for (const [key, val] of Object.entries(obj)) {
      if (key === "#text" || key.startsWith("@_")) continue;
      if (skipTags.has(key)) continue;
      parts.push(flattenText(val, skipTags));
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Extract the first <gloss> text from a sense node (or array of sense nodes). */
function firstGloss(senseNodes: unknown[]): string {
  for (const senseNode of senseNodes) {
    const s = senseNode as Record<string, unknown>;
    const glosses = s.gloss;
    if (glosses) {
      const arr = Array.isArray(glosses) ? glosses : [glosses];
      for (const g of arr) {
        const text = flattenText(g).trim();
        if (text) return text;
      }
    }
    // Recurse into nested sense elements
    const nested = s.sense;
    if (nested) {
      const nestedArr = Array.isArray(nested) ? nested : [nested];
      const found = firstGloss(nestedArr);
      if (found) return found;
    }
  }
  return "";
}

/** Flatten all sense content to a readable definition string.
 *  Skips <ref> (scripture citations) and <re> (synonym blocks) to keep it clean. */
const SKIP_DEFINITION = new Set(["ref", "re", "note"]);
function flattenSenses(senseNodes: unknown[]): string {
  return senseNodes
    .map((n) => flattenText(n, SKIP_DEFINITION))
    .filter(Boolean)
    .join("; ");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Download or use cache
  if (!existsSync(CACHE_FILE)) {
    console.log(`Fetching ${SOURCE_URL} …`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
    const xml = await res.text();
    writeFileSync(CACHE_FILE, xml, "utf-8");
    console.log(`  Cached ${(xml.length / 1024).toFixed(0)} KB → ${CACHE_FILE}`);
  } else {
    console.log(`Using cached ${CACHE_FILE}`);
  }

  const xml = readFileSync(CACHE_FILE, "utf-8");
  console.log("Parsing XML …");
  const doc = parser.parse(xml) as Record<string, unknown>;

  // Navigate TEI structure: TEI > text > body > entry[]
  // With removeNSPrefix, the root key is just "TEI"
  const tei = (doc["TEI"] ?? doc[Object.keys(doc).find((k) => !k.startsWith("?")) ?? ""]) as
    | Record<string, unknown>
    | undefined;
  const text = tei?.text as Record<string, unknown> | undefined;
  const body = text?.body as Record<string, unknown> | undefined;

  // Abbott-Smith uses <entry> elements; collect them
  const entries: unknown[] = [];
  if (body) {
    const rawEntries = body.entry ?? body.entryFree ?? [];
    if (Array.isArray(rawEntries)) entries.push(...rawEntries);
  }

  // Fallback: sometimes the parser flattens differently; search recursively
  if (entries.length === 0) {
    console.warn("Could not find entries under TEI > text > body — trying flat search …");
    function collect(node: unknown) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      const obj = node as Record<string, unknown>;
      if (obj["@_n"] && (obj.sense || obj.form)) { entries.push(obj); return; }
      for (const val of Object.values(obj)) collect(val);
    }
    collect(doc);
  }

  console.log(`  Found ${entries.length} potential entries`);

  let inserted = 0;
  let skipped = 0;
  const BATCH = 500;
  const rows: (typeof schema.lexiconEntries.$inferInsert)[] = [];

  function flush() {
    if (rows.length === 0) return;
    db.insert(schema.lexiconEntries)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.lexiconEntries.strongNumber,
        set: {
          lemma:        sql`excluded.lemma`,
          shortGloss:   sql`excluded.short_gloss`,
          definition:   sql`excluded.definition`,
          usage:        sql`excluded.usage`,
          source:       sql`excluded.source`,
        },
      })
      .run();
    inserted += rows.length;
    rows.length = 0;
  }

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;

    // ── Strong number from n="word|G1234" ────────────────────────────────────
    const nAttr = String(e["@_n"] ?? "");
    const pipeIdx = nAttr.indexOf("|");
    if (pipeIdx < 0) { skipped++; continue; }
    const rawStrong = nAttr.slice(pipeIdx + 1).trim();
    // Normalize: strip trailing lowercase suffix (e.g. "G3588a" → "G3588")
    const strongNumber = rawStrong.replace(/([A-Z]\d+)[a-z]$/, "$1");
    if (!strongNumber.startsWith("G")) { skipped++; continue; }

    // ── Lemma (<form><orth>) ──────────────────────────────────────────────────
    const formArr = e.form;
    const forms = Array.isArray(formArr) ? formArr : formArr ? [formArr] : [];
    let lemma = "";
    for (const form of forms) {
      const f = form as Record<string, unknown>;
      const orthArr = f.orth;
      const orths = Array.isArray(orthArr) ? orthArr : orthArr ? [orthArr] : [];
      for (const orth of orths) {
        const text = flattenText(orth).trim();
        if (text) { lemma = text; break; }
      }
      if (lemma) break;
    }
    // Fallback: headword is before the pipe in n attribute
    if (!lemma) lemma = nAttr.slice(0, pipeIdx).trim();
    if (!lemma) { skipped++; continue; }

    // ── NT occurrence count (<note type="occurrencesNT">) ────────────────────
    const noteArr = e.note;
    const notes = Array.isArray(noteArr) ? noteArr : noteArr ? [noteArr] : [];
    let occurrences = "";
    for (const note of notes) {
      const n = note as Record<string, unknown>;
      if (String(n["@_type"] ?? "") === "occurrencesNT") {
        const count = flattenText(n["#text"] ?? n).trim();
        if (count) { occurrences = `NT occurrences: ${count}`; break; }
      }
    }

    // ── Senses ────────────────────────────────────────────────────────────────
    const senseArr = e.sense;
    const senses = Array.isArray(senseArr) ? senseArr : senseArr ? [senseArr] : [];
    const shortGloss = firstGloss(senses);
    const definition = flattenSenses(senses);

    rows.push({
      strongNumber,
      language: "greek",
      lemma,
      transliteration: null,
      pronunciation: null,
      shortGloss: shortGloss || null,
      definition: definition || null,
      usage: occurrences || null,
      source: "AbbottSmith",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`Done: ${inserted} entries inserted/updated, ${skipped} skipped.`);

  // Back-fill strong_number on SBLGNT words using lemma → lexicon match.
  // MorphGNT files don't ship Strong's numbers, but Abbott-Smith entries do.
  console.log("Back-filling strong_number on SBLGNT words …");
  const updated = sqlite
    .prepare(
      `UPDATE words
       SET strong_number = (
         SELECT le.strong_number
         FROM lexicon_entries le
         WHERE le.lemma = words.lemma
           AND le.language = 'greek'
         LIMIT 1
       )
       WHERE text_source = 'SBLGNT'
         AND strong_number IS NULL
         AND lemma IS NOT NULL`
    )
    .run();
  console.log(`  Updated ${updated.changes} words.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
