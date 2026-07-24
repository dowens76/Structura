/**
 * Shared data-fetching helpers for a "scripture locus" — one or more
 * (book, chapter) pairs to load editing/translation data for. A plain chapter
 * page always calls these with a single-entry array; the passage page calls
 * them with every chapter the passage covers (possibly across two books).
 * Keeping this logic in one place means a change to any of these features
 * only needs to happen here, not once per route.
 */
import {
  getChapterParagraphBreaks,
  getChapterCharacterRefs,
  getChapterSpeechSections,
  getChapterWordTagRefs,
  getChapterLineIndents,
  getChapterRstRelations,
  getChapterWordArrows,
  getChapterWordFormatting,
  getChapterSceneBreaks,
  getChapterLineAnnotations,
  getChapterTextCriticalMarks,
  getChapterTranslationFootnotes,
  getTranslationVerses,
  getBookSceneBreaks,
  getBookChapterMaxVerses,
} from "@/lib/db/queries";
import type { Translation, TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";

export interface ChapterLocus {
  book: string;
  chapter: number;
}

/**
 * Per-chapter editing data (paragraph breaks, character refs, speech
 * sections, word-tag refs, line indents, RST relations, word arrows, word
 * formatting, scene breaks, line annotations, text-critical marks),
 * flattened across every locus.
 */
export async function getScriptureLocusEditingData(
  loci: ChapterLocus[],
  textSource: TextSource,
  workspaceId: number
) {
  const perChapterResults = await Promise.all(
    loci.map(({ book, chapter }) =>
      Promise.all([
        getChapterParagraphBreaks(book, chapter, workspaceId),
        getChapterCharacterRefs(book, chapter, workspaceId),
        getChapterSpeechSections(book, chapter, textSource, workspaceId),
        getChapterWordTagRefs(book, chapter, workspaceId),
        getChapterLineIndents(book, chapter, workspaceId),
        getChapterRstRelations(book, chapter, textSource, workspaceId),
        getChapterWordArrows(book, chapter, textSource, workspaceId),
        getChapterWordFormatting(book, chapter, workspaceId),
        getChapterSceneBreaks(book, chapter, workspaceId),
        getChapterLineAnnotations(book, chapter, textSource, workspaceId),
      ])
    )
  );
  const initialTextCriticalMarks = loci.flatMap(({ book, chapter }) =>
    getChapterTextCriticalMarks(book, chapter, workspaceId)
  );
  return {
    initialParagraphBreakIds: perChapterResults.flatMap(([p]) => p),
    initialCharacterRefs:     perChapterResults.flatMap(([, r]) => r),
    initialSpeechSections:    perChapterResults.flatMap(([,, s]) => s),
    initialWordTagRefs:       perChapterResults.flatMap(([,,, t]) => t),
    initialLineIndents:       perChapterResults.flatMap(([,,,, l]) => l),
    initialRstRelations:      perChapterResults.flatMap(([,,,,, cr]) => cr),
    initialWordArrows:        perChapterResults.flatMap(([,,,,,, wa]) => wa),
    initialWordFormatting:    perChapterResults.flatMap(([,,,,,,, wf]) => wf),
    initialSceneBreaks:       perChapterResults.flatMap(([,,,,,,,, sb]) => sb),
    initialLineAnnotations:   perChapterResults.flatMap(([,,,,,,,,, la]) => la),
    initialTextCriticalMarks,
  };
}

/** User-imported translations' verse text, flattened across every locus, keyed by translation id. */
export async function getScriptureLocusUserTranslationVerses(
  loci: ChapterLocus[],
  translations: Translation[]
): Promise<Record<number, TranslationVerse[]>> {
  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    translations.map(async (t) => {
      const perLocus = await Promise.all(loci.map(({ book, chapter }) => getTranslationVerses(t.id, book, chapter)));
      translationVerseData[t.id] = perLocus.flat();
    })
  );
  return translationVerseData;
}

/** Footnotes for a set of translations, flattened across every locus, keyed by translation id. */
export async function getScriptureLocusFootnotes(
  loci: ChapterLocus[],
  translations: Translation[]
): Promise<Record<number, TranslationFootnote[]>> {
  const initialTranslationFootnotes: Record<number, TranslationFootnote[]> = {};
  await Promise.all(
    translations.map(async (t) => {
      const perLocus = await Promise.all(loci.map(({ book, chapter }) => getChapterTranslationFootnotes(t.id, book, chapter)));
      initialTranslationFootnotes[t.id] = perLocus.flat();
    })
  );
  return initialTranslationFootnotes;
}

/**
 * Base verse text + Translation record for a built-in translation (ULT/VCB/LXX),
 * merged across every locus and tagged with each entry's own chapter (needed
 * so ChapterDisplay can key it correctly once a passage spans more than one
 * chapter). Returns `translation: null` (and skips the record lookup) when no
 * base text exists for any locus.
 */
export async function getScriptureLocusBuiltInTranslation(
  loci: ChapterLocus[],
  getBaseVerses: (book: string, chapter: number) => { verse: number; text: string }[],
  getTranslationRecord: () => Promise<Translation | null>
): Promise<{ baseVerses: { chapter: number; verse: number; text: string }[]; translation: Translation | null }> {
  const baseVerses: { chapter: number; verse: number; text: string }[] = [];
  for (const { book, chapter } of loci) {
    for (const v of getBaseVerses(book, chapter)) baseVerses.push({ ...v, chapter });
  }
  if (baseVerses.length === 0) return { baseVerses, translation: null };
  const translation = await getTranslationRecord();
  return { baseVerses, translation };
}

/**
 * Book-wide scene breaks (tagged with each entry's owning bookId) + a
 * chapter→maxVerse map, merged across one or two books. For a second book,
 * chapters are offset by the preceding book's chapter count onto one
 * monotonic sequence — the scheme ChapterDisplay's cross-book sectionRanges
 * computation expects (see lib/utils/chapterKey.ts).
 */
export async function getScriptureLocusBookWideData(
  books: { osisBook: string; bookId: number; chapterCount: number }[],
  textSource: TextSource,
  workspaceId: number
) {
  const perBook = await Promise.all(
    books.map(({ osisBook }) => Promise.all([
      getBookSceneBreaks(osisBook, textSource, workspaceId),
      getBookChapterMaxVerses(osisBook, textSource),
    ]))
  );

  const bookSceneBreaks = books.flatMap(({ bookId }, i) =>
    perBook[i][0].map((b) => ({ ...b, bookId }))
  );

  const bookMaxVerses = new Map<number, number>();
  let offset = 0;
  books.forEach(({ chapterCount }, i) => {
    for (const [ch, mv] of perBook[i][1]) bookMaxVerses.set(ch + offset, mv);
    offset += chapterCount;
  });

  return { bookSceneBreaks, bookMaxVerses };
}
