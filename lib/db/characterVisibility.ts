import { eq, inArray } from "drizzle-orm";
import { userDb } from "@/lib/db";
import { characters, bookGroupings, passages } from "@/lib/db/user-schema";
import type { Character, Passage } from "@/lib/db/schema";
import { canonicalPairBook } from "@/lib/utils/osis";
import { chapterFallsInPassage } from "@/lib/utils/passageRange";

export interface CharacterViewContext {
  /** OSIS code(s) of every book actually visible in this view — usually one,
   *  but two for a passage that crosses a book boundary. Used for "book" and
   *  "grouping" scoped characters. */
  books: string[];
  /** Every (book, chapter) pair actually visible in this view. A single
   *  chapter view has one entry; a multi-chapter passage view has one entry
   *  per chapter it spans. Used for "chapter" and "passage" scoped characters. */
  chapters: { book: string; chapter: number }[];
  /** The specific passage row being viewed via the dedicated passage route,
   *  if any — a "passage"-scoped character whose corpusPassageId matches this
   *  is visible even if, by coincidence, the chapter-range check wouldn't
   *  otherwise line up (e.g. verse-only difference). */
  passageId?: number | null;
}

function passageOverlapsView(passage: Passage, ctx: CharacterViewContext): boolean {
  if (ctx.passageId != null && passage.id === ctx.passageId) return true;
  return ctx.chapters.some(({ book, chapter }) => chapterFallsInPassage(passage, book, chapter));
}

/**
 * Resolves every character visible from a given chapter or passage view, per
 * each character's own corpus scope — mirrors resolveVisibleWordTags() (see
 * lib/db/wordTagVisibility.ts), replacing the old, looser rule
 * (getCharTagBookPool: "any character whose book shares any workspace
 * grouping with the current book") with a check against the SPECIFIC scope
 * each character actually declares:
 *   - "book":     character.book (or its contiguous pair, e.g. 1Sam/2Sam) is being viewed
 *   - "chapter":  character.book + corpusChapter is among the visible chapters
 *   - "passage":  corpusPassageId's range overlaps the visible chapters/passage
 *   - "grouping": the current book is listed in corpusGroupingId's book grouping
 */
export async function resolveVisibleCharacters(ctx: CharacterViewContext, workspaceId: number): Promise<Character[]> {
  const allCharacters = await userDb.select().from(characters).where(eq(characters.workspaceId, workspaceId));
  if (allCharacters.length === 0) return [];

  const groupingIds = [...new Set(allCharacters.map((c) => c.corpusGroupingId).filter((id): id is number => id != null))];
  const passageIds = [...new Set(allCharacters.map((c) => c.corpusPassageId).filter((id): id is number => id != null))];

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

  const visible = allCharacters.filter((character) => {
    switch (character.corpusType) {
      case "chapter":
        return character.corpusChapter != null &&
          ctx.chapters.some((c) => c.book === character.book && c.chapter === character.corpusChapter);
      case "passage": {
        if (character.corpusPassageId == null) return false;
        const passage = passageById.get(character.corpusPassageId);
        return passage ? passageOverlapsView(passage, ctx) : false;
      }
      case "grouping": {
        if (character.corpusGroupingId == null) return false;
        const books = groupingBooks.get(character.corpusGroupingId) ?? [];
        return ctx.books.some((b) => books.includes(b));
      }
      case "book":
      default:
        return canonicalBooks.has(character.book);
    }
  });

  return visible.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}
