/** The subset of a Passage row's fields needed to test chapter membership —
 *  kept minimal (and DB-import-free) so this can be used client-side too. */
export interface PassageRange {
  book: string;
  startChapter: number;
  endBook?: string | null;
  endChapter: number;
}

/** Does this (book, chapter) fall within the passage's span? */
export function chapterFallsInPassage(passage: PassageRange, book: string, chapter: number): boolean {
  if (book === passage.book) {
    if (chapter < passage.startChapter) return false;
    // If the passage continues into another book, there's no upper bound
    // on the chapter within this (starting) book.
    if (!passage.endBook && chapter > passage.endChapter) return false;
    return true;
  }
  if (passage.endBook && book === passage.endBook && chapter <= passage.endChapter) return true;
  return false;
}
