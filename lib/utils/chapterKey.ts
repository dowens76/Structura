import type { Word } from "@/lib/db/schema";

/**
 * Composite key disambiguating a chapter number across books.
 *
 * Raw chapter numbers collide across books (e.g. both "1 Samuel 1" and
 * "2 Samuel 1" are `chapter === 1`), so any code that groups or looks up
 * data by chapter across a potential book boundary — as happens in
 * cross-book passages — must key on (bookId, chapter), not chapter alone.
 */
export function chapterKey(bookId: number, chapter: number): string {
  return `${bookId}:${chapter}`;
}

export function wordChapterKey(word: Word): string {
  return chapterKey(word.bookId, word.chapter);
}
