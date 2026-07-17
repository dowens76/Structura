/**
 * Import script: Brown-Driver-Briggs Hebrew-English Lexicon (BDB) — full text
 *
 * Replaces the OpenScriptures-derived BDB data (scripts/import-bdb.ts) with a
 * far more complete source: a from-scratch conversion of the full 1906 BDB
 * (including the Biblical Aramaic appendix and Addenda et Corrigenda) from a
 * legacy BWHEBB-encoded digitization into clean Unicode HTML. It has ~43x
 * more scripture citations than the OpenScriptures XML, plus comparative
 * Semitic-language notes (Arabic/Syriac/Ethiopic/Samaritan/Persian) the old
 * source never had.
 *
 * Source file: data/sources/lexicon/bdb-full/bdb.html (vendored; copied from
 * the sibling BDB conversion repo if the cached copy is missing).
 *
 * Each dictionary entry is one `<p class="p">...</p>` block (reliably opened
 * AND closed, unlike its inner `<entry>` marker tag which the source never
 * closes) containing an `<entrynum>`, a `<page>` citation, and a
 * `<span class="strongs-number">` (bare digits — sometimes a comma/dash list
 * when BDB discusses several related Strong's-numbered forms in one prose
 * block, e.g. "12, 13" or "168-69"). About 9.8% of entries (root-discussion
 * stubs, cross-reference stubs, and almost all of the Addenda section) have
 * no Strong's number at all and are skipped — they're not reachable through
 * the app's Strong's-number-based lookup regardless.
 *
 * IMPORTANT — this script does NOT wipe the letter-keyed BDB prefix-particle
 * entries ("b", "c", "d", "k", "l", "m", "s" — see
 * lib/morphology/oshb-parser.ts's PREFIX_CONSONANT_MAP) that the OpenScriptures
 * import produces for Hebrew bound-prefix lookups (ב, ו, ה, כ, ל, מ, ש). Those
 * have no equivalent in the new source (bare Strong's numbers only), so this
 * script re-derives them from the same OpenScriptures LexicalIndex.xml +
 * BrownDriverBriggs.xml files scripts/import-bdb.ts uses, keeping only the
 * non-numeric ("letter") xrefs.
 *
 * Revert path: scripts/import-bdb.ts is left untouched — re-running
 * `npm run import:bdb` fully restores the original OpenScriptures content
 * under the same source="BDB" label in the same data/bdb.db file.
 *
 * Run: npm run import:bdb-full
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { parse as parseHtml } from "node-html-parser";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { ensureLexiconTable } from "./_ensure-lexicon-table";

const DB_PATH = path.join(process.cwd(), "data", "bdb.db");

const CACHE_DIR   = path.join(process.cwd(), "data", "sources", "lexicon", "bdb-full");
const HTML_FILE    = path.join(CACHE_DIR, "bdb.html");
const SIBLING_REPO_FILE = "/Users/daniel/Documents/GitHub/BDB/output/bdb.html";

// Strong's number -> candidate primary-gloss strings (the bold gloss BDB
// prints immediately after the headword/POS), sourced from unfoldingWord's
// Brown-Driver-Briggs-Enhanced and backfilled into bdb.html's own <strong>
// markup by the sibling repo's apply_primary_gloss_bolding step. Reused here
// (rather than re-parsing bold spans out of bdb.html, which can't be told
// apart from the headword/POS/sense-number bold spans already in the source)
// to populate lexicon_entries.short_gloss, which drives the Hebrew word
// tooltip (components/text/ParseTooltip.tsx).
const GLOSS_FILE = path.join(CACHE_DIR, "primary-gloss-overrides.json");
const SIBLING_GLOSS_FILE = "/Users/daniel/Documents/GitHub/BDB/fixtures/primary_gloss_overrides.json";

// Same OpenScriptures files scripts/import-bdb.ts uses — reused here only to
// re-derive the letter-keyed prefix-particle entries (see header comment).
const OS_CACHE_DIR    = path.join(process.cwd(), "data", "sources", "lexicon", "bdb");
const LEX_INDEX_FILE  = path.join(OS_CACHE_DIR, "LexicalIndex.xml");
const BDB_XML_FILE    = path.join(OS_CACHE_DIR, "BrownDriverBriggs.xml");
const LEX_INDEX_URL   = "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/LexicalIndex.xml";
const BDB_XML_URL     = "https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/BrownDriverBriggs.xml";
const LEXICON_NS      = "http://openscriptures.github.com/morphhb/namespace";

async function fetchCached(url: string, file: string): Promise<string> {
  if (existsSync(file)) return readFileSync(file, "utf-8");
  console.log(`Fetching ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  writeFileSync(file, text, "utf-8");
  return text;
}

function attr(attrsStr: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = attrsStr.match(re);
  return m ? m[1] : "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Expands a strongs-number span's raw text ("12, 13" / "168-69" /
 *  "1660-61,1663") into a de-duplicated list of individual number strings.
 *  Dashes are always treated as exactly two numbers — the second reconstructed
 *  by copying the first number's leading digits as a common prefix when the
 *  second is shorter ("168-69" -> 168, 169) — never as a wide inclusive range
 *  (real data has a handful of same-length dash pairs like "6984-7029" that
 *  are almost certainly two discrete numbers, not a 46-number span). */
