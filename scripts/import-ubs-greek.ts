/**
 * Import script: UBS Dictionary of the Greek New Testament (adapted from SDBG)
 * Source: https://github.com/BibleAquifer/UBSGreekNTDictionary
 * © United Bible Societies, 2000–2023. CC BY-SA 4.0.
 *
 * See scripts/_import-ubs-common.ts for the shared Aquifer JSON/HTML parsing.
 * Unlike Hebrew, the Greek dictionary's Strong's numbers map to entries
 * essentially 1:1, but the same specificity/length collision-resolution as
 * scripts/import-ubs-hebrew.ts is applied anyway for the rare cases where
 * they don't.
 *
 * Run: npm run import:ubs-greek
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { ensureLexiconTable } from "./_ensure-lexicon-table";
import { listContentFiles, parseUbsEntry, type UbsRawEntry } from "./_import-ubs-common";

const DB_PATH   = path.join(process.cwd(), "data", "ubs-greek.db");
const CACHE_DIR = path.join(process.cwd(), "data", "sources", "lexicon", "ubs-greek");
const REPO      = "UBSGreekNTDictionary";

async function fetchContentFile(relPath: string): Promise<UbsRawEntry[]> {
  const cacheFile = path.join(CACHE_DIR, path.basename(relPath));
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }
  const url = `https://raw.githubusercontent.com/BibleAquifer/${REPO}/main/eng/${relPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  writeFileSync(cacheFile, text, "utf-8");
  return JSON.parse(text);
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`Fetching file list for ${REPO} …`);
  const files = await listContentFiles(REPO);
  console.log(`  ${files.length} content files`);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  ensureLexiconTable(sqlite);
  const db = drizzle(sqlite, { schema });

  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'UBSGreek'`).run();
  console.log(`  Cleared ${deleted.changes} existing UBSGreek entries.`);

  const rowsByStrong = new Map<string, { specificity: number; row: typeof schema.lexiconEntries.$inferInsert }>();
  let parsedCount = 0;
  let skipped = 0;
  let collisionsResolved = 0;

  for (let i = 0; i < files.length; i++) {
    process.stdout.write(`\r  Downloading/parsing ${i + 1}/${files.length} …`);
    const entries = await fetchContentFile(files[i]);
    for (const entry of entries) {
      const parsed = parseUbsEntry(entry, "G");
      if (!parsed) { skipped++; continue; }
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
        rowsByStrong.set(strongNumber, {
          specificity,
          row: {
            strongNumber,
            language:        "greek",
            lemma:           parsed.lemma,
            transliteration: null,
            pronunciation:   null,
            shortGloss:      parsed.shortGloss,
            definition:      parsed.definition,
            usage:           null,
            source:          "UBSGreek",
          },
        });
      }
    }
  }
  console.log();

  const rows = [...rowsByStrong.values()].map((v) => v.row);
  console.log(`  ${parsedCount} entries parsed -> ${rows.length} distinct Strong's-number rows (${collisionsResolved} collisions resolved)`);
  console.log(`  ${skipped} entries skipped (no Greek Strong's number).`);

  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    db.insert(schema.lexiconEntries)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.lexiconEntries.strongNumber, schema.lexiconEntries.source],
        set: {
          lemma:      sql`excluded.lemma`,
          shortGloss: sql`excluded.short_gloss`,
          definition: sql`excluded.definition`,
        },
      })
      .run();
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${rows.length} rows inserted…`);
  }
  console.log(`\nDone: ${inserted} rows inserted into ${DB_PATH}.`);

  // Cross-check against sblgnt.db: Greek lookups are by lemma, so report what
  // fraction of live lemmas this covers.
  const sblgntPath = path.join(process.cwd(), "data", "sblgnt.db");
  if (existsSync(sblgntPath)) {
    const sblgntDb = new Database(sblgntPath, { readonly: true });
    const liveLemmas = (sblgntDb.prepare(
      `SELECT DISTINCT lemma FROM words WHERE lemma IS NOT NULL`
    ).all() as { lemma: string }[]).map((r) => r.lemma);
    const ubsLemmas = new Set(rows.map((r) => r.lemma));
    const covered = liveLemmas.filter((l) => ubsLemmas.has(l)).length;
    console.log(`Coverage: ${covered}/${liveLemmas.length} distinct lemmas used in SBLGNT have a UBSGreek entry.`);
    sblgntDb.close();
  }

  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, short_gloss FROM lexicon_entries WHERE source='UBSGreek' AND strong_number IN ('G18','G2316','G26') ORDER BY strong_number`)
    .all() as { strong_number: string; lemma: string; short_gloss: string | null }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number}  ${s.lemma}  — ${s.short_gloss}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
