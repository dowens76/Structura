/**
 * Import script: UBS Dictionary of Biblical Hebrew (adapted from SDBH)
 * Source: https://github.com/BibleAquifer/UBSHebrewDictionary
 * © United Bible Societies, 2000–2023. CC BY-SA 4.0.
 *
 * See scripts/_import-ubs-common.ts for the shared Aquifer JSON/HTML parsing.
 * Like BDB, a single semantic entry can carry several Strong's numbers (or
 * several entries can share one) — collisions are resolved the same way
 * scripts/import-bdb-full.ts does: prefer the entry that's more specific to
 * that number (fewer Strong's numbers of its own), tie-broken by longer
 * definition.
 *
 * Run: npm run import:ubs-hebrew
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import * as schema from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { ensureLexiconTable } from "./_ensure-lexicon-table";
import { listContentFiles, parseUbsEntry, type UbsRawEntry } from "./_import-ubs-common";

const DB_PATH   = path.join(process.cwd(), "data", "ubs-hebrew.db");
const CACHE_DIR = path.join(process.cwd(), "data", "sources", "lexicon", "ubs-hebrew");
const REPO      = "UBSHebrewDictionary";

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

  const deleted = sqlite.prepare(`DELETE FROM lexicon_entries WHERE source = 'UBSHebrew'`).run();
  console.log(`  Cleared ${deleted.changes} existing UBSHebrew entries.`);

  const rowsByStrong = new Map<string, { specificity: number; row: typeof schema.lexiconEntries.$inferInsert }>();
  let parsedCount = 0;
  let skipped = 0;
  let collisionsResolved = 0;

  for (let i = 0; i < files.length; i++) {
    process.stdout.write(`\r  Downloading/parsing ${i + 1}/${files.length} …`);
    const entries = await fetchContentFile(files[i]);
    for (const entry of entries) {
      const parsed = parseUbsEntry(entry, "H");
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
            language:        "hebrew",
            lemma:           parsed.lemma,
            transliteration: null,
            pronunciation:   null,
            shortGloss:      parsed.shortGloss,
            definition:      parsed.definition,
            usage:           null,
            source:          "UBSHebrew",
          },
        });
      }
    }
  }
  console.log();

  const rows = [...rowsByStrong.values()].map((v) => v.row);
  console.log(`  ${parsedCount} entries parsed -> ${rows.length} distinct Strong's-number rows (${collisionsResolved} collisions resolved)`);
  console.log(`  ${skipped} entries skipped (no Hebrew Strong's number).`);

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

  // Cross-check against oshb.db: what fraction of live Strong's numbers this
  // covers, so gaps are visible without opening the app.
  const oshbPath = path.join(process.cwd(), "data", "oshb.db");
  if (existsSync(oshbPath)) {
    const oshbDb = new Database(oshbPath, { readonly: true });
    const liveStrongs = (oshbDb.prepare(
      `SELECT DISTINCT strong_number FROM words WHERE strong_number IS NOT NULL`
    ).all() as { strong_number: string }[]).map((r) => r.strong_number);
    const covered = liveStrongs.filter((s) => rowsByStrong.has(s)).length;
    console.log(`Coverage: ${covered}/${liveStrongs.length} distinct Strong's numbers used in OSHB have a UBSHebrew entry.`);
    oshbDb.close();
  }

  const sample = sqlite
    .prepare(`SELECT strong_number, lemma, short_gloss FROM lexicon_entries WHERE source='UBSHebrew' AND strong_number IN ('H1','H7225','H8') ORDER BY strong_number`)
    .all() as { strong_number: string; lemma: string; short_gloss: string | null }[];
  console.log("\nSample entries:");
  for (const s of sample) console.log(`  ${s.strong_number}  ${s.lemma}  — ${s.short_gloss}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