function expandStrongsNumbers(raw: string): string[] {
  const numbers = new Set<string>();
  for (const segRaw of raw.split(",")) {
    const seg = segRaw.trim();
    if (!seg) continue;
    const dashParts = seg.split(/[-–]/).map((s) => s.trim()).filter(Boolean);
    const first = dashParts[0];
    if (!/^\d+$/.test(first)) continue;
    numbers.add(first);
    for (let i = 1; i < dashParts.length; i++) {
      const suffix = dashParts[i];
      if (!/^\d+$/.test(suffix)) continue;
      const prefixLen = Math.max(0, first.length - suffix.length);
      numbers.add(first.slice(0, prefixLen) + suffix);
    }
  }
  return [...numbers];
}

interface ParsedEntry {
  strongNumbers: string[]; // "H"-prefixed
  lemma: string | null;
  definition: string;
}

/** Splits the raw HTML into individual `<p class="p">...</p>` entry
 *  snippets via fast string search — these are reliably opened AND closed,
 *  unlike the inner `<entry>` marker, so this is more robust (and far faster
 *  on a 20MB document) than parsing the whole file into one DOM tree. */
function splitParagraphs(html: string): string[] {
  const snippets: string[] = [];
  const OPEN = '<p class="p">';
  let searchFrom = 0;
  while (true) {
    const start = html.indexOf(OPEN, searchFrom);
    if (start === -1) break;
    const end = html.indexOf("</p>", start);
    if (end === -1) break;
    snippets.push(html.slice(start, end + 4));
    searchFrom = end + 4;
  }
  return snippets;
}

