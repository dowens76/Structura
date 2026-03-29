/**
 * Splits the legacy structura.db into source.db and user.db.
 *
 * source.db — read-only source text: books, words, verses, lexicon_entries
 * user.db   — mutable user data: all annotation and translation tables
 *
 * Strategy: copy the full database to each destination, then drop the tables
 * that don't belong. This preserves all DDL (indexes, constraints, triggers).
 *
 * Run once after upgrading: npx tsx scripts/split-db.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR  = path.join(process.cwd(), "data");
const OLD_PATH  = path.join(DATA_DIR, "structura.db");
const SRC_PATH  = path.join(DATA_DIR, "source.db");
const USER_PATH = path.join(DATA_DIR, "user.db");

const SOURCE_TABLES = ["books", "words", "verses", "lexicon_entries"];
const USER_TABLES = [
  "translations", "translation_verses",
  "paragraph_breaks", "characters", "character_refs", "speech_sections",
  "word_tags", "word_tag_refs", "line_indents", "scene_breaks", "passages",
  "clause_relationships", "rst_relations", "word_arrows", "line_annotations",
  "word_formatting", "notes", "rst_custom_types",
];

async function copyAndDrop(srcPath: string, destPath: string, tablesToDrop: string[]) {
  if (fs.existsSync(destPath)) {
    console.log(`  ${path.basename(destPath)} already exists — skipping (delete it first to re-run).`);
    return;
  }

  console.log(`  Copying ${path.basename(srcPath)} → ${path.basename(destPath)} ...`);
  const src = new Database(srcPath, { readonly: true });
  await src.backup(destPath);
  src.close();

  console.log(`  Dropping unwanted tables from ${path.basename(destPath)} ...`);
  const dest = new Database(destPath);
  dest.pragma("journal_mode = WAL");
  dest.pragma("foreign_keys = OFF"); // must be OFF to drop FK-referenced tables
  for (const table of tablesToDrop) {
    dest.exec(`DROP TABLE IF EXISTS "${table}"`);
  }
  dest.exec("VACUUM");
  dest.close();
  console.log(`  ${path.basename(destPath)} ready.`);
}

async function main() {
  if (!fs.existsSync(OLD_PATH)) {
    console.error(`Error: ${OLD_PATH} not found. Nothing to split.`);
    process.exit(1);
  }

  console.log("Splitting structura.db → source.db + user.db\n");

  await copyAndDrop(OLD_PATH, SRC_PATH,  USER_TABLES);
  await copyAndDrop(OLD_PATH, USER_PATH, SOURCE_TABLES);

  console.log("\nDone. You can now remove data/structura.db if desired.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
