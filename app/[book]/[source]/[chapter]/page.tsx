import { notFound } from "next/navigation";
import Link from "next/link";
import { getChapterWords, getBook, getChapterCount, getAvailableTranslationsForChapter, getTranslationVerses, getChapterParagraphBreaks, getCharacters, getChapterCharacterRefs, getChapterSpeechSections } from "@/lib/db/queries";
import type { TranslationVerse } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import ChapterDisplay from "@/components/text/ChapterDisplay";
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
  try {
    [words, bookRecord] = await Promise.all([
      getChapterWords(osisBook, chapter, textSource),
      getBook(osisBook),
    ]);
  } catch {
    notFound();
  }

  if (!words || words.length === 0) notFound();

  const [availableTranslations, initialParagraphBreakIds, initialCharacters,
         initialCharacterRefs, initialSpeechSections] = await Promise.all([
    getAvailableTranslationsForChapter(osisBook, chapter),
    getChapterParagraphBreaks(osisBook, chapter),
    getCharacters(osisBook),
    getChapterCharacterRefs(osisBook, chapter),
    getChapterSpeechSections(osisBook, chapter, textSource),
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
      {/* Nav bar */}
      <nav
        className="shrink-0 border-b px-4 py-2 flex items-center gap-4"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight"
          style={{ color: "var(--foreground)" }}
        >
          Structura
        </Link>

        <span style={{ color: "var(--border-muted)" }}>/</span>

        {/* Book name + source */}
        <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          {bookName}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={{ backgroundColor: "var(--surface-muted)", color: "var(--text-muted)" }}
        >
          {textSource}
        </span>

        {/* Import link */}
        <Link
          href="/import"
          className="text-xs px-2 py-1 rounded transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
          style={{ color: "var(--text-muted)" }}
        >
          + Import
        </Link>

        {/* Chapter navigation */}
        <div className="ml-auto flex items-center gap-2">
          {chapter > 1 && (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter - 1}`}
              className="px-2 py-1 rounded text-sm hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              style={{ color: "var(--foreground)" }}
            >
              ← {chapter - 1}
            </Link>
          )}
          <span
            className="text-sm font-medium px-2"
            style={{ color: "var(--foreground)" }}
          >
            Ch. {chapter}
          </span>
          {chapter < chapterCount && (
            <Link
              href={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter + 1}`}
              className="px-2 py-1 rounded text-sm hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              style={{ color: "var(--foreground)" }}
            >
              {chapter + 1} →
            </Link>
          )}
        </div>
      </nav>

      {/* Chapter heading */}
      <div
        className="shrink-0 px-6 pt-4 pb-2"
        style={{ color: "var(--text-muted)" }}
      >
        <h1 className="text-xl font-bold" style={{ color: "var(--foreground)" }}>
          {bookName} {chapter}
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
