/**
 * Computes the verse range for each section break.
 *
 * A section break at (chapter, verse, level) extends until the next break
 * where nextLevel <= level (same or higher priority). If none found, it
 * extends to the last verse of the last chapter in the provided maxVerses map.
 *
 * Psalms exception: when book === "Ps", ranges are capped at the chapter
 * boundary (i.e., each psalm is its own section). The exception to the
 * exception is when a break has extendedThrough set to a later chapter —
 * in that case the range extends through that psalm (grouping, e.g. Ps 9+10).
 * Even with extendedThrough, the standard algorithm end is respected if it
 * falls earlier than the extended chapter boundary.
 *
 * @param breaks  All section breaks sorted by (chapter, verse, level asc)
 * @param maxVerses  Map of chapter → maximum verse number in that chapter
 * @param book  OSIS book code (used for Psalms special-casing)
 * @returns  Map keyed by `${wordId}:${level}` → { endChapter, endVerse }
 */
export function computeSectionRanges(
  breaks: Array<{ wordId: string; level: number; chapter: number; verse: number; extendedThrough?: number | null }>,
  maxVerses: Map<number, number>,
  book: string = ""
): Map<string, { endChapter: number; endVerse: number }> {
  const result = new Map<string, { endChapter: number; endVerse: number }>();

  // Sort by (chapter, verse, level) — should already be sorted but be safe
  const sorted = [...breaks].sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    if (a.verse !== b.verse) return a.verse - b.verse;
    return a.level - b.level;
  });

  // Find the last chapter/verse in maxVerses
  let lastChapter = 0;
  let lastVerse = 0;
  for (const [ch, mv] of maxVerses) {
    if (ch > lastChapter) {
      lastChapter = ch;
      lastVerse = mv;
    }
  }

  const isPs = book === "Ps";

  for (let i = 0; i < sorted.length; i++) {
    const sb = sorted[i];
    const key = `${sb.wordId}:${sb.level}`;

    // Find the next break at the same or higher level (lower level number = higher priority)
    let endChapter = lastChapter;
    let endVerse = lastVerse;

    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next.level <= sb.level) {
        // This break closes our range — end is one verse before next
        const prevVerse = next.verse - 1;
        if (prevVerse < 1) {
          // Need to go to previous chapter
          const prevChapter = next.chapter - 1;
          const prevChapterMax = maxVerses.get(prevChapter) ?? 0;
          endChapter = prevChapter;
          endVerse = prevChapterMax;
        } else {
          endChapter = next.chapter;
          endVerse = prevVerse;
        }
        break;
      }
    }

    // Psalms exception: cap at chapter boundary unless extendedThrough overrides
    if (isPs) {
      const through = sb.extendedThrough != null && sb.extendedThrough > sb.chapter
        ? sb.extendedThrough
        : sb.chapter;
      const psalmCapVerse = maxVerses.get(through) ?? 0;

      // Only apply the Psalms cap if it's tighter than the standard end
      if (through < endChapter || (through === endChapter && psalmCapVerse < endVerse)) {
        endChapter = through;
        endVerse = psalmCapVerse;
      }
    }

    result.set(key, { endChapter, endVerse });
  }

  return result;
}

/** OSIS codes for books that contain exactly one chapter. */
const SINGLE_CHAPTER_BOOKS = new Set(["Obad", "Phlm", "2John", "3John", "Jude"]);

/**
 * Formats a verse range for display next to a section heading.
 *
 * Multi-chapter books always include the chapter number so that ranges like
 * "(4:1–24)" are unambiguous even when a section spans an entire chapter.
 * Single-chapter books (Obad, Phlm, 2John, 3John, Jude) omit the chapter.
 *
 * Same chapter (multi-ch):  "(4:1–24)"  or "(4:5)"
 * Same chapter (single-ch): "(1–24)"    or "(5)"
 * Cross chapter:            "(4:1 – 5:3)"
 */
export function formatVerseRange(
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number,
  book: string = ""
): string {
  const showCh = !SINGLE_CHAPTER_BOOKS.has(book);
  if (startChapter === endChapter) {
    if (startVerse === endVerse) {
      return showCh ? `(${startChapter}:${startVerse})` : `(${startVerse})`;
    }
    return showCh
      ? `(${startChapter}:${startVerse}–${endVerse})`
      : `(${startVerse}–${endVerse})`;
  }
  return `(${startChapter}:${startVerse} – ${endChapter}:${endVerse})`;
}
