/**
 * Import script: default Synoptic View sets (Gospels, Kings/Chronicles,
 * Psalm 18 / 2 Samuel 22), curated from openly available parallel-passage
 * harmonies and seeded into every existing workspace.
 *
 * Idempotent by (workspace_id, slug): a set that was already imported once is
 * NEVER touched again on re-run, even if its shipped JSON later changes — so
 * a user's own edits to a seeded set's scope always survive re-running this
 * script. Only genuinely new slugs (e.g. added in a future update) get inserted.
 *
 * Run: npm run import:synoptic
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import path from "path";

const USER_DB_PATH = path.join(process.cwd(), "data", "user.db");
const SEED_DIR = path.join(process.cwd(), "data", "seed");

interface SeedColumn {
  book: string;
  textSource: string;
  columnLabel: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  endBook?: string | null;
}

interface SeedSet {
  slug: string;
  title: string;
  corpus: string;
  columns: SeedColumn[];
}

const SEED_FILES = [
  "synoptic-gospels.json",
  "synoptic-kings-chronicles.json",
  "synoptic-psalms.json",
];

function main() {
  if (!existsSync(USER_DB_PATH)) {
    console.log("data/user.db does not exist yet.");
    console.log("Run 'npm run dev' once to initialize the database, then run 'npm run import:synoptic' again.");
    return;
  }

  const db = new Database(USER_DB_PATH);
  db.pragma("foreign_keys = ON");

  const tableCols = (db.prepare("PRAGMA table_info(synoptic_sets)").all() as { name: string }[]).map((r) => r.name);
  if (tableCols.length === 0) {
    console.log("The synoptic_sets table doesn't exist yet.");
    console.log("Start the app once (npm run dev) to run the pending migration, then try again.");
    return;
  }

  const sets: SeedSet[] = SEED_FILES.flatMap((file) =>
    JSON.parse(readFileSync(path.join(SEED_DIR, file), "utf-8")) as SeedSet[]
  );

  const workspaceIds = (db.prepare("SELECT id FROM workspaces").all() as { id: number }[]).map((r) => r.id);
  if (workspaceIds.length === 0) {
    console.log("No workspaces found — start the app once so the default workspace is created.");
    return;
  }

  const findExisting = db.prepare(
    "SELECT id FROM synoptic_sets WHERE workspace_id = ? AND slug = ?"
  );
  const insertSet = db.prepare(
    `INSERT INTO synoptic_sets (workspace_id, title, corpus, source, slug, sort_order, created_at)
     VALUES (?, ?, ?, 'seed', ?, ?, ?)`
  );
  const insertColumn = db.prepare(
    `INSERT INTO passages
       (workspace_id, book, text_source, label, start_chapter, start_verse, end_book, end_chapter, end_verse,
        synoptic_set_id, column_index, column_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const importAll = db.transaction(() => {
    for (const workspaceId of workspaceIds) {
      sets.forEach((set, sortOrder) => {
        const existing = findExisting.get(workspaceId, set.slug);
        if (existing) { skipped++; return; }

        const result = insertSet.run(workspaceId, set.title, set.corpus, set.slug, sortOrder, now);
        const setId = result.lastInsertRowid as number;

        set.columns.forEach((col, columnIndex) => {
          insertColumn.run(
            workspaceId, col.book, col.textSource, col.columnLabel,
            col.startChapter, col.startVerse,
            col.endBook && col.endBook !== col.book ? col.endBook : null,
            col.endChapter, col.endVerse,
            setId, columnIndex, col.columnLabel
          );
        });
        inserted++;
      });
    }
  });
  importAll();

  console.log(`Synoptic sets: ${inserted} inserted, ${skipped} already present (left untouched) across ${workspaceIds.length} workspace(s).`);
}

main();
