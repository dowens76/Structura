import { eq, inArray } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { wordTags, bookGroupings, passages } from "@/lib/db/user-schema";
import type { WordTag, Passage } from "@/lib/db/schema";
import { canonicalPairBook } from "@/lib/utils/osis";
import { chapterFallsInPassage } from "@/lib/utils/passageRange";

export interface WordTagViewContext {
  /** OSIS code(s) of every book actually visible in this view — usually one,
   *  but two for a passage that crosses a book boundary. Used for "book" and
   *  "grouping" scoped tags. */
  books: string[];
  /** Every (book, chapter) pair actually visible in this view. A single
   *  chapter view has one entry; a multi-chapter passage view has one entry
   *  per chapter it spans. Used for "chapter" and "passage" scoped tags. */
  chapters: { book: string; chapter: number }[];
  /** The specific passage row being viewed via the dedicated passage route,
   *  if any — a "passage"-scoped tag whose corpusPassageId matches this is
   *  visible even if, by coincidence, the chapter-range check wouldn't
   *  otherwise line up (e.g. verse-only difference). */
  passageId?: number | null;
}

function passageOverlapsView(passage: Passage, ctx: WordTagViewContext): boolean {
  if (ctx.passageId != null && passage.id === ctx.passageId) return true;
  return ctx.chapters.some(({ book, chapter }) => chapterFallsInPassage(passage, book, chapter));
}

/**
 * Resolves every word/concept tag visible from a given chapter or passage
 * view, per each tag's own corpus scope — replacing the old, looser rule
 * ("any tag whose book shares any workspace grouping with the current book")
 * with a check against the SPECIFIC scope each tag actually declares:
 *   - "book":     tag.book (or its contiguous pair, e.g. 1Sam/2Sam) is being viewed
 *   - "chapter":  tag.book + tag.corpusChapter is among the visible chapters
 *   - "passage":  tag.corpusPassageId's range overlaps the visible chapters/passage
 *   - "grouping": the current book is listed in tag.corpusGroupingId's book grouping
 */
export async function resolveVisibleWordTags(ctx: WordTagViewContext, workspaceId: number): Promise<WordTag[]> {
  const allTags = await userDb.select().from(wordTags).where(eq(wordTags.workspaceId, workspaceId));
  if (allTags.length === 0) return [];

  const groupingIds = [...new Set(allTags.map((t) => t.corpusGroupingId).filter((id): id is number => id != null))];
  const passageIds = [...new Set(allTags.map((t) => t.corpusPassageId).filter((id): id is number => id != null))];

  const [groupingRows, passageRows] = await Promise.all([
    groupingIds.length > 0 ? userDb.select().from(bookGroupings).where(inArray(bookGroupings.id, groupingIds)) : Promise.resolve([]),
    passageIds.length > 0 ? userDb.select().from(passages).where(inArray(passages.id, passageIds)) : Promise.resolve([]),
  ]);

  const groupingBooks = new Map<number, string[]>();
  for (const g of groupingRows) {
    try { groupingBooks.set(g.id, JSON.parse(g.books) as string[]); } catch { groupingBooks.set(g.id, []); }
  }
  const passageById = new Map(passageRows.map((p) => [p.id, p]));

  const canonicalBooks = new Set(ctx.books.map(canonicalPairBook));

  const visible = allTags.filter((tag) => {
    switch (tag.corpusType) {
      case "chapter":
        return tag.corpusChapter != null &&
          ctx.chapters.some((c) => c.book === tag.book && c.chapter === tag.corpusChapter);
      case "passage": {
        if (tag.corpusPassageId == null) return false;
        const passage = passageById.get(tag.corpusPassageId);
        return passage ? passageOverlapsView(passage, ctx) : false;
      }
      case "grouping": {
        if (tag.corpusGroupingId == null) return false;
        const books = groupingBooks.get(tag.corpusGroupingId) ?? [];
        return ctx.books.some((b) => books.includes(b));
      }
      case "book":
      default:
        return canonicalBooks.has(tag.book);
    }
  });

  return visible.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}
