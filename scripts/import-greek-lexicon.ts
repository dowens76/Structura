/**
 * Import script: Greek lexicon from Dodson Greek Lexicon (dodson.xml)
 * Source: https://github.com/biblicalhumanities/Dodson-Greek-Lexicon
 * Populates the lexicon_entries table with Greek entries keyed by Strong's number,
 * then back-fills strong_number on SBLGNT word records via lemma matching.
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

const DB_PATH    = path.join(process.cwd(), "data", "source.db");
const CACHE_DIR  = path.join(process.cwd(), "data", "sources", "lexicon");
const CACHE_FILE = path.join(CACHE_DIR, "dodson.xml");
const SOURCE_URL =
  "https://raw.githubusercontent.com/biblicalhumanities/Dodson-Greek-Lexicon/master/dodson.xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  removeNSPrefix: true,
  isArray: (name) => ["entry", "orth", "def"].includes(name),
});

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

  // Dodson: flat list of <entry> elements directly under the root (or under TEI)
  let entries: unknown[] = [];
  function collectEntries(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(collectEntries); return; }
    const obj = node as Record<string, unknown>;
    if (obj["@_n"] && (obj["orth"] || obj["def"])) {
      entries.push(obj);
      return;
    }
    for (const val of Object.values(obj)) collectEntries(val);
  }
  collectEntries(doc);

  console.log(`  Found ${entries.length} entries`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  let inserted = 0;
  let skipped  = 0;
  const BATCH = 500;
  const rows: (typeof schema.lexiconEntries.$inferInsert)[] = [];

  function flush() {
    if (!rows.length) return;
    db.insert(schema.lexiconEntries)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.lexiconEntries.strongNumber,
        set: {
          lemma:           sql`excluded.lemma`,
          transliteration: sql`excluded.transliteration`,
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
    const e = entry as Record<string, unknown>;

    // ── n="ἄβυσσος | 0012" → strongNumber = "G12", lemma = "ἄβυσσος" ─────────
    const nAttr = String(e["@_n"] ?? "");
    const pipeIdx = nAttr.indexOf("|");
    if (pipeIdx < 0) { skipped++; continue; }

    const bareLemma  = nAttr.slice(0, pipeIdx).trim();
    const rawNum     = nAttr.slice(pipeIdx + 1).trim();
    const numInt     = parseInt(rawNum, 10);
    if (isNaN(numInt)) { skipped++; continue; }
    const strongNumber = `G${numInt}`;

    // ── <orth> — full headword with endings, e.g. "ἄβυσσος, ου, ἡ" ───────────
    const orthArr = Array.isArray(e["orth"]) ? e["orth"] : e["orth"] ? [e["orth"]] : [];
    const orth = orthArr
      .map((o: unknown) => {
        if (typeof o === "string") return o;
        const obj = o as Record<string, unknown>;
        return String(obj["#text"] ?? "");
      })
      .join("")
      .trim();

    // ── <def role="brief"> and <def role="full"> ─────────────────────────────
    const defArr = Array.isArray(e["def"]) ? e["def"] : e["def"] ? [e["def"]] : [];
    let shortGloss = "";
    let fullDef    = "";
    for (const d of defArr) {
      const obj  = d as Record<string, unknown>;
      const role = String(obj["@_role"] ?? "");
      const text = String(obj["#text"] ?? "").trim();
      if (role === "brief" && !shortGloss) shortGloss = text;
      if (role === "full"  && !fullDef)    fullDef    = text;
    }

    if (!bareLemma) { skipped++; continue; }

    rows.push({
      strongNumber,
      language:        "greek",
      lemma:           bareLemma,          // bare form for back-fill join
      transliteration: orth || null,       // full form (e.g. "ἄβυσσος, ου, ἡ") shown in UI
      pronunciation:   null,
      shortGloss:      shortGloss || null,
      definition:      fullDef || null,
      usage:           null,
      source:          "Dodson",
    });

    if (rows.length >= BATCH) flush();
  }
  flush();

  console.log(`\nDone: ${inserted} entries inserted/updated, ${skipped} skipped.`);

  // ── Back-fill strong_number on SBLGNT words via lemma → lexicon match ───────
  console.log("Back-filling strong_number on SBLGNT words …");
  // Ensure an index on lemma exists so the correlated subquery is fast.
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS lex_lemma_idx ON lexicon_entries(lemma, language)`
  );
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
         AND lemma IS NOT NULL`
    )
    .run();
  console.log(`  Updated ${updated.changes} words.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
