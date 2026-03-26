import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  getChapterWords, getBook, getBooksBySource, getBooksWithWords,
  getMaxChapterForSource, getAvailableTranslationsForChapter,
  getTranslationVerses, getChapterParagraphBreaks, getCharacters,
  getChapterCharacterRefs, getChapterSpeechSections, getWordTags,
  getChapterWordTagRefs, getChapterLineIndents, getChapterRstRelations,
  getChapterWordArrows, getChapterWordFormatting, getChapterSceneBreaks,
  getChapterLineAnnotations, getBookSceneBreaks, getBookChapterMaxVerses,
} from "@/lib/db/queries";
import type { TranslationVerse } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import ParallelChapterView from "@/components/text/ParallelChapterView";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ChapterDropdown from "@/components/navigation/ChapterDropdown";
import BookDropdown from "@/components/navigation/BookDropdown";
import ThemeToggle from "@/components/ThemeToggle";
import { OSIS_BOOK_NAMES, OSHB_LXX_PARALLEL_BOOKS } from "@/lib/utils/osis";

const LXX_SOURCE = "STEPBIBLE_LXX" as TextSource;

interface PageProps {
  params: Promise<{ book: string; source: string; chapter: string }>;
  searchParams: Promise<{ par?: string; [key: string]: string | string[] | undefined }>;
}

