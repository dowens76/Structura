import { eq, and, inArray } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { passages } from "@/lib/db/user-schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Chapter = { book: string; chapter: number };

export type Scope =
  | { type: "chapter"; book: string; chapter: number }
  | { type: "passage"; passageId: number };

export type DataType =
  | "translationVerses"
  | "sectionBreaks"
  | "lineAnnotations"
  | "wordTags"
  | "wordFormatting"
  | "characters"
  | "lineIndents"
  | "wordArrows"
  | "rstRelations"
  | "notes"
  | "passages";

/** Data types the copy feature can detect pre-existing target data for and ask overwrite/skip. */
export type OverwritableDataType = "translationVerses" | "lineAnnotations";

export type OverwriteMode = "add" | "overwrite" | "skip";

// ─── Scope resolution ────────────────────────────────────────────────────────

export async function resolveScope(scope: Scope, src: number): Promise<Chapter[]> {
  if (scope.type === "chapter") {
    return [{ book: scope.book, chapter: scope.chapter }];
  }

  // Passage scope: look up the passage in the source workspace
  const passageRows = await userDb
    .select()
    .from(passages)
    .where(
      and(
        eq(passages.workspaceId, src),
        eq(passages.id, scope.passageId)
      )
    );

  if (passageRows.length === 0) {
    return [];
  }

  const passage = passageRows[0];
  const chapters: Chapter[] = [];
  for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) {
    chapters.push({ book: passage.book, chapter: ch });
  }
  return chapters;
}

// ─── Scope filter helpers ────────────────────────────────────────────────────

/**
 * Build a Drizzle WHERE condition for rows that match any of the given chapters.
 * The table must have .workspaceId, .book, and .chapter columns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chapterCondition<T extends { workspaceId: any; book: any; chapter: any }>(
  table: T,
  workspaceId: number,
  chapters: Chapter[]
) {
  if (chapters.length === 0) return null;

  if (chapters.length === 1) {
    return and(
      eq(table.workspaceId, workspaceId),
      eq(table.book, chapters[0].book),
      eq(table.chapter, chapters[0].chapter)
    );
  }

  // Group chapters by book (in practice usually one book, but handle multi-book)
  const byBook = new Map<string, number[]>();
  for (const { book, chapter } of chapters) {
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)!.push(chapter);
  }

  const books = [...byBook.keys()];
  if (books.length === 1) {
    const book = books[0];
    return and(
      eq(table.workspaceId, workspaceId),
      eq(table.book, book),
      inArray(table.chapter, byBook.get(book)!)
    );
  }

  // Multiple books: fetch all for the workspace filtered by book set and chapter sets
  // We use OR conditions per book. Drizzle's `or` isn't imported, so we use inArray on
  // chapter across the full set (acceptable because cross-book chapter overlap is fine
  // given we also filter by book below via a second pass — but to keep it simple and
  // correct we use the broadest safe filter and let the insert be idempotent).
  // For correctness with multiple books: return workspace-level filter and post-filter.
  return eq(table.workspaceId, workspaceId);
}

/** Filter fetched rows to only those matching the chapters list. */
export function filterByChapters<T extends { book: string; chapter: number }>(
  rows: T[],
  chapters: Chapter[]
): T[] {
  const set = new Set(chapters.map((c) => `${c.book}:${c.chapter}`));
  return rows.filter((r) => set.has(`${r.book}:${r.chapter}`));
}

/**
 * translationVerses has no `.book` column (only `osisRef` / `bookId`, and bookId
 * references a different database file). Match book+chapter via the osisRef
 * prefix instead, e.g. "Gen.1." — otherwise chapter-number-only filtering would
 * also pull in unrelated books that happen to share a chapter number (Exod 1,
 * Matt 1, etc. when copying Gen 1).
 */
export function filterVersesByChapters<T extends { osisRef: string }>(
  rows: T[],
  chapters: Chapter[]
): T[] {
  const prefixes = chapters.map((c) => `${c.book}.${c.chapter}.`);
  return rows.filter((r) => prefixes.some((p) => r.osisRef.startsWith(p)));
}
