import { notFound } from "next/navigation";
import {
  getSynopticSet,
  getPassageWords,
  getBook,
  getAvailableTranslationsForChapter,
  getUltVerses,
  getUltTranslation,
  getVcbVerses,
  getVcbTranslation,
  getLxxVerseTexts,
  getLxxTranslation,
  getWorkspaceById,
  getAuthorName,
} from "@/lib/db/queries";
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
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import type { Passage } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import SynopticView, { type SynopticColumn } from "@/components/synoptic/SynopticView";
import SynopticDetailNav from "./SynopticDetailNav";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Loads every prop ChapterDisplay needs for one synoptic column, mirroring
 * the data-fetching block in app/[book]/[source]/passage/[id]/page.tsx but
 * simplified for the single-book case (synoptic columns never cross a book
 * boundary — each column IS one book's own range, see DefineSynopticSetDialog).
 */
async function loadColumnData(passage: Passage, workspaceId: number): Promise<SynopticColumn | null> {
  const osisBook = passage.book;
  const textSource = passage.textSource as TextSource;

  const bookRecord = await getBook(osisBook);
  if (!bookRecord) return null;

  const chapterEntries: ChapterLocus[] = [];
  for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) {
    chapterEntries.push({ book: osisBook, chapter: ch });
  }

  const [
    words,
    characters,
    wordTags,
    bookWideData,
    editingData,
    availableTranslations,
  ] = await Promise.all([
    getPassageWords(
      osisBook, textSource,
      passage.startChapter, passage.startVerse,
      passage.endChapter, passage.endVerse
    ),
    resolveVisibleCharacters({ books: [osisBook], chapters: chapterEntries, passageId: passage.id }, workspaceId),
    resolveVisibleWordTags({ books: [osisBook], chapters: chapterEntries, passageId: passage.id }, workspaceId),
    getScriptureLocusBookWideData(
      [{ osisBook, bookId: bookRecord.id, chapterCount: bookRecord.chapterCount }],
      textSource, workspaceId
    ),
    getScriptureLocusEditingData(chapterEntries, textSource, workspaceId),
    getAvailableTranslationsForChapter(osisBook, passage.startChapter),
  ]);

  const {
    initialParagraphBreakIds, initialCharacterRefs, initialSpeechSections,
    initialWordTagRefs, initialLineIndents, initialRstRelations,
    initialWordArrows, initialWordFormatting, initialSceneBreaks,
    initialLineAnnotations, initialTextCriticalMarks,
  } = editingData;
  const { bookSceneBreaks, bookMaxVerses } = bookWideData;

  const translationVerseData = await getScriptureLocusUserTranslationVerses(chapterEntries, availableTranslations);
  const initialTranslationFootnotes = await getScriptureLocusFootnotes(chapterEntries, availableTranslations);

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

  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;
  const refText = passage.startChapter === passage.endChapter
    ? `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endVerse}`
    : `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`;

  return {
    key: String(passage.id),
    label: passage.columnLabel ?? bookName,
    refText,
    props: {
      words,
      book: osisBook,
      chapter: passage.startChapter,
      textSource,
      startBookId: bookRecord.id,
      startBookChapterCount: bookRecord.chapterCount,
      availableTranslations,
      translationVerseData,
      initialParagraphBreakIds,
      initialCharacters: characters,
      initialCharacterRefs,
      initialSpeechSections,
      initialWordTags: wordTags,
      initialWordTagRefs,
      initialLineIndents,
      initialRstRelations,
      initialWordArrows,
      initialWordFormatting,
      initialSceneBreaks,
      initialLineAnnotations,
      bookSceneBreaks,
      bookMaxVerses,
      ultBaseVerses,
      ultTranslation,
      vcbBaseVerses,
      vcbTranslation,
      lxxBaseVerses,
      lxxTranslation,
      initialTextCriticalMarks,
      initialTranslationFootnotes,
    },
  };
}

export default async function SynopticDetailPage({ params }: PageProps) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const workspaceId = await getActiveWorkspaceId();
  const workspace = await getWorkspaceById(workspaceId).catch(() => null);
  const translationOnly = workspace?.translationOnly ?? false;
  const authorName = await getAuthorName(workspaceId).catch(() => null);

  const set = await getSynopticSet(id, workspaceId);
  if (!set || set.columns.length === 0) notFound();

  const loaded = await Promise.all(set.columns.map((col) => loadColumnData(col, workspaceId)));
  const columns: SynopticColumn[] = loaded
    .filter((c): c is SynopticColumn => c !== null)
    .map((c) => ({ ...c, props: { ...c.props, translationOnly } }));

  if (columns.length === 0) notFound();

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "var(--background)" }}>
      <SynopticDetailNav set={set} workspaceId={workspaceId} authorName={authorName} />
      <div className="flex-1 min-h-0">
        <SynopticView columns={columns} />
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return { title: "Synoptic View — Structura" };
  const workspaceId = await getActiveWorkspaceId();
  const set = await getSynopticSet(id, workspaceId).catch(() => null);
  return { title: set ? `${set.title} — Structura` : "Synoptic View — Structura" };
}