export default async function ChapterPage({ params, searchParams }: PageProps) {
  const { book, source, chapter: chapterStr } = await params;
  const { par } = await searchParams;
  const chapter = parseInt(chapterStr, 10);

  if (isNaN(chapter) || chapter < 1) notFound();

  const osisBook = decodeURIComponent(book);
  const textSource = source as TextSource;

  // Parallel mode: show OSHB + LXX side by side.
  // Triggered by ?par=1 when viewing an OSHB book that has LXX data.
  const isLXX = textSource === LXX_SOURCE;
  const canParallel = textSource === "OSHB" && OSHB_LXX_PARALLEL_BOOKS.has(osisBook);
  const parallelMode = !!par && canParallel;

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
    if (parallelMode) {
      [words, bookRecord, sourceBooks, lxxWords] = await Promise.all([
        getChapterWords(osisBook, chapter, textSource),
        getBook(osisBook),
        sourceBooksPromise,
        getChapterWords(osisBook, chapter, LXX_SOURCE),
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
  let availableTranslations: Awaited<ReturnType<typeof getAvailableTranslationsForChapter>> = [];
  let initialParagraphBreakIds: string[] = [];
  let initialCharacters: Awaited<ReturnType<typeof getCharacters>> = [];
  let initialCharacterRefs: Awaited<ReturnType<typeof getChapterCharacterRefs>> = [];
  let initialSpeechSections: Awaited<ReturnType<typeof getChapterSpeechSections>> = [];
  let initialWordTags: Awaited<ReturnType<typeof getWordTags>> = [];
  let initialWordTagRefs: Awaited<ReturnType<typeof getChapterWordTagRefs>> = [];
  let initialLineIndents: { wordId: string; indentLevel: number }[] = [];
  let initialRstRelations: Awaited<ReturnType<typeof getChapterRstRelations>> = [];
  let initialWordArrows: Awaited<ReturnType<typeof getChapterWordArrows>> = [];
  let initialWordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[] = [];
  let initialSceneBreaks: Awaited<ReturnType<typeof getChapterSceneBreaks>> = [];
  let initialLineAnnotations: Awaited<ReturnType<typeof getChapterLineAnnotations>> = [];
  let bookSceneBreaks: Awaited<ReturnType<typeof getBookSceneBreaks>> = [];
  let bookMaxVerses: Awaited<ReturnType<typeof getBookChapterMaxVerses>> = new Map();
  let translationVerseData: Record<number, TranslationVerse[]> = {};

  if (!parallelMode) {
    [availableTranslations, initialParagraphBreakIds, initialCharacters,
     initialCharacterRefs, initialSpeechSections,
     initialWordTags, initialWordTagRefs, initialLineIndents,
     initialRstRelations, initialWordArrows, initialWordFormatting,
     initialSceneBreaks, initialLineAnnotations,
     bookSceneBreaks, bookMaxVerses] = await Promise.all([
      getAvailableTranslationsForChapter(osisBook, chapter),
      getChapterParagraphBreaks(osisBook, chapter),
      getCharacters(osisBook),
      getChapterCharacterRefs(osisBook, chapter),
      getChapterSpeechSections(osisBook, chapter, textSource),
      getWordTags(osisBook),
      getChapterWordTagRefs(osisBook, chapter),
      getChapterLineIndents(osisBook, chapter),
      getChapterRstRelations(osisBook, chapter, textSource),
      getChapterWordArrows(osisBook, chapter, textSource),
      getChapterWordFormatting(osisBook, chapter),
      getChapterSceneBreaks(osisBook, chapter),
      getChapterLineAnnotations(osisBook, chapter, textSource),
      getBookSceneBreaks(osisBook, textSource),
      getBookChapterMaxVerses(osisBook, textSource),
    ]);
    await Promise.all(
      availableTranslations.map(async (t) => {
        translationVerseData[t.id] = await getTranslationVerses(t.id, osisBook, chapter);
      })
    );
  }

  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;

  // Source-switch link: when on LXX, offer a link to the OSHB version (if it exists).
  // When on OSHB with an LXX parallel available, offer the LXX standalone.
  const oshbHref  = `/${encodeURIComponent(osisBook)}/OSHB/${chapter}`;
  const lxxHref   = `/${encodeURIComponent(osisBook)}/${LXX_SOURCE}/${chapter}`;
  const parallelHref = `/${encodeURIComponent(osisBook)}/OSHB/${chapter}?par=1`;

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Nav bar */}
      <nav
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

        {/* Book name + source badge */}
        <span className="text-sm font-semibold" style={{ color: "var(--nav-fg-muted)" }}>
          {bookName}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "rgba(200,155,60,0.18)", color: "var(--accent)" }}
        >
          {parallelMode ? "OSHB ‖ LXX" : textSource}
        </span>

        {/* Source-switch links */}
        {isLXX && OSHB_LXX_PARALLEL_BOOKS.has(osisBook) && (
          <Link
            href={oshbHref}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
            title="Switch to Hebrew (OSHB)"
          >
            ↔ OSHB
          </Link>
        )}
        {textSource === "OSHB" && OSHB_LXX_PARALLEL_BOOKS.has(osisBook) && !parallelMode && (
          <>
            <Link
              href={parallelHref}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--nav-fg)" }}
              title="View OSHB and LXX side by side"
            >
              ‖ Parallel LXX
            </Link>
            <Link
              href={lxxHref}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: "var(--nav-fg)" }}
              title="Switch to Septuagint (LXX)"
            >
              ↔ LXX
            </Link>
          </>
        )}
        {parallelMode && (
          <Link
            href={`/${encodeURIComponent(osisBook)}/OSHB/${chapter}`}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
            title="Exit parallel view"
          >
            ✕ Exit Parallel
          </Link>
        )}

        {/* Import link */}
        <Link
          href="/import"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          + Import
        </Link>

        {/* Backup link */}
        <Link
          href="/backup"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          Backup
        </Link>

        {/* Export link (only in non-parallel mode) */}
        {!parallelMode && (
          <Link
            href={`/export/${encodeURIComponent(osisBook)}/${textSource}/${chapter}`}
            target="_blank"
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
          >
            Export →
          </Link>
        )}

        {/* Book selector dropdown */}
        <BookDropdown
          books={sourceBooks ?? []}
          currentOsisBook={osisBook}
          textSource={textSource}
          bookName={bookName}
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

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Chapter navigation */}
        <div className="ml-auto flex items-center gap-1">
          {chapter > 1 && (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter - 1}${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
            >
              ← {chapter - 1}
            </Link>
          )}
          <span
            className="text-sm font-medium px-2"
            style={{ color: "var(--nav-fg)" }}
          >
            Ch. {chapter}
          </span>
          {chapter < chapterCount && (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter + 1}${parallelMode ? "?par=1" : ""}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg)" }}
            >
              {chapter + 1} →
            </Link>
          )}
        </div>
      </nav>

      {/* Chapter heading */}
      <div
        className="shrink-0 px-6 pt-4 pb-2 border-b"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <h1
          className="text-xl font-bold tracking-tight"
          style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          {bookName} <span style={{ color: "var(--accent)" }}>{chapter}</span>
          {parallelMode && (
            <span
              className="text-sm font-normal ml-3"
              style={{ color: "var(--text-muted)" }}
            >
              Hebrew ‖ Septuagint
            </span>
          )}
        </h1>
        <p className="text-xs mt-0.5">
          {parallelMode
            ? `${words.length.toLocaleString()} Hebrew + ${lxxWords.length.toLocaleString()} Greek words`
            : `${words.length.toLocaleString()} words`}
        </p>
      </div>

      {/* Text content */}
      <div className="flex-1 min-h-0">
        {parallelMode ? (
          <ParallelChapterView
            osisBook={osisBook}
            chapter={chapter}
            oshbWords={words}
            lxxWords={lxxWords}
          />
        ) : (
          <ChapterDisplay
            words={words}
            book={osisBook}
            chapter={chapter}
            textSource={textSource}
            availableTranslations={availableTranslations}
            translationVerseData={translationVerseData}
            initialParagraphBreakIds={initialParagraphBreakIds}
            initialCharacters={initialCharacters}
            initialCharacterRefs={initialCharacterRefs}
            initialSpeechSections={initialSpeechSections}
            initialWordTags={initialWordTags}
            initialWordTagRefs={initialWordTagRefs}
            initialLineIndents={initialLineIndents}
            initialRstRelations={initialRstRelations}
            initialWordArrows={initialWordArrows}
            initialWordFormatting={initialWordFormatting}
            initialSceneBreaks={initialSceneBreaks}
            initialLineAnnotations={initialLineAnnotations}
            bookSceneBreaks={bookSceneBreaks}
            bookMaxVerses={bookMaxVerses}
          />
        )}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params;
  const osisBook = decodeURIComponent(book);
  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  return {
    title: `${bookName} ${chapter} — Structura`,
  };
}
