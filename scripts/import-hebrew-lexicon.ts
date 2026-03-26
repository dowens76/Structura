/**
 * Import script: Hebrew lexicon from openscriptures/HebrewLexicon (HebrewStrong.xml)
 * Populates the lexicon_entries table with BDB/Strong's entries for Hebrew words.
 *
 * Run: npm run import:hebrew-lexicon
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
const CACHE_FILE = path.join(CACHE_DIR, "HebrewStrong.xml");
const SOURCE_URL =
  "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/HebrewStrong.xml";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  isArray: (name) => ["entry", "w", "def"].includes(name),
});

// ── Text helpers ──────────────────────────────────────────────────────────────

/** Recursively flatten any parsed XML node to plain text. */
function flattenText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node
      .map(flattenText)
      .filter(Boolean)
      .join(" ");
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const parts: string[] = [];
    // Collect #text first (preserves leading text before child elements)
    if (obj["#text"] !== undefined) parts.push(flattenText(obj["#text"]));
    for (const [key, val] of Object.entries(obj)) {
      if (key === "#text" || key.startsWith("@_")) continue;
      parts.push(flattenText(val));
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Extract the first <def> text from a <meaning> node as a short gloss. */
function firstDef(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  const defs = obj["def"];
  if (defs === undefined) {
    // No <def> child — fall back to the raw #text (may be a simple phrase)
    const t = typeof obj["#text"] === "string" ? obj["#text"] : "";
    return t.split(",")[0].trim();
  }
  const defArr = Array.isArray(defs) ? defs : [defs];
  const first = defArr[0];
  if (typeof first === "string") return first.trim();
  if (typeof first === "object" && first !== null) {
    return flattenText((first as Record<string, unknown>)["#text"] ?? first);
  }
  return String(first ?? "").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Download (or load from cache)
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

  // The root element may be namespaced; try both "lexicon" and the first key.
  const rootKey = Object.keys(doc).find((k) => !k.startsWith("?")) ?? "";
  const lexicon = (doc["lexicon"] ?? doc[rootKey]) as Record<string, unknown> | undefined;
  const entries: unknown[] = Array.isArray(lexicon?.entry) ? lexicon.entry : [];
  console.log(`  Found ${entries.length} entries`);

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
  }

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const strongNumber = String(e["@_id"] ?? "").trim();
    if (!strongNumber.startsWith("H")) { skipped++; continue; }

    // ── Lemma (<w> element) ──────────────────────────────────────────────────
    const ws: unknown[] = Array.isArray(e.w) ? e.w : e.w ? [e.w] : [];
    let lemma = "";
    let xlit = "";
    let pron = "";
    for (const w of ws) {
      const wEl = w as Record<string, unknown>;
      if (wEl["@_src"]) continue; // cross-reference — skip
      const text = flattenText(wEl["#text"] ?? wEl).trim();
      if (text) {
        lemma = text;
        xlit = String(wEl["@_xlit"] ?? "").trim();
        pron = String(wEl["@_pron"] ?? "").trim();
        break;
      }
    }
    if (!lemma) { skipped++; continue; }

    // ── Definition (<meaning>) ───────────────────────────────────────────────
    const meaning = e.meaning;
    const shortGloss = firstDef(meaning);
    const definition = flattenText(meaning);

    // ── Usage (<usage>) ──────────────────────────────────────────────────────
    const usage = flattenText(e.usage);

    rows.push({
      strongNumber,
      language: "hebrew",
      lemma,
      transliteration: xlit || null,
      pronunciation: pron || null,
      shortGloss: shortGloss || null,
      definition: definition || null,
      usage: usage || null,
      source: "HebrewStrong",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`Done: ${inserted} entries inserted/updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
