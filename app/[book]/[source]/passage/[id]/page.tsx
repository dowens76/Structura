import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  getPassage,
  getPassageWords,
  getBook,
  getBooksBySource,
  getBooksWithWords,
  getChapterMaxVerse,
  getAvailableTranslationsForChapter,
  getUltVerses,
  getUltTranslation,
  getVcbVerses,
  getVcbTranslation,
  getLxxVerseTexts,
  getLxxTranslation,
  getWorkspaceById,
  getVersionsForLocus,
} from "@/lib/db/queries";
import { getActiveVersionId } from "@/lib/versions/activeVersion";
import VersionSelector from "@/components/versions/VersionSelector";
import {
  getScriptureLocusEditingData,
  getScriptureLocusUserTranslationVerses,
  getScriptureLocusFootnotes,
  getScriptureLocusBuiltInTranslation,
  getScriptureLocusBookWideData,
  type ChapterLocus,
} from "@/lib/db/scriptureLocus";
import { resolveVisibleWordTags } from "@/lib/db/wordTagVisibility";
import { resolveVisibleCharacters } from "@/lib/db/characterVisibility";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { OSIS_BOOK_NAMES, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsButton from "@/components/SettingsButton";
import PassageExportLink from "@/components/passage/PassageExportLink";
import BookDropdown from "@/components/navigation/BookDropdown";
import ChapterDropdown from "@/components/navigation/ChapterDropdown";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import CopyFromWorkspaceDialog from "@/components/workspace/CopyFromWorkspaceDialog";
import LanguagePicker from "@/components/ui/LanguagePicker";
import ImportButton from "@/components/navigation/ImportButton";
import HistoryNav from "@/components/navigation/HistoryNav";
import BookmarkButton from "@/components/navigation/BookmarkButton";

interface PageProps {
  params: Promise<{ book: string; source: string; id: string }>;
  searchParams?: Promise<{ present?: string; toolbar?: string; [key: string]: string | string[] | undefined }>;
}

export default async function PassagePage({ params, searchParams }: PageProps) {
  const { book: bookParam, source, id: idStr } = await params;
  const sp = searchParams ? await searchParams : {};
  const initialPresentationMode = "present" in sp;
  const hideToolbar = sp.toolbar === "0";
  const id = parseInt(idStr, 10);

  if (isNaN(id)) notFound();

  const osisBook    = decodeURIComponent(bookParam);
  const textSource  = source as TextSource;
  const workspaceId = await getActiveWorkspaceId();
  const workspace = await getWorkspaceById(workspaceId).catch(() => null);
  const translationOnly = workspace?.translationOnly ?? false;

  const isLXXPassage = textSource === "STEPBIBLE_LXX";
  const TESTAMENT_ORDER: Record<string, number> = { OT: 0, LXX: 1, NT: 2 };
  const [passage, bookRecord, sourceBooks] = await Promise.all([
    getPassage(id),
    getBook(osisBook),
    isLXXPassage
      ? Promise.all([getBooksWithWords("STEPBIBLE_LXX"), getBooksBySource("SBLGNT")]).then(([lxx, nt]) =>
          [...lxx, ...nt].sort((a, b) => (TESTAMENT_ORDER[a.testament] ?? 1) - (TESTAMENT_ORDER[b.testament] ?? 1) || a.bookNumber - b.bookNumber)
        )
      : Promise.all([getBooksBySource("OSHB"), getBooksBySource("SBLGNT")]).then(([ot, nt]) => [...ot, ...nt]),
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
  const chapterEntries: ChapterLocus[] = [];

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

  // ── Pre-fetch words and supporting data ────────────────────────────────────
  const [
    passageWords,
    maxVerseOfStartChapter,
    maxVerseOfEndChapter,
    maxVerseOfPrevStartChapter,
    maxVerseOfPrevEndChapter,
    characters,
    wordTags,
    bookWideData,
    editingData,
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
    // Characters / word-tags: resolved per each row's own corpus scope
    // (book/chapter/passage/grouping) against the books+chapters this
    // passage view actually spans.
    resolveVisibleCharacters(
      { books: isCrossBook ? [osisBook, endOsisBook] : [osisBook], chapters: chapterEntries, passageId: passage.id },
      workspaceId
    ),
    resolveVisibleWordTags(
      { books: isCrossBook ? [osisBook, endOsisBook] : [osisBook], chapters: chapterEntries, passageId: passage.id },
      workspaceId
    ),
    getScriptureLocusBookWideData(
      isCrossBook
        ? [
            { osisBook, bookId: bookRecord.id, chapterCount: bookRecord.chapterCount },
            { osisBook: endOsisBook, bookId: endBookRecord.id, chapterCount: endBookRecord.chapterCount },
          ]
        : [{ osisBook, bookId: bookRecord.id, chapterCount: bookRecord.chapterCount }],
      textSource, workspaceId
    ),
    getScriptureLocusEditingData(chapterEntries, textSource, workspaceId, (b, c) => getActiveVersionId(workspaceId, b, c)),
  ]);

  // Representative locus for the version selector: the passage's first
  // chapter. Create/rename/delete fan out across every chapter in
  // chapterEntries via the shared groupKey (see /api/versions).
  const [activeVersionId, initialVersions] = await Promise.all([
    getActiveVersionId(workspaceId, chapterEntries[0].book, chapterEntries[0].chapter),
    getVersionsForLocus(workspaceId, chapterEntries[0].book, chapterEntries[0].chapter),
  ]);
  // Included in ChapterDisplay's remount key below so a Manage Versions copy
  // targeting the version currently being viewed forces a fresh render even
  // though activeVersionId itself doesn't change (see contentRevision's
  // comment in lib/db/user-schema.ts).
  const activeVersionRevision = initialVersions.find((v) => v.id === activeVersionId)?.contentRevision ?? 0;

  const {
    initialParagraphBreakIds, initialCharacterRefs, initialSpeechSections,
    initialWordTagRefs, initialLineIndents, initialRstRelations, initialLineGroups,
    initialWordArrows, initialWordFormatting, initialSceneBreaks,
    initialLineAnnotations, initialTextCriticalMarks,
  } = editingData;

  // Book-wide scene breaks/max-verses, merged across 1 or 2 books. Chapters
  // in `bookSceneBreaks` stay in each break's own book's raw numbering
  // (needed so the outline pane's book-wide filtering, which compares raw
  // chapter numbers, keeps working) — each entry is tagged with its owning
  // bookId instead, so ChapterDisplay's sectionRanges computation can offset
  // only the specific entries it feeds into computeSectionRanges (which does
  // raw chapter arithmetic and needs a single monotonic numbering to cross a
  // book boundary correctly). `bookMaxVerses` is pre-offset by the helper.
  const { bookSceneBreaks: allBookSceneBreaks, bookMaxVerses: mergedBookMaxVerses } = bookWideData;

  // ── Translations ───────────────────────────────────────────────────────────
  const availableTranslations = await getAvailableTranslationsForChapter(osisBook, passage.startChapter);
  const translationVerseData = await getScriptureLocusUserTranslationVerses(chapterEntries, availableTranslations);
  const initialTranslationFootnotes = await getScriptureLocusFootnotes(chapterEntries, availableTranslations);

  // ULT/VCB/LXX: built-in base text + any user overrides/footnotes
  const [ult, vcb, lxx] = await Promise.all([
    getScriptureLocusBuiltInTranslation(chapterEntries, getUltVerses, () => getUltTranslation()),
    getScriptureLocusBuiltInTranslation(chapterEntries, getVcbVerses, () => getVcbTranslation(workspaceId)),
    getScriptureLocusBuiltInTranslation(chapterEntries, getLxxVerseTexts, () => getLxxTranslation()),
  ]);
  const { baseVerses: ultBaseVerses, translation: ultTranslation } = ult;
  const { baseVerses: vcbBaseVerses, translation: vcbTranslation } = vcb;
  const { baseVerses: lxxBaseVerses, translation: lxxTranslation } = lxx;

  for (const t of [ultTranslation, vcbTranslation, lxxTranslation]) {
    if (!t) continue;
    const [verses, footnotes] = await Promise.all([
      getScriptureLocusUserTranslationVerses(chapterEntries, [t]),
      getScriptureLocusFootnotes(chapterEntries, [t]),
    ]);
    Object.assign(translationVerseData, verses);
    Object.assign(initialTranslationFootnotes, footnotes);
  }

  // Display metadata ───────────────────────────────────────────────────────
  const bookName    = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  const endBookName = OSIS_REF_BOOK_NAMES[endOsisBook] ?? endOsisBook;

  // Passage reference string shown in the nav bar for cross-book passages
  const crossBookRef = isCrossBook
    ? `${bookName} ${passage.startChapter}:${passage.startVerse} – ${endBookName} ${passage.endChapter}:${passage.endVerse}`
    : null;

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
          {textSource}
        </span>

        {/* Passage reference */}
        <span className="text-sm font-semibold" style={{ color: "var(--nav-fg-muted)" }}>
          {crossBookRef ?? bookName}
        </span>

        {/* Import button */}
        <ImportButton osisBook={osisBook} chapter={passage.startChapter} />

        {/* Export link */}
        <PassageExportLink passageId={id} />

        {/* Account */}
        <Link
          href="/account"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg)" }}
        >
          Account
        </Link>

        {/* Language picker */}
        <LanguagePicker />

        {/* Book selector dropdown */}
        <BookDropdown
          books={sourceBooks ?? []}
          currentOsisBook={osisBook}
          textSource={textSource}
        />

        {/* Chapter selector dropdown */}
        <ChapterDropdown
          chapter={passage.startChapter}
          chapterCount={bookRecord.chapterCount}
          osisBook={osisBook}
          textSource={textSource}
        />

        <PassageNavButtons
          book={osisBook}
          textSource={textSource}
          bookName={bookName}
          currentChapter={passage.startChapter}
          chapterCount={bookRecord.chapterCount}
          currentPassageId={id}
        />

        {/* Right side: switch to chapter view, history nav, bookmark, workspace, settings, theme */}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${passage.startChapter}`}
            className="text-xs px-2 py-1 rounded border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--nav-fg)" }}
          >
            Switch to Chapter View
          </Link>
          <HistoryNav />
          <BookmarkButton
            href={`/${encodeURIComponent(osisBook)}/${textSource}/passage/${id}`}
            label={`${crossBookRef ?? (passage.startChapter === passage.endChapter ? (passage.startVerse === passage.endVerse ? `${bookName} ${passage.startChapter}:${passage.startVerse}` : `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endVerse}`) : `${bookName} ${passage.startChapter}–${passage.endChapter}`)} · ${textSource}`}
          />
          <CopyFromWorkspaceDialog
            activeWorkspaceId={workspaceId}
            scope={{ type: "passage", passageId: id }}
          />
          <VersionSelector
            workspaceId={workspaceId}
            chapters={chapterEntries}
            initialVersions={initialVersions}
            initialActiveVersionId={activeVersionId}
          />
          <WorkspaceSwitcher activeWorkspaceId={workspaceId} />
          <SettingsButton />
          <ThemeToggle />
        </div>
      </nav>}

      {/* Passage content */}
      <div className="flex-1 min-h-0">
        <ChapterDisplay
          key={`${workspaceId}:${activeVersionId}:${activeVersionRevision}`}
          passage={passage}
          words={passageWords}
          book={osisBook}
          chapter={passage.startChapter}
          endBook={isCrossBook ? endOsisBook : undefined}
          maxVerseOfStartChapter={maxVerseOfStartChapter}
          maxVerseOfEndChapter={maxVerseOfEndChapter}
          maxVerseOfPrevStartChapter={maxVerseOfPrevStartChapter}
          maxVerseOfPrevEndChapter={maxVerseOfPrevEndChapter}
          textSource={textSource}
          startBookId={bookRecord.id}
          endBookId={isCrossBook ? endBookRecord.id : undefined}
          startBookChapterCount={bookRecord.chapterCount}
          sortedBooks={sourceBooks.map((b) => b.osisCode)}
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
          vcbBaseVerses={vcbBaseVerses}
          vcbTranslation={vcbTranslation}
          lxxBaseVerses={lxxBaseVerses}
          lxxTranslation={lxxTranslation}
          initialTextCriticalMarks={initialTextCriticalMarks}
          initialRstRelations={initialRstRelations}
          initialLineGroups={initialLineGroups}
          initialWordArrows={initialWordArrows}
          initialWordFormatting={initialWordFormatting}
          initialSceneBreaks={initialSceneBreaks}
          initialLineAnnotations={initialLineAnnotations}
          bookSceneBreaks={allBookSceneBreaks}
          bookMaxVerses={mergedBookMaxVerses}
          initialTranslationFootnotes={initialTranslationFootnotes}
          translationOnly={translationOnly}
          initialPresentationMode={initialPresentationMode}
          hideToolbar={hideToolbar}
        />
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, id: idStr } = await params;
  const osisBook = decodeURIComponent(book);
  const bookName = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  const id = parseInt(idStr, 10);
  if (!isNaN(id)) {
    const passage = await getPassage(id);
    if (passage?.label) {
      return { title: `${passage.label} — Structura` };
    }
    if (passage) {
      const endBookName = passage.endBook
        ? (OSIS_REF_BOOK_NAMES[passage.endBook] ?? passage.endBook)
        : bookName;
      const ref = passage.endBook && passage.endBook !== osisBook
        ? `${bookName} ${passage.startChapter}:${passage.startVerse} – ${endBookName} ${passage.endChapter}:${passage.endVerse}`
        : passage.startChapter === passage.endChapter
          ? passage.startVerse === passage.endVerse
            ? `${bookName} ${passage.startChapter}:${passage.startVerse}`
            : `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endVerse}`
          : `${bookName} ${passage.startChapter}:${passage.startVerse} – ${passage.endChapter}:${passage.endVerse}`;
      return { title: `${ref} — Structura` };
    }
  }
  return { title: `${bookName} Passage — Structura` };
}