function parseEntrySnippet(snippet: string): ParsedEntry | null {
  if (!snippet.includes("<entrynum>")) return null; // not a real dictionary entry

  const root = parseHtml(snippet, { lowerCaseTagName: false });
  const p = root.querySelector("p.p");
  if (!p) return null;

  const strongsSpan = p.querySelector("span.strongs-number");
  if (!strongsSpan) return null; // no Strong's number -> not reachable via lookup, skip

  const strongNumbers = expandStrongsNumbers(strongsSpan.text).map((n) => `H${n}`);
  if (strongNumbers.length === 0) return null;

  const hebrewSpan = p.querySelector("span.hebrew");
  let lemma = hebrewSpan ? hebrewSpan.text.trim() : null;
  if (lemma?.startsWith("[") ) lemma = lemma.slice(1); // reconstructed-root bracket

  // Strip the entrynum/page/strongs-number "chrome" tags, keeping the rest of
  // the entry's HTML (already close to final display form) as the definition.
  p.querySelector("entrynum")?.remove();
  p.querySelector("page")?.remove();
  strongsSpan.remove();
  const definition = p.innerHTML.trim();

  return { strongNumbers, lemma, definition };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(HTML_FILE)) {
    if (!existsSync(SIBLING_REPO_FILE)) {
      throw new Error(
        `Neither ${HTML_FILE} nor ${SIBLING_REPO_FILE} exist. Vendor the BDB HTML file first.`
      );
    }
    console.log(`Copying ${SIBLING_REPO_FILE} -> ${HTML_FILE}`);
    copyFileSync(SIBLING_REPO_FILE, HTML_FILE);
  }

  if (!existsSync(GLOSS_FILE)) {
    if (!existsSync(SIBLING_GLOSS_FILE)) {
      throw new Error(
        `Neither ${GLOSS_FILE} nor ${SIBLING_GLOSS_FILE} exist. Vendor the primary-gloss overrides file first.`
      );
    }
    console.log(`Copying ${SIBLING_GLOSS_FILE} -> ${GLOSS_FILE}`);
    copyFileSync(SIBLING_GLOSS_FILE, GLOSS_FILE);
  }
  const glossesByStrongs: Record<string, string[]> =
    JSON.parse(readFileSync(GLOSS_FILE, "utf-8")).glosses_by_strongs ?? {};
  console.log(`Loaded primary glosses for ${Object.keys(glossesByStrongs).length} Strong's numbers.`);

  console.log("Reading bdb.html …");
  const html = readFileSync(HTML_FILE, "utf-8");

  console.log("Splitting into entry paragraphs …");
  const snippets = splitParagraphs(html);
  console.log(`  ${snippets.length} <p class="p"> paragraphs found`);

  console.log("Parsing entries …");
  // Keyed by strongNumber, not appended to a plain array: BDB occasionally has
  // multiple entries citing the same Strong's number, and a naive "last one
  // wins" upsert picks the wrong one in two different ways:
  //  - A full discussion vs. a short "see also" cross-reference stub pointing
  //    back to it (e.g. H7225 has both the real "beginning" entry AND a
  //    one-line "רֵשִׁית v. רֵאשִׁית sub ראשׁ" stub) — prefer the longer one.
  //  - A root entry whose own strongs-number list spans several numbers (e.g.
  //    "6, 8", the verb root אָבַד "perish") vs. a *dedicated* entry for just
  //    one of those numbers (e.g. "8" alone, the noun אֹבֵד "destruction") —
  //    here the dedicated entry is more specific to that number even though
  //    it's shorter, so specificity (fewer own numbers) wins first, and
  //    definition length is only the tiebreaker when specificity is equal.
  const rowsByStrong = new Map<string, { specificity: number; row: typeof schema.lexiconEntries.$inferInsert }>();
  let parsedCount = 0;
  let skippedNoStrongs = 0;
  let collisionsResolved = 0;

  for (const snippet of snippets) {
    const parsed = parseEntrySnippet(snippet);
    if (!parsed) {
      if (snippet.includes("<entrynum>")) skippedNoStrongs++;
      continue;
    }
    parsedCount++;
    const specificity = parsed.strongNumbers.length;
    for (const strongNumber of parsed.strongNumbers) {
      const existing = rowsByStrong.get(strongNumber);
      if (existing) {
        collisionsResolved++;
        const existingIsBetter =
          existing.specificity < specificity ||
          (existing.specificity === specificity && (existing.row.definition?.length ?? 0) >= parsed.definition.length);
        if (existingIsBetter) continue;
      }
      const digits = strongNumber.slice(1); // "H7225" -> "7225"
      const shortGloss = glossesByStrongs[digits]?.[0] ?? null;
      rowsByStrong.set(strongNumber, {
        specificity,
        row: {
          strongNumber,
          language: "hebrew",
          lemma: parsed.lemma,
          transliteration: null,
          pronunciation: null,
          shortGloss,
          definition: parsed.definition,
          usage: null,
          source: "BDB",
        },
      });
    }
  }
  const rows = [...rowsByStrong.values()].map((v) => v.row);
  console.log(`  ${parsedCount} entries parsed -> ${rows.length} distinct Strong's-number rows (${collisionsResolved} collisions resolved by specificity/length)`);
  console.log(`  ${skippedNoStrongs} entries skipped (no Strong's number — root/cross-ref stubs, Addenda section)`);

  // ── Re-derive the letter-keyed prefix-particle entries ────────────────────
  console.log("\nRe-deriving letter-keyed prefix-particle entries from OpenScriptures …");
  mkdirSync(OS_CACHE_DIR, { recursive: true });
  const lexIndexXml = await fetchCached(LEX_INDEX_URL, LEX_INDEX_FILE);
  const bdbXml = await fetchCached(BDB_XML_URL, BDB_XML_FILE);

  const bdbIdToEntryXml = new Map<string, string>();
  const bdbEntryRe = /<entry\b([^>]*?)>([\s\S]*?)<\/entry>/g;
  let bm: RegExpExecArray | null;
  while ((bm = bdbEntryRe.exec(bdbXml)) !== null) {
    const id = attr(bm[1], "id");
    if (id) bdbIdToEntryXml.set(id, `<entry xmlns="${LEXICON_NS}" ${bm[1]}>${bm[2]}</entry>`);
  }

  const indexEntryRe = /<entry\b([^>]*?)>([\s\S]*?)<\/entry>/g;
  const xrefRe = /<xref\b([^>]*?)\/>/g;
  let im: RegExpExecArray | null;
  let particleCount = 0;

  while ((im = indexEntryRe.exec(lexIndexXml)) !== null) {
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
      if (!bdbId || !strongAttr || /^\d+$/.test(strongAttr)) continue; // numeric -> from bdb.html now
      const definition = bdbIdToEntryXml.get(bdbId);
      if (!definition) continue;
      rows.push({
        strongNumber: strongAttr.toLowerCase(),
        language: "hebrew",
        lemma,
        transliteration: xlit,
        pronunciation: null,
        shortGloss,
        definition,
        usage: null,
        source: "BDB",
      });
      particleCount++;
    }
  }
  console.log(`  ${particleCount} prefix-particle entries re-derived`);

  // ── Write ──────────────────────────────────────────────────────────────────
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  ensureLexiconTable(sqlite);
  const db = drizzle(sqlite, { schema });

  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'BDB'`).run();
  console.log(`\nCleared ${deleted.changes} existing BDB entries.`);

  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    db.insert(schema.lexiconEntries)
      .values(batch)
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
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${rows.length} rows…`);
  }

  console.log(`\nDone: ${inserted} BDB rows inserted/updated.`);

  const finalCount = sqlite.prepare(`SELECT COUNT(*) as n FROM lexicon_entries WHERE source='BDB'`).get() as { n: number };
  console.log(`  Final row count for source='BDB': ${finalCount.n}`);

  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, short_gloss FROM lexicon_entries WHERE source='BDB' AND strong_number IN ('H1','H7225','H8','H12','H13','b','c') ORDER BY strong_number`)
    .all() as { strong_number: string; lemma: string; short_gloss: string | null }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number}  ${s.lemma}  — ${s.short_gloss}`);

  const glossCount = sqlite
    .prepare(`SELECT COUNT(*) as n FROM lexicon_entries WHERE source='BDB' AND short_gloss IS NOT NULL`)
    .get() as { n: number };
  console.log(`\n${glossCount.n}/${finalCount.n} BDB rows have a primary gloss.`);

  sqlite.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
