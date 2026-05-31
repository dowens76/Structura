import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  getChapterWords, getChapterWordsRange, getBook, getBooksBySource, getBooksWithWords,
  getMaxChapterForSource, getTranslations,
  getTranslationVerses, getChapterParagraphBreaks, getCharacters,
  getChapterCharacterRefs, getChapterSpeechSections, getWordTags,
  getChapterWordTagRefs, getChapterLineIndents, getChapterRstRelations,
  getChapterWordArrows, getChapterWordFormatting, getChapterSceneBreaks,
  getChapterLineAnnotations, getBookSceneBreaks, getBookChapterMaxVerses,
  getUltVerses, getUltTranslation, getVcbVerses, getVcbTranslation, getGroupedBooksFor,
  getChapterTranslationFootnotes,
  getWorkspaceById,
  getLxxVerseTexts, getLxxVerseWords, getLxxTranslation,
  getChapterTextCriticalMarks,
} from "@/lib/db/queries";
import type { TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import ParallelChapterView from "@/components/text/ParallelChapterView";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ChapterDropdown from "@/components/navigation/ChapterDropdown";
import BookDropdown from "@/components/navigation/BookDropdown";
import NavLinks from "@/components/navigation/NavLinks";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { OSIS_BOOK_NAMES, OSIS_REF_BOOK_NAMES, OSHB_LXX_PARALLEL_BOOKS, CONTIGUOUS_BOOK_PAIRS, CONTIGUOUS_BOOK_PREV, canonicalPairBook } from "@/lib/utils/osis";
import {
  getParallelGroup,
  canonicalizeMtChapter,
  nextParallelMtChapter,
  prevParallelMtChapter,
  hasVersificationDifference,
} from "@/lib/versification";
import { getActiveWorkspaceId } from "@/lib/workspace";

const LXX_SOURCE = "STEPBIBLE_LXX" as TextSource;

interface PageProps {
  params: Promise<{ book: string; source: string; chapter: string }>;
  searchParams: Promise<{ par?: string; [key: string]: string | string[] | undefined }>;
}

export default async function ChapterPage({ params, searchParams }: PageProps) {
  const { book, source, chapter: chapterStr } = await params;
  const { par, present, toolbar } = await searchParams;
  const chapter = parseInt(chapterStr, 10);
  const initialPresentationMode = present !== undefined;
  const hideToolbar = toolbar === "0";

  if (isNaN(chapter) || chapter < 1) notFound();

  const osisBook = decodeURIComponent(book);
  const textSource = source as TextSource;

  const workspaceId = await getActiveWorkspaceId();
  const workspace = await getWorkspaceById(workspaceId).catch(() => null);
  const translationOnly = workspace?.translationOnly ?? false;

  // Parallel mode: show OSHB + LXX side by side.
  // Triggered by ?par=1 when viewing an OSHB book that has LXX data.
  const isLXX = textSource === LXX_SOURCE;
  const canParallel = textSource === "OSHB" && OSHB_LXX_PARALLEL_BOOKS.has(osisBook);
  const lxxHasOshb = isLXX && OSHB_LXX_PARALLEL_BOOKS.has(osisBook);
  const parallelMode = !!par && canParallel;

  // Versification: in parallel mode, redirect non-canonical MT chapters to their
  // canonical entry (e.g. /Ps/OSHB/10?par=1 → /Ps/OSHB/9?par=1 since Ps 10
  // is displayed together with Ps 9 as the LXX Ps 9 equivalent).
  if (parallelMode && hasVersificationDifference(osisBook)) {
    const canonical = canonicalizeMtChapter(osisBook, chapter);
    if (canonical !== chapter) {
      redirect(`/${encodeURIComponent(osisBook)}/OSHB/${canonical}?par=1`);
    }
  }

  // Determine which MT and LXX chapters to fetch for the parallel display.
  const parallelGroup = parallelMode
    ? (getParallelGroup(osisBook, chapter) ?? { mtChapters: [chapter], lxxChapters: [chapter] })
    : null;

  // For the book dropdown: LXX standalone needs all books that have LXX words.
  const sourceBooksPromise = isLXX
    ? getBooksWithWords(LXX_SOURCE)
    : getBooksBySource(source);

  type WordsArr = Awaited<ReturnType<typeof getChapterWords>>;
  type BookRec = Awaited<ReturnType<typeof getBook>>;
  type BooksArr = Awaited<ReturnType<typeof getBooksBySource>>;

  let words: WordsArr = [];
  let bookRecord: BookRec = undefined;
  let sourceBooks: BooksArr = [];
  let lxxWords: WordsArr = [];

  try {
    if (parallelMode && parallelGroup) {
      [words, bookRecord, sourceBooks, lxxWords] = await Promise.all([
        getChapterWordsRange(osisBook, parallelGroup.mtChapters, textSource),
        getBook(osisBook),
        sourceBooksPromise,
        getChapterWordsRange(osisBook, parallelGroup.lxxChapters, LXX_SOURCE),
      ]);
    } else {
      [words, bookRecord, sourceBooks] = await Promise.all([
        getChapterWords(osisBook, chapter, textSource),
        getBook(osisBook),
        sourceBooksPromise,
      ]);
    }
  } catch {
    notFound();
  }

  if (!words || words.length === 0) notFound();

  // For LXX standalone, override chapter count using the actual max chapter in words.
  const chapterCount = isLXX
    ? await getMaxChapterForSource(osisBook, LXX_SOURCE)
    : (bookRecord?.chapterCount ?? 1);

  // Skip all annotation fetching in parallel mode (read-only clean view).
  let availableTranslations: Awaited<ReturnType<typeof getTranslations>> = [];
  let initialParagraphBreakIds: string[] = [];
  let initialCharacters: Awaited<ReturnType<typeof getCharacters>> = [];
  let initialCharacterRefs: Awaited<ReturnType<typeof getChapterCharacterRefs>> = [];
  let initialSpeechSections: Awaited<ReturnType<typeof getChapterSpeechSections>> = [];
  let initialWordTags: Awaited<ReturnType<typeof getWordTags>> = [];
  let initialWordTagRefs: Awaited<ReturnType<typeof getChapterWordTagRefs>> = [];
  let initialLineIndents: { wordId: string; indentLevel: number }[] = [];
  let initialRstRelations:   Awaited<ReturnType<typeof getChapterRstRelations>> = [];
  let initialTvRstRelations: Awaited<ReturnType<typeof getChapterRstRelations>> = [];
  let initialWordArrows: Awaited<ReturnType<typeof getChapterWordArrows>> = [];
  let initialWordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[] = [];
  let initialSceneBreaks: Awaited<ReturnType<typeof getChapterSceneBreaks>> = [];
  let initialLineAnnotations: Awaited<ReturnType<typeof getChapterLineAnnotations>> = [];
  let bookSceneBreaks: Awaited<ReturnType<typeof getBookSceneBreaks>> = [];
  let bookMaxVerses: Awaited<ReturnType<typeof getBookChapterMaxVerses>> = new Map();
  let translationVerseData: Record<number, TranslationVerse[]> = {};
  let initialTranslationFootnotes: Record<number, TranslationFootnote[]> = {};
  let ultBaseVerses: { verse: number; text: string }[] = [];
  let ultTranslation: Awaited<ReturnType<typeof getUltTranslation>> = null;
  let vcbBaseVerses: { verse: number; text: string }[] = [];
  let vcbTranslation: Awaited<ReturnType<typeof getVcbTranslation>> = null;
  let lxxBaseVerses: { verse: number; text: string }[] = [];
  let lxxVerseWords: Map<number, import("@/lib/db/source-schema").Word[]> = new Map();
  let lxxTranslation: Awaited<ReturnType<typeof getLxxTranslation>> = null;
  let initialTextCriticalMarks: { wordId: string; markType: string; textSource: string }[] = [];

  // Build the full set of books that share a character/word-tag pool with this
  // book.  Includes: the hardcoded contiguous sibling (1Sam↔2Sam etc.) PLUS
  // every book that shares a user-defined Book Grouping with this book.
  const _siblingBook    = (CONTIGUOUS_BOOK_PAIRS[osisBook] ?? CONTIGUOUS_BOOK_PREV[osisBook]) ?? null;
  const _groupedBooks   = await getGroupedBooksFor(osisBook, workspaceId);
  const _allPairSet     = new Set([osisBook, ...(_siblingBook ? [_siblingBook] : []), ..._groupedBooks]);
  const pairBooks: string | string[] = _allPairSet.size === 1 ? osisBook : [..._allPairSet];

  if (!parallelMode) {
    [availableTranslations, initialParagraphBreakIds, initialCharacters,
     initialCharacterRefs, initialSpeechSections,
     initialWordTags, initialWordTagRefs, initialLineIndents,
     initialRstRelations, initialTvRstRelations, initialWordArrows, initialWordFormatting,
     initialSceneBreaks, initialLineAnnotations,
     bookSceneBreaks, bookMaxVerses] = await Promise.all([
      getTranslations(workspaceId),
      getChapterParagraphBreaks(osisBook, chapter, workspaceId),
      getCharacters(pairBooks, workspaceId),
      getChapterCharacterRefs(osisBook, chapter, workspaceId),
      getChapterSpeechSections(osisBook, chapter, textSource, workspaceId),
      getWordTags(pairBooks, workspaceId),
      getChapterWordTagRefs(osisBook, chapter, workspaceId),
      getChapterLineIndents(osisBook, chapter, workspaceId),
      getChapterRstRelations(osisBook, chapter, textSource, workspaceId),
      getChapterRstRelations(osisBook, chapter, `tv:${textSource}`, workspaceId),
      getChapterWordArrows(osisBook, chapter, textSource, workspaceId),
      getChapterWordFormatting(osisBook, chapter, workspaceId),
      getChapterSceneBreaks(osisBook, chapter, workspaceId),
      getChapterLineAnnotations(osisBook, chapter, textSource, workspaceId),
      getBookSceneBreaks(osisBook, textSource, workspaceId),
      getBookChapterMaxVerses(osisBook, textSource),
    ]);
    await Promise.all(
      availableTranslations.map(async (t) => {
        translationVerseData[t.id] = await getTranslationVerses(t.id, osisBook, chapter, workspaceId);
      })
    );

    // Footnotes for user-created translations
    await Promise.all(
      availableTranslations.map(async (t) => {
        initialTranslationFootnotes[t.id] = await getChapterTranslationFootnotes(t.id, osisBook, chapter);
      })
    );

    // ULT: synchronous base text + async user overrides
    ultBaseVerses = getUltVerses(osisBook, chapter);
    if (ultBaseVerses.length > 0) {
      ultTranslation = await getUltTranslation(workspaceId);
      if (ultTranslation !== null) {
        // Fetch any user edits stored in translation_verses for this chapter
        translationVerseData[ultTranslation.id] = await getTranslationVerses(
          ultTranslation.id, osisBook, chapter, workspaceId
        );
        // Footnotes for ULT (user may have added them via the footnote dialog)
        initialTranslationFootnotes[ultTranslation.id] = await getChapterTranslationFootnotes(
          ultTranslation.id, osisBook, chapter
        );
      }
    }

    // VCB: synchronous base text + async user overrides
    vcbBaseVerses = getVcbVerses(osisBook, chapter);
    if (vcbBaseVerses.length > 0) {
      vcbTranslation = await getVcbTranslation(workspaceId);
      if (vcbTranslation !== null) {
        translationVerseData[vcbTranslation.id] = await getTranslationVerses(
          vcbTranslation.id, osisBook, chapter, workspaceId
        );
        // Footnotes for VCB
        initialTranslationFootnotes[vcbTranslation.id] = await getChapterTranslationFootnotes(
          vcbTranslation.id, osisBook, chapter
        );
      }
    }

    // LXX as translation column (OSHB OT chapters only)
    if (textSource === "OSHB") {
      lxxBaseVerses = getLxxVerseTexts(osisBook, chapter);
      if (lxxBaseVerses.length > 0) {
        [lxxVerseWords, lxxTranslation] = await Promise.all([
          getLxxVerseWords(osisBook, chapter),
          getLxxTranslation(),
        ]);
      }
    }

    // Text critical marks (both OSHB and LXX word marks for this chapter)
    initialTextCriticalMarks = getChapterTextCriticalMarks(osisBook, chapter, workspaceId);
  }

  const bookName = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;

  // ── Cross-book chapter navigation ────────────────────────────────────────
  // At the last chapter of a first book (e.g. 1 Sam 31), "next" → 2 Sam 1.
  // At chapter 1 of a second book (e.g. 2 Sam 1),        "prev" → 1 Sam 31.
  const contNextBook = CONTIGUOUS_BOOK_PAIRS[osisBook] ?? null;
  const contPrevBook = CONTIGUOUS_BOOK_PREV[osisBook]  ?? null;
  // We only need the prev book's chapter count when we're actually at chapter 1.
  const contPrevBookLastChapter = (contPrevBook && chapter === 1)
    ? await getMaxChapterForSource(contPrevBook, textSource)
    : null;

  // Source-switch link: when on LXX, offer a link to the OSHB version (if it exists).
  // When on OSHB with an LXX parallel available, offer the LXX standalone.
  const oshbHref  = `/${encodeURIComponent(osisBook)}/OSHB/${chapter}`;
  const lxxHref   = `/${encodeURIComponent(osisBook)}/${LXX_SOURCE}/${chapter}`;
  const parallelHref = `/${encodeURIComponent(osisBook)}/OSHB/${chapter}?par=1`;

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Nav bar — hidden when ?toolbar=0 (clean iframe embed) */}
      {!hideToolbar && <nav
        className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
        style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
      >
        {/* Logo */}
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

        {/* Source badge */}
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "rgba(200,155,60,0.18)", color: "var(--accent)" }}
        >
          {parallelMode ? "OSHB ‖ LXX" : textSource}
        </span>

        {/* Translatable nav links, source-switch links, and chapter navigation */}
        <NavLinks
          osisBook={osisBook}
          textSource={textSource}
          chapter={chapter}
          chapterCount={chapterCount}
          isLXX={isLXX}
          canParallel={canParallel}
          lxxHasOshb={lxxHasOshb}
          parallelMode={parallelMode}
          oshbHref={oshbHref}
          lxxHref={lxxHref}
          parallelHref={parallelHref}
          exportHref={`/export/${encodeURIComponent(osisBook)}/${textSource}/${chapter}`}
          contNextBook={contNextBook}
          contPrevBook={contPrevBook}
          contPrevBookLastChapter={contPrevBookLastChapter}
          parallelPrevChapter={
            parallelMode && hasVersificationDifference(osisBook)
              ? prevParallelMtChapter(osisBook, chapter)
              : undefined
          }
          parallelNextChapter={
            parallelMode && hasVersificationDifference(osisBook)
              ? nextParallelMtChapter(osisBook, chapter)
              : undefined
          }
        />

        {/* Book selector dropdown */}
        <BookDropdown
          books={sourceBooks ?? []}
          currentOsisBook={osisBook}
          textSource={textSource}
        />

        {/* Chapter selector dropdown */}
        <ChapterDropdown
          chapter={chapter}
          chapterCount={chapterCount}
          osisBook={osisBook}
          textSource={textSource}
        />

        {/* Passages (non-parallel only) */}
        {!parallelMode && (
          <PassageNavButtons
            book={osisBook}
            textSource={textSource}
            bookName={bookName}
            currentChapter={chapter}
            chapterCount={chapterCount}
          />
        )}

        {/* Workspace switcher */}
        <WorkspaceSwitcher activeWorkspaceId={workspaceId} />

        {/* Settings */}
        <SettingsButton />

        {/* Theme toggle */}
        <ThemeToggle />
      </nav>}

      {/* Text content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {parallelMode ? (
          <>
            {/* Chapter heading — always visible in parallel mode (no presentation toggle) */}
            <div
              className="shrink-0 px-6 pt-4 pb-2 border-b"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              <h1
                className="text-xl font-bold tracking-tight"
                style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
              >
                {bookName}{" "}
                <span style={{ color: "var(--accent)" }}>
                  {parallelGroup && parallelGroup.mtChapters.length > 1
                    ? `${parallelGroup.mtChapters[0]}–${parallelGroup.mtChapters[parallelGroup.mtChapters.length - 1]}`
                    : chapter}
                </span>
                <span className="text-sm font-normal ml-3" style={{ color: "var(--text-muted)" }}>
                  Hebrew ‖ Septuagint
                </span>
              </h1>
              <p className="text-xs mt-0.5">
                {`${words.length.toLocaleString()} Hebrew + ${lxxWords.length.toLocaleString()} Greek words`}
              </p>
            </div>
            <div className="flex-1 min-h-0">
              <ParallelChapterView
                osisBook={osisBook}
                oshbChapters={parallelGroup?.mtChapters ?? [chapter]}
                lxxChapters={parallelGroup?.lxxChapters ?? [chapter]}
                oshbWords={words}
                lxxWords={lxxWords}
              />
            </div>
          </>
        ) : (
          <ChapterDisplay
            key={workspaceId}
            words={words}
            book={osisBook}
            chapter={chapter}
            textSource={textSource}
            availableTranslations={availableTranslations}
            translationVerseData={translationVerseData}
            ultBaseVerses={ultBaseVerses}
            ultTranslation={ultTranslation}
            vcbBaseVerses={vcbBaseVerses}
            vcbTranslation={vcbTranslation}
            lxxBaseVerses={lxxBaseVerses}
            lxxVerseWords={lxxVerseWords}
            lxxTranslation={lxxTranslation}
            initialTextCriticalMarks={initialTextCriticalMarks}
            initialParagraphBreakIds={initialParagraphBreakIds}
            initialCharacters={initialCharacters}
            initialCharacterRefs={initialCharacterRefs}
            initialSpeechSections={initialSpeechSections}
            initialWordTags={initialWordTags}
            initialWordTagRefs={initialWordTagRefs}
            initialLineIndents={initialLineIndents}
            initialRstRelations={initialRstRelations}
            initialTvRstRelations={initialTvRstRelations}
            initialWordArrows={initialWordArrows}
            initialWordFormatting={initialWordFormatting}
            initialSceneBreaks={initialSceneBreaks}
            initialLineAnnotations={initialLineAnnotations}
            bookSceneBreaks={bookSceneBreaks}
            bookMaxVerses={bookMaxVerses}
            initialTranslationFootnotes={initialTranslationFootnotes}
            translationOnly={translationOnly}
            sortedBooks={sourceBooks.map((b) => b.osisCode)}
            initialPresentationMode={initialPresentationMode}
            hideToolbar={hideToolbar}
            headingSlot={
              <div
                key="chapter-heading"
                className="shrink-0 px-6 pt-4 pb-2 border-b"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                <h1
                  className="text-xl font-bold tracking-tight"
                  style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
                >
                  {bookName} <span style={{ color: "var(--accent)" }}>{chapter}</span>
                </h1>
                <p className="text-xs mt-0.5">
                  {`${words.length.toLocaleString()} words`}
                </p>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params;
  const osisBook = decodeURIComponent(book);
  const bookName = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  return {
    title: `${bookName} ${chapter} — Structura`,
  };
}
