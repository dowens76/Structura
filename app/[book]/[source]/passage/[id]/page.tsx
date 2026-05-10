import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  getPassage,
  getPassageWords,
  getBook,
  getChapterMaxVerse,
  getCharacters,
  getWordTags,
  getChapterParagraphBreaks,
  getChapterCharacterRefs,
  getChapterSpeechSections,
  getChapterWordTagRefs,
  getChapterLineIndents,
  getAvailableTranslationsForChapter,
  getTranslationVerses,
  getUltVerses,
  getUltTranslation,
  getChapterRstRelations,
  getChapterWordArrows,
  getChapterWordFormatting,
  getChapterSceneBreaks,
  getChapterLineAnnotations,
  getBookSceneBreaks,
  getBookChapterMaxVerses,
  getGroupedBooksFor,
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { OSIS_BOOK_NAMES, CONTIGUOUS_BOOK_PAIRS, CONTIGUOUS_BOOK_PREV } from "@/lib/utils/osis";
import type { TextSource } from "@/lib/morphology/types";
import type { TranslationVerse } from "@/lib/db/schema";
import PassageView from "@/components/passage/PassageView";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";

interface PageProps {
  params: Promise<{ book: string; source: string; id: string }>;
}

export default async function PassagePage({ params }: PageProps) {
  const { book: bookParam, source, id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (isNaN(id)) notFound();

  const osisBook    = decodeURIComponent(bookParam);
  const textSource  = source as TextSource;
  const workspaceId = await getActiveWorkspaceId();

  const [passage, bookRecord] = await Promise.all([
    getPassage(id),
    getBook(osisBook),
  ]);

  if (!passage || !bookRecord) notFound();
  if (passage.book !== osisBook || passage.textSource !== textSource) notFound();

  // ── Determine end book ─────────────────────────────────────────────────────
  const endOsisBook = passage.endBook ?? osisBook;
  const isCrossBook = endOsisBook !== osisBook;

  const endBookRecord = isCrossBook ? await getBook(endOsisBook) : bookRecord;
  if (!endBookRecord) notFound();

  // ── Build chapter entry list (book + chapter) ──────────────────────────────
  // For a single-book passage: chapters startChapter..endChapter in osisBook.
  // For a cross-book passage: chapters startChapter..endOfStartBook in osisBook,
  //   then chapters 1..endChapter in endOsisBook.
  type ChapterEntry = { book: string; chapter: number };
  const chapterEntries: ChapterEntry[] = [];

  if (!isCrossBook) {
    for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) {
      chapterEntries.push({ book: osisBook, chapter: ch });
    }
  } else {
    const startBookLastCh = bookRecord.chapterCount;
    for (let ch = passage.startChapter; ch <= startBookLastCh; ch++) {
      chapterEntries.push({ book: osisBook, chapter: ch });
    }
    for (let ch = 1; ch <= passage.endChapter; ch++) {
      chapterEntries.push({ book: endOsisBook, chapter: ch });
    }
  }

  // ── Books to query for characters / word-tags ─────────────────────────────
  // Union: hardcoded contiguous-pair canonical books + user-defined grouping
  // members for each book involved in this passage.
  const [groupedBooksStart, groupedBooksEnd] = await Promise.all([
    getGroupedBooksFor(osisBook, workspaceId),
    isCrossBook ? getGroupedBooksFor(endOsisBook, workspaceId) : Promise.resolve([] as string[]),
  ]);

  const _siblingStart = (CONTIGUOUS_BOOK_PAIRS[osisBook]    ?? CONTIGUOUS_BOOK_PREV[osisBook])    ?? null;
  const _siblingEnd   = isCrossBook
    ? ((CONTIGUOUS_BOOK_PAIRS[endOsisBook] ?? CONTIGUOUS_BOOK_PREV[endOsisBook]) ?? null)
    : null;

  const charTagSet = new Set<string>([
    osisBook,
    ...(_siblingStart ? [_siblingStart] : []),
    ...groupedBooksStart,
    ...(isCrossBook ? [endOsisBook] : []),
    ...(_siblingEnd ? [_siblingEnd] : []),
    ...groupedBooksEnd,
  ]);
  const charTagBooks: string | string[] = charTagSet.size === 1 ? osisBook : [...charTagSet];

  // ── Pre-fetch words and supporting data ────────────────────────────────────
  const [
    passageWords,
    maxVerseOfStartChapter,
    maxVerseOfEndChapter,
    maxVerseOfPrevStartChapter,
    maxVerseOfPrevEndChapter,
    characters,
    wordTags,
    bookSceneBreaks,
    endBookSceneBreaks,
    bookMaxVerses,
    endBookMaxVerses,
    perChapterResults,
  ] = await Promise.all([
    getPassageWords(
      osisBook, textSource,
      passage.startChapter, passage.startVerse,
      passage.endChapter,   passage.endVerse,
      passage.endBook
    ),
    getChapterMaxVerse(osisBook, passage.startChapter, textSource),
    getChapterMaxVerse(endOsisBook, passage.endChapter, textSource),
    passage.startChapter > 1
      ? getChapterMaxVerse(osisBook, passage.startChapter - 1, textSource)
      : Promise.resolve(0),
    passage.endChapter > 1
      ? getChapterMaxVerse(endOsisBook, passage.endChapter - 1, textSource)
      : Promise.resolve(0),
    // Characters / word-tags: fetch from all grouped+paired books so they
    // share the same pool (e.g. 1Sam+2Sam, or user-defined Pentateuch group).
    getCharacters(charTagBooks, workspaceId),
    getWordTags(charTagBooks, workspaceId),
    getBookSceneBreaks(osisBook, textSource, workspaceId),
    isCrossBook ? getBookSceneBreaks(endOsisBook, textSource, workspaceId) : Promise.resolve([]),
    getBookChapterMaxVerses(osisBook, textSource),
    isCrossBook ? getBookChapterMaxVerses(endOsisBook, textSource) : Promise.resolve(new Map<number, number>()),
    // Per-chapter editing data — use the correct book for each entry
    Promise.all(
      chapterEntries.map(({ book: entryBook, chapter: ch }) =>
        Promise.all([
          getChapterParagraphBreaks(entryBook, ch, workspaceId),
          getChapterCharacterRefs(entryBook, ch, workspaceId),
          getChapterSpeechSections(entryBook, ch, textSource, workspaceId),
          getChapterWordTagRefs(entryBook, ch, workspaceId),
          getChapterLineIndents(entryBook, ch, workspaceId),
          getChapterRstRelations(entryBook, ch, textSource, workspaceId),
          getChapterWordArrows(entryBook, ch, textSource, workspaceId),
          getChapterWordFormatting(entryBook, ch, workspaceId),
          getChapterSceneBreaks(entryBook, ch, workspaceId),
          getChapterLineAnnotations(entryBook, ch, textSource, workspaceId),
        ])
      )
    ),
  ]);

  // (characters and wordTags already cover all canonical books via charTagBooks)

  // Flatten per-chapter editing data
  const initialParagraphBreakIds = perChapterResults.flatMap(([p]) => p);
  const initialCharacterRefs     = perChapterResults.flatMap(([, r]) => r);
  const initialSpeechSections    = perChapterResults.flatMap(([,, s]) => s);
  const initialWordTagRefs       = perChapterResults.flatMap(([,,, t]) => t);
  const initialLineIndents       = perChapterResults.flatMap(([,,,, l]) => l);
  const initialRstRelations      = perChapterResults.flatMap(([,,,,, cr]) => cr);
  const initialWordArrows        = perChapterResults.flatMap(([,,,,,, wa]) => wa);
  const initialWordFormatting    = perChapterResults.flatMap(([,,,,,,, wf]) => wf);
  const initialSceneBreaks       = perChapterResults.flatMap(([,,,,,,,, sb]) => sb);
  const initialLineAnnotations   = perChapterResults.flatMap(([,,,,,,,,, la]) => la);

  // Merge cross-book scene breaks and max verses
  const allBookSceneBreaks = [...bookSceneBreaks, ...endBookSceneBreaks];
  // For bookMaxVerses, for cross-book we merge start-book and end-book maps.
  // End-book chapters are offset by startBookLastCh so they sort after.
  const mergedBookMaxVerses = new Map<number, number>(bookMaxVerses);
  if (isCrossBook) {
    const startBookLastCh = bookRecord.chapterCount;
    for (const [ch, mv] of endBookMaxVerses) {
      mergedBookMaxVerses.set(ch + startBookLastCh, mv);
    }
  }

  // ── Translations ───────────────────────────────────────────────────────────
  const availableTranslations = await getAvailableTranslationsForChapter(osisBook, passage.startChapter);
  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    availableTranslations.map(async (t) => {
      const versesPerEntry = await Promise.all(
        chapterEntries.map(({ book: entryBook, chapter: ch }) =>
          getTranslationVerses(t.id, entryBook, ch)
        )
      );
      translationVerseData[t.id] = versesPerEntry.flat();
    })
  );

  // ── ULT ────────────────────────────────────────────────────────────────────
  const ultBaseVerses: { chapter: number; verse: number; text: string }[] = [];
  let ultTranslation: Awaited<ReturnType<typeof getUltTranslation>> = null;
  for (const { book: entryBook, chapter: ch } of chapterEntries) {
    const verses = getUltVerses(entryBook, ch);
    for (const v of verses) ultBaseVerses.push({ ...v, chapter: ch });
  }
  if (ultBaseVerses.length > 0) {
    ultTranslation = await getUltTranslation();
    if (ultTranslation !== null) {
      const ultEditsPerEntry = await Promise.all(
        chapterEntries.map(({ book: entryBook, chapter: ch }) =>
          getTranslationVerses(ultTranslation!.id, entryBook, ch)
        )
      );
      translationVerseData[ultTranslation.id] = ultEditsPerEntry.flat();
    }
  }

  // ── Display metadata ───────────────────────────────────────────────────────
  const bookName    = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  const endBookName = OSIS_BOOK_NAMES[endOsisBook] ?? endOsisBook;
  const isHebrew    = bookRecord.language === "hebrew";

  // Passage reference string shown in the nav bar for cross-book passages
  const crossBookRef = isCrossBook
    ? `${bookName} ${passage.startChapter}:${passage.startVerse} – ${endBookName} ${passage.endChapter}:${passage.endVerse}`
    : null;

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Nav bar */}
      <nav
        className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
        style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
      >
        <Link href="/" className="shrink-0 flex items-center" aria-label="Structura home">
          <Image
            src="/structura-icon.svg"
            alt="Structura"
            width={28}
            height={28}
            className="opacity-90"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </Link>

        <span style={{ color: "var(--nav-border)" }} className="text-lg select-none">|</span>

        <span className="text-sm font-semibold" style={{ color: "var(--nav-fg-muted)" }}>
          {crossBookRef ?? bookName}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "rgba(200,155,60,0.18)", color: "var(--accent)" }}
        >
          {textSource}
        </span>

        <Link
          href="/import"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          + Import
        </Link>

        {/* Export link */}
        <Link
          href={`/export/passage/${id}`}
          target="_blank"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          Export →
        </Link>

        <PassageNavButtons
          book={osisBook}
          textSource={textSource}
          bookName={bookName}
          currentChapter={passage.startChapter}
          chapterCount={bookRecord.chapterCount}
          currentPassageId={id}
        />

        {/* Settings + Theme + Back to chapter */}
        <div className="ml-auto flex items-center gap-1">
          <SettingsButton />
          <ThemeToggle />
          <Link
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${passage.startChapter}`}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
          >
            ← Ch. {passage.startChapter}
          </Link>
        </div>
      </nav>

      {/* Passage content */}
      <div className="flex-1 min-h-0">
        <PassageView
          key={workspaceId}
          passage={passage}
          words={passageWords}
          bookName={bookName}
          isHebrew={isHebrew}
          chapterCount={bookRecord.chapterCount}
          maxVerseOfStartChapter={maxVerseOfStartChapter}
          maxVerseOfEndChapter={maxVerseOfEndChapter}
          maxVerseOfPrevStartChapter={maxVerseOfPrevStartChapter}
          maxVerseOfPrevEndChapter={maxVerseOfPrevEndChapter}
          osisBook={osisBook}
          textSource={textSource}
          initialParagraphBreakIds={initialParagraphBreakIds}
          initialCharacters={characters}
          initialCharacterRefs={initialCharacterRefs}
          initialSpeechSections={initialSpeechSections}
          initialWordTags={wordTags}
          initialWordTagRefs={initialWordTagRefs}
          initialLineIndents={initialLineIndents}
          availableTranslations={availableTranslations}
          translationVerseData={translationVerseData}
          ultBaseVerses={ultBaseVerses}
          ultTranslation={ultTranslation}
          initialRstRelations={initialRstRelations}
          initialWordArrows={initialWordArrows}
          initialWordFormatting={initialWordFormatting}
          initialSceneBreaks={initialSceneBreaks}
          initialLineAnnotations={initialLineAnnotations}
          bookSceneBreaks={allBookSceneBreaks}
          bookMaxVerses={mergedBookMaxVerses}
        />
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, id: idStr } = await params;
  const osisBook = decodeURIComponent(book);
  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  const id = parseInt(idStr, 10);
  if (!isNaN(id)) {
    const passage = await getPassage(id);
    if (passage?.label) {
      return { title: `${passage.label} — Structura` };
    }
    if (passage) {
      const endBookName = passage.endBook
        ? (OSIS_BOOK_NAMES[passage.endBook] ?? passage.endBook)
        : bookName;
      const ref = passage.endBook && passage.endBook !== osisBook
        ? `${bookName} ${passage.startChapter}:${passage.startVerse} – ${endBookName} ${passage.endChapter}:${passage.endVerse}`
        : passage.startChapter === passage.endChapter
          ? `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endVerse}`
          : `${bookName} ${passage.startChapter}:${passage.startVerse} – ${passage.endChapter}:${passage.endVerse}`;
      return { title: `${ref} — Structura` };
    }
  }
  return { title: `${bookName} Passage — Structura` };
}
