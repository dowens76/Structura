import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  getChapterWords, getChapterWordsRange, getBook, getBooksBySource, getBooksWithWords,
  getMaxChapterForSource, getTranslations,
  getChapterRstRelations,
  getUltVerses, getUltTranslation, getVcbVerses, getVcbTranslation,
  getWorkspaceById,
  getLxxVerseTexts, getLxxVerseWords, getLxxTranslation,
  getVersionsForLocus,
} from "@/lib/db/queries";
import { getActiveVersionId } from "@/lib/versions/activeVersion";
import VersionSelector from "@/components/versions/VersionSelector";
import { resolveVisibleWordTags } from "@/lib/db/wordTagVisibility";
import { resolveVisibleCharacters } from "@/lib/db/characterVisibility";
import {
  getScriptureLocusEditingData,
  getScriptureLocusUserTranslationVerses,
  getScriptureLocusFootnotes,
  getScriptureLocusBuiltInTranslation,
  getScriptureLocusBookWideData,
  type ChapterLocus,
} from "@/lib/db/scriptureLocus";
import type { TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import ParallelChapterView from "@/components/text/ParallelChapterView";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ChapterDropdown from "@/components/navigation/ChapterDropdown";
import BookDropdown from "@/components/navigation/BookDropdown";
import NavLinks from "@/components/navigation/NavLinks";
import HistoryNav from "@/components/navigation/HistoryNav";
import BookmarkButton from "@/components/navigation/BookmarkButton";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import CopyFromWorkspaceDialog from "@/components/workspace/CopyFromWorkspaceDialog";
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
  const { par, present, toolbar, v } = await searchParams;
  const chapter = parseInt(chapterStr, 10);
  const initialPresentationMode = present !== undefined;
  const hideToolbar = toolbar === "0";
  const vStr = Array.isArray(v) ? v[0] : v;
  const parsedInitialVerse = vStr ? parseInt(vStr, 10) : NaN;
  const initialVerse = Number.isFinite(parsedInitialVerse) ? parsedInitialVerse : undefined;

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

  // For the book dropdown: always show OT + NT books so the user can navigate across testaments.
  // LXX uses getBooksWithWords to get the correct LXX book list; others use OSHB.
  const TESTAMENT_ORDER: Record<string, number> = { OT: 0, LXX: 1, NT: 2 };
  const sourceBooksPromise = isLXX
    ? Promise.all([getBooksWithWords(LXX_SOURCE), getBooksBySource("SBLGNT")]).then(([lxx, nt]) =>
        [...lxx, ...nt].sort((a, b) => (TESTAMENT_ORDER[a.testament] ?? 1) - (TESTAMENT_ORDER[b.testament] ?? 1) || a.bookNumber - b.bookNumber)
      )
    : Promise.all([getBooksBySource("OSHB"), getBooksBySource("SBLGNT")]).then(([ot, nt]) => [...ot, ...nt]);

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
  let editingData: Awaited<ReturnType<typeof getScriptureLocusEditingData>> = {
    initialParagraphBreakIds: [], initialCharacterRefs: [], initialSpeechSections: [],
    initialWordTagRefs: [], initialLineIndents: [], initialSyllableStressOverrides: [], initialRstRelations: [],
    initialLineGroups: [],
    initialWordArrows: [], initialWordFormatting: [], initialSceneBreaks: [],
    initialLineAnnotations: [], initialPoetryNotations: [], initialPoetryLineBracketExclusions: [], initialTextCriticalMarks: [],
  };
  let initialCharacters: Awaited<ReturnType<typeof resolveVisibleCharacters>> = [];
  let initialWordTags: Awaited<ReturnType<typeof resolveVisibleWordTags>> = [];
  let initialTvRstRelations: Awaited<ReturnType<typeof getChapterRstRelations>> = [];
  let bookWideData: Awaited<ReturnType<typeof getScriptureLocusBookWideData>> = { bookSceneBreaks: [], bookMaxVerses: new Map() };
  let translationVerseData: Record<number, TranslationVerse[]> = {};
  let initialTranslationFootnotes: Record<number, TranslationFootnote[]> = {};
  let ultBaseVerses: { chapter?: number; verse: number; text: string }[] = [];
  let ultTranslation: Awaited<ReturnType<typeof getUltTranslation>> = null;
  let vcbBaseVerses: { chapter?: number; verse: number; text: string }[] = [];
  let vcbTranslation: Awaited<ReturnType<typeof getVcbTranslation>> = null;
  let lxxBaseVerses: { chapter?: number; verse: number; text: string }[] = [];
  let lxxVerseWords: Map<number, import("@/lib/db/source-schema").Word[]> = new Map();
  let lxxTranslation: Awaited<ReturnType<typeof getLxxTranslation>> = null;

  const activeVersionId = parallelMode ? 0 : await getActiveVersionId(workspaceId, osisBook, chapter);
  const initialVersions = parallelMode ? [] : await getVersionsForLocus(workspaceId, osisBook, chapter);
  // Included in ChapterDisplay's remount key below so a Manage Versions copy
  // targeting the version currently being viewed forces a fresh render even
  // though activeVersionId itself doesn't change (see contentRevision's
  // comment in lib/db/user-schema.ts).
  const activeVersionRevision = initialVersions.find((v) => v.id === activeVersionId)?.contentRevision ?? 0;

  if (!parallelMode) {
    const locus: ChapterLocus[] = [{ book: osisBook, chapter }];

    const [translations, ed, bookWide] = await Promise.all([
      getTranslations(workspaceId),
      getScriptureLocusEditingData(locus, textSource, workspaceId, () => Promise.resolve(activeVersionId)),
      getScriptureLocusBookWideData(
        [{ osisBook, bookId: bookRecord?.id ?? 0, chapterCount: bookRecord?.chapterCount ?? 1 }],
        textSource, workspaceId
      ),
    ]);
    availableTranslations = translations;
    editingData = ed;
    bookWideData = bookWide;

    [initialCharacters, initialWordTags, initialTvRstRelations] = await Promise.all([
      resolveVisibleCharacters({ books: [osisBook], chapters: [{ book: osisBook, chapter }] }, workspaceId),
      resolveVisibleWordTags({ books: [osisBook], chapters: [{ book: osisBook, chapter }] }, workspaceId),
      getChapterRstRelations(osisBook, chapter, `tv:${textSource}`, workspaceId, activeVersionId),
    ]);

    [translationVerseData, initialTranslationFootnotes] = await Promise.all([
      getScriptureLocusUserTranslationVerses(locus, availableTranslations),
      getScriptureLocusFootnotes(locus, availableTranslations),
    ]);

    // ULT/VCB: built-in base text + any user overrides/footnotes
    const [ult, vcb] = await Promise.all([
      getScriptureLocusBuiltInTranslation(locus, getUltVerses, () => getUltTranslation(workspaceId)),
      getScriptureLocusBuiltInTranslation(locus, getVcbVerses, () => getVcbTranslation(workspaceId)),
    ]);
    ultBaseVerses = ult.baseVerses;
    ultTranslation = ult.translation;
    vcbBaseVerses = vcb.baseVerses;
    vcbTranslation = vcb.translation;
    for (const t of [ultTranslation, vcbTranslation]) {
      if (!t) continue;
      const [verses, footnotes] = await Promise.all([
        getScriptureLocusUserTranslationVerses(locus, [t]),
        getScriptureLocusFootnotes(locus, [t]),
      ]);
      Object.assign(translationVerseData, verses);
      Object.assign(initialTranslationFootnotes, footnotes);
    }

    // LXX as translation column (OSHB OT chapters only)
    if (textSource === "OSHB") {
      lxxBaseVerses = getLxxVerseTexts(osisBook, chapter);
      if (lxxBaseVerses.length > 0) {
        [lxxVerseWords, lxxTranslation] = await Promise.all([
          getLxxVerseWords(osisBook, chapter),
          getLxxTranslation(),
        ]);
        if (lxxTranslation) {
          const [verses, footnotes] = await Promise.all([
            getScriptureLocusUserTranslationVerses(locus, [lxxTranslation]),
            getScriptureLocusFootnotes(locus, [lxxTranslation]),
          ]);
          Object.assign(translationVerseData, verses);
          Object.assign(initialTranslationFootnotes, footnotes);
        }
      }
    }
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

        {/* Right side: history nav, bookmark, workspace, settings, theme */}
        <div className="ml-auto flex items-center gap-1">
          <HistoryNav />
          <BookmarkButton
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter}${parallelMode ? "?par=1" : ""}`}
            label={`${bookName} ${chapter} · ${parallelMode ? "OSHB ‖ LXX" : textSource}`}
          />
          {!parallelMode && (
            <CopyFromWorkspaceDialog
              activeWorkspaceId={workspaceId}
              scope={{ type: "chapter", book: osisBook, chapter }}
            />
          )}
          {!parallelMode && (
            <VersionSelector
              workspaceId={workspaceId}
              chapters={[{ book: osisBook, chapter }]}
              initialVersions={initialVersions}
              initialActiveVersionId={activeVersionId}
            />
          )}
          <WorkspaceSwitcher activeWorkspaceId={workspaceId} />
          <SettingsButton />
          <ThemeToggle />
        </div>
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
            key={`${workspaceId}:${activeVersionId}:${activeVersionRevision}`}
            words={words}
            book={osisBook}
            chapter={chapter}
            textSource={textSource}
            startBookId={bookRecord?.id ?? 0}
            availableTranslations={availableTranslations}
            translationVerseData={translationVerseData}
            ultBaseVerses={ultBaseVerses}
            ultTranslation={ultTranslation}
            vcbBaseVerses={vcbBaseVerses}
            vcbTranslation={vcbTranslation}
            lxxBaseVerses={lxxBaseVerses}
            lxxVerseWords={lxxVerseWords}
            lxxTranslation={lxxTranslation}
            initialTextCriticalMarks={editingData.initialTextCriticalMarks}
            initialParagraphBreakIds={editingData.initialParagraphBreakIds}
            initialCharacters={initialCharacters}
            initialCharacterRefs={editingData.initialCharacterRefs}
            initialSpeechSections={editingData.initialSpeechSections}
            initialWordTags={initialWordTags}
            initialWordTagRefs={editingData.initialWordTagRefs}
            initialLineIndents={editingData.initialLineIndents}
            initialSyllableStressOverrides={editingData.initialSyllableStressOverrides}
            initialRstRelations={editingData.initialRstRelations}
            initialLineGroups={editingData.initialLineGroups}
            initialTvRstRelations={initialTvRstRelations}
            initialWordArrows={editingData.initialWordArrows}
            initialWordFormatting={editingData.initialWordFormatting}
            initialSceneBreaks={editingData.initialSceneBreaks}
            initialLineAnnotations={editingData.initialLineAnnotations}
            initialPoetryNotations={editingData.initialPoetryNotations}
            initialPoetryLineBracketExclusions={editingData.initialPoetryLineBracketExclusions}
            bookSceneBreaks={bookWideData.bookSceneBreaks}
            bookMaxVerses={bookWideData.bookMaxVerses}
            initialTranslationFootnotes={initialTranslationFootnotes}
            translationOnly={translationOnly}
            sortedBooks={sourceBooks.map((b) => b.osisCode)}
            initialPresentationMode={initialPresentationMode}
            hideToolbar={hideToolbar}
            initialVerse={initialVerse}
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
