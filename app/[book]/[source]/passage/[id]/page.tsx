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
} from "@/lib/db/queries";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import type { TextSource } from "@/lib/morphology/types";
import type { TranslationVerse } from "@/lib/db/schema";
import PassageView from "@/components/passage/PassageView";
import PassageNavButtons from "@/components/passage/PassageNavButtons";

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

  // Build the list of chapters covered by this passage
  const chapterRange: number[] = [];
  for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) chapterRange.push(ch);

  // Pre-fetch words and the four max-verse values needed for range navigation.
  const [
    passageWords,
    maxVerseOfStartChapter,
    maxVerseOfEndChapter,
    maxVerseOfPrevStartChapter,
    maxVerseOfPrevEndChapter,
    characters,
    wordTags,
    bookSceneBreaks,
    bookMaxVerses,
    perChapterResults,
  ] = await Promise.all([
    getPassageWords(
      osisBook, textSource,
      passage.startChapter, passage.startVerse,
      passage.endChapter,   passage.endVerse
    ),
    getChapterMaxVerse(osisBook, passage.startChapter, textSource),
    getChapterMaxVerse(osisBook, passage.endChapter,   textSource),
    passage.startChapter > 1
      ? getChapterMaxVerse(osisBook, passage.startChapter - 1, textSource)
      : Promise.resolve(0),
    passage.endChapter > 1
      ? getChapterMaxVerse(osisBook, passage.endChapter - 1, textSource)
      : Promise.resolve(0),
    getCharacters(osisBook, workspaceId),
    getWordTags(osisBook, workspaceId),
    getBookSceneBreaks(osisBook, textSource, workspaceId),
    getBookChapterMaxVerses(osisBook, textSource),
    Promise.all(
      chapterRange.map((ch) =>
        Promise.all([
          getChapterParagraphBreaks(osisBook, ch, workspaceId),
          getChapterCharacterRefs(osisBook, ch, workspaceId),
          getChapterSpeechSections(osisBook, ch, textSource, workspaceId),
          getChapterWordTagRefs(osisBook, ch, workspaceId),
          getChapterLineIndents(osisBook, ch, workspaceId),
          getChapterRstRelations(osisBook, ch, textSource, workspaceId),
          getChapterWordArrows(osisBook, ch, textSource, workspaceId),
          getChapterWordFormatting(osisBook, ch, workspaceId),
          getChapterSceneBreaks(osisBook, ch, workspaceId),
          getChapterLineAnnotations(osisBook, ch, textSource, workspaceId),
        ])
      )
    ),
  ]);

  // Flatten per-chapter editing data
  const initialParagraphBreakIds     = perChapterResults.flatMap(([p]) => p);
  const initialCharacterRefs         = perChapterResults.flatMap(([, r]) => r);
  const initialSpeechSections        = perChapterResults.flatMap(([,, s]) => s);
  const initialWordTagRefs           = perChapterResults.flatMap(([,,, t]) => t);
  const initialLineIndents           = perChapterResults.flatMap(([,,,, l]) => l);
  const initialRstRelations          = perChapterResults.flatMap(([,,,,, cr]) => cr);
  const initialWordArrows            = perChapterResults.flatMap(([,,,,,, wa]) => wa);
  const initialWordFormatting        = perChapterResults.flatMap(([,,,,,,, wf]) => wf);
  const initialSceneBreaks           = perChapterResults.flatMap(([,,,,,,,, sb]) => sb);
  const initialLineAnnotations       = perChapterResults.flatMap(([,,,,,,,,, la]) => la);

  // Translations — workspace-independent; fetch verses for all chapters in range
  const availableTranslations = await getAvailableTranslationsForChapter(osisBook, passage.startChapter);
  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    availableTranslations.map(async (t) => {
      const versesPerChapter = await Promise.all(
        chapterRange.map((ch) => getTranslationVerses(t.id, osisBook, ch))
      );
      translationVerseData[t.id] = versesPerChapter.flat();
    })
  );

  // ULT: synchronous base text from ult.db for all chapters in the passage
  const ultBaseVerses: { chapter: number; verse: number; text: string }[] = [];
  let ultTranslation: Awaited<ReturnType<typeof getUltTranslation>> = null;
  for (const ch of chapterRange) {
    const verses = getUltVerses(osisBook, ch);
    for (const v of verses) ultBaseVerses.push({ ...v, chapter: ch });
  }
  if (ultBaseVerses.length > 0) {
    ultTranslation = await getUltTranslation();
    if (ultTranslation !== null) {
      const ultEditsPerChapter = await Promise.all(
        chapterRange.map((ch) => getTranslationVerses(ultTranslation!.id, osisBook, ch))
      );
      translationVerseData[ultTranslation.id] = ultEditsPerChapter.flat();
    }
  }

  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  const isHebrew = bookRecord.language === "hebrew";

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
          {bookName}
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

        {/* Back to chapter */}
        <div className="ml-auto">
          <Link
            href={`/${encodeURIComponent(osisBook)}/${textSource}/${passage.startChapter}`}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--nav-fg)" }}
          >
            ← Ch. {passage.startChapter}
          </Link>
        </div>
      </nav>

      {/* Passage content — flex-1 min-h-0 lets PassageView manage its own scrolling */}
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
          bookSceneBreaks={bookSceneBreaks}
          bookMaxVerses={bookMaxVerses}
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
      return {
        title: `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse} — Structura`,
      };
    }
  }
  return { title: `${bookName} Passage — Structura` };
}
