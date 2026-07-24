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

/** The subset of a Passage row's fields needed to test verse membership —
 *  chapterFallsInPassage's fields plus the start/end verse boundaries. */
export interface PassageVerseRange extends PassageRange {
  startVerse: number;
  endVerse: number;
}

/**
 * Does this (book, chapter, verse) fall within the passage's span? Like
 * chapterFallsInPassage, but precise at the passage's boundary chapters —
 * e.g. for "Gen 1:1–2:3", chapter 2 only counts through verse 3, not the
 * whole chapter. Chapters strictly between the start and end chapter are
 * fully included, same as chapterFallsInPassage.
 */
export function wordFallsInPassageRange(
  passage: PassageVerseRange,
  book: string,
  chapter: number,
  verse: number
): boolean {
  if (!chapterFallsInPassage(passage, book, chapter)) return false;
  if (book === passage.book && chapter === passage.startChapter && verse < passage.startVerse) return false;
  const isEndChapter = passage.endBook
    ? book === passage.endBook && chapter === passage.endChapter
    : book === passage.book && chapter === passage.endChapter;
  if (isEndChapter && verse > passage.endVerse) return false;
  return true;
}
