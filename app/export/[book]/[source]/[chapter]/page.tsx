import { notFound } from "next/navigation";
import {
  getChapterWords,
  getBook,
  getChapterParagraphBreaks,
  getCharacters,
  getChapterCharacterRefs,
  getChapterSpeechSections,
  getWordTags,
  getChapterWordTagRefs,
  getChapterLineIndents,
  getChapterWordFormatting,
  getAvailableTranslationsForChapter,
  getTranslationVerses,
  getChapterClauseRelationships,
  getChapterWordArrows,
  getChapterSceneBreaks,
  getChapterLineAnnotations,
  getChapterRstRelations,
} from "@/lib/db/queries";
import type { TranslationVerse } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import ExportLayout from "@/components/export/ExportLayout";
import ExportTextView from "@/components/export/ExportTextView";
import { getActiveWorkspaceId } from "@/lib/workspace";

interface PageProps {
  params: Promise<{ book: string; source: string; chapter: string }>;
}

export default async function ExportChapterPage({ params }: PageProps) {
  const { book, source, chapter: chapterStr } = await params;
  const chapter = parseInt(chapterStr, 10);

  if (isNaN(chapter) || chapter < 1) notFound();

  const osisBook   = decodeURIComponent(book);
  const textSource = source as TextSource;
  const workspaceId = await getActiveWorkspaceId();

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

  const [
    paragraphBreakIds,
    characters,
    characterRefs,
    speechSections,
    wordTags,
    wordTagRefs,
    lineIndents,
    wordFormatting,
    sceneBreaks,
    availableTranslations,
    clauseRelationships,
    wordArrows,
    lineAnnotations,
    rstRelations,
  ] = await Promise.all([
    getChapterParagraphBreaks(osisBook, chapter, workspaceId),
    getCharacters(osisBook, workspaceId),
    getChapterCharacterRefs(osisBook, chapter, workspaceId),
    getChapterSpeechSections(osisBook, chapter, textSource, workspaceId),
    getWordTags(osisBook, workspaceId),
    getChapterWordTagRefs(osisBook, chapter, workspaceId),
    getChapterLineIndents(osisBook, chapter, workspaceId),
    getChapterWordFormatting(osisBook, chapter, workspaceId),
    getChapterSceneBreaks(osisBook, chapter, workspaceId),
    getAvailableTranslationsForChapter(osisBook, chapter, workspaceId),
    getChapterClauseRelationships(osisBook, chapter, textSource, workspaceId),
    getChapterWordArrows(osisBook, chapter, textSource, workspaceId),
    getChapterLineAnnotations(osisBook, chapter, textSource, workspaceId),
    getChapterRstRelations(osisBook, chapter, textSource, workspaceId),
  ]);

  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    availableTranslations.map(async (t) => {
      translationVerseData[t.id] = await getTranslationVerses(t.id, osisBook, chapter, workspaceId);
    })
  );

  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  const isHebrew = bookRecord?.language === "hebrew";
  const filename  = `${osisBook}-${chapter}`;
  const revealHref = `/api/export/reveal?book=${encodeURIComponent(osisBook)}&source=${textSource}&chapter=${chapter}`;

  // Build note keys for every verse in this chapter plus the chapter-level note.
  const verseNums = [...new Set(words.map((w) => w.verse))].sort((a, b) => a - b);
  const noteContext = {
    title: `${bookName} ${chapter}`,
    keys: [
      `chapter:${osisBook}.${chapter}`,
      ...verseNums.map((v) => `verse:${osisBook}.${chapter}.${v}`),
    ],
  };

  return (
    <div style={{ backgroundColor: "var(--background)", minHeight: "100vh" }}>
      {/* Print header — visible only in print */}
      <div className="hidden print:block px-8 pt-6 pb-2">
        <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.25rem", fontWeight: "bold" }}>
          {bookName} {chapter}
        </h1>
        <p style={{ fontSize: "0.75rem", color: "#78716c" }}>Structura · {textSource}</p>
      </div>

      <ExportLayout revealHref={revealHref} filename={filename} backHref={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter}`} noteContext={noteContext}>
        <div className="px-6 pt-4 pb-2 print:hidden" style={{ borderBottom: "1px solid var(--border)" }}>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: "bold",
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: "var(--foreground)",
            }}
          >
            {bookName}{" "}
            <span style={{ color: "var(--accent)" }}>{chapter}</span>
          </h1>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>
            {words.length.toLocaleString()} words · {textSource}
          </p>
        </div>

        <ExportTextView
          words={words}
          book={osisBook}
          chapter={chapter}
          isHebrew={isHebrew}
          paragraphBreakIds={paragraphBreakIds}
          characters={characters}
          characterRefs={characterRefs}
          speechSections={speechSections}
          wordTags={wordTags}
          wordTagRefs={wordTagRefs}
          lineIndents={lineIndents}
          wordFormatting={wordFormatting}
          sceneBreaks={sceneBreaks}
          availableTranslations={availableTranslations}
          translationVerseData={translationVerseData}
          clauseRelationships={clauseRelationships}
          wordArrows={wordArrows}
          lineAnnotations={lineAnnotations}
          rstRelations={rstRelations}
        />
      </ExportLayout>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params;
  const osisBook  = decodeURIComponent(book);
  const bookName  = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  return { title: `Export ${bookName} ${chapter} — Structura` };
}
