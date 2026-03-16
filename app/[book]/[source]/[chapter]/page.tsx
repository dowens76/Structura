import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getChapterWords, getBook, getBooksBySource, getChapterCount, getAvailableTranslationsForChapter, getTranslationVerses, getChapterParagraphBreaks, getCharacters, getChapterCharacterRefs, getChapterSpeechSections, getWordTags, getChapterWordTagRefs, getChapterLineIndents, getChapterClauseRelationships, getChapterWordArrows, getChapterWordFormatting, getChapterSceneBreaks } from "@/lib/db/queries";
import type { TranslationVerse } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import PassageNavButtons from "@/components/passage/PassageNavButtons";
import ChapterDropdown from "@/components/navigation/ChapterDropdown";
import BookDropdown from "@/components/navigation/BookDropdown";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

interface PageProps {
  params: Promise<{ book: string; source: string; chapter: string }>;
}

export default async function ChapterPage({ params }: PageProps) {
  const { book, source, chapter: chapterStr } = await params;
  const chapter = parseInt(chapterStr, 10);

  if (isNaN(chapter) || chapter < 1) notFound();

  const osisBook = decodeURIComponent(book);
  const textSource = source as TextSource;

  let words;
  let bookRecord;
  let sourceBooks;
  try {
    [words, bookRecord, sourceBooks] = await Promise.all([
      getChapterWords(osisBook, chapter, textSource),
      getBook(osisBook),
      getBooksBySource(source),
    ]);
  } catch {
    notFound();
  }

  if (!words || words.length === 0) notFound();

  const [availableTranslations, initialParagraphBreakIds, initialCharacters,
         initialCharacterRefs, initialSpeechSections,
         initialWordTags, initialWordTagRefs, initialLineIndents,
         initialClauseRelationships, initialWordArrows, initialWordFormatting,
         initialSceneBreaks] = await Promise.all([
    getAvailableTranslationsForChapter(osisBook, chapter),
    getChapterParagraphBreaks(osisBook, chapter),
    getCharacters(osisBook),
    getChapterCharacterRefs(osisBook, chapter),
    getChapterSpeechSections(osisBook, chapter, textSource),
    getWordTags(osisBook),
    getChapterWordTagRefs(osisBook, chapter),
    getChapterLineIndents(osisBook, chapter),
    getChapterClauseRelationships(osisBook, chapter, textSource),
    getChapterWordArrows(osisBook, chapter, textSource),
    getChapterWordFormatting(osisBook, chapter),
    getChapterSceneBreaks(osisBook, chapter),
  ]);
  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    availableTranslations.map(async (t) => {
      translationVerseData[t.id] = await getTranslationVerses(t.id, osisBook, chapter);
    })
  );

  const chapterCount = bookRecord?.chapterCount ?? 1;
  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Nav bar — dark navy, brand-coloured */}
      <nav
        className="shrink-0 border-b px-4 py-0 flex items-center gap-3 h-12"
        style={{ borderColor: "var(--nav-border)", backgroundColor: "var(--nav-bg)" }}
      >
        {/* Logo mark linking home */}
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
        <span className="text-sm font-semibold" style={{ color: "var(--nav-fg)" }}>
          {bookName}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "rgba(200,155,60,0.18)", color: "var(--accent)" }}
        >
          {textSource}
        </span>

        {/* Import link */}
        <Link
          href="/import"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg-muted)" }}
        >
          + Import
        </Link>

        {/* Backup link */}
        <Link
          href="/backup"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg-muted)" }}
        >
          Backup
        </Link>

        {/* Export link */}
        <Link
          href={`/export/${encodeURIComponent(osisBook)}/${textSource}/${chapter}`}
          target="_blank"
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--nav-fg-muted)" }}
        >
          Export →
        </Link>

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

        {/* Passages — client button with dropdown */}
        <PassageNavButtons
          book={osisBook}
          textSource={textSource}
          bookName={bookName}
          currentChapter={chapter}
          chapterCount={chapterCount}
        />

        {/* Chapter navigation — right-aligned */}
        <div className="ml-auto flex items-center gap-1">
          {chapter > 1 && (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter - 1}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg-muted)" }}
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
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter + 1}`}
              className="px-2 py-1 rounded text-sm transition-colors"
              style={{ color: "var(--nav-fg-muted)" }}
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
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {bookName} <span style={{ color: "var(--accent)" }}>{chapter}</span>
        </h1>
        <p className="text-xs mt-0.5">{words.length.toLocaleString()} words</p>
      </div>

      {/* Text content */}
      <div className="flex-1 min-h-0">
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
          initialClauseRelationships={initialClauseRelationships}
          initialWordArrows={initialWordArrows}
          initialWordFormatting={initialWordFormatting}
          initialSceneBreaks={initialSceneBreaks}
        />
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
