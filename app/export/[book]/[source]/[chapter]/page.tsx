export const dynamic = "force-dynamic";

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
  getTranslations,
  getTranslationVerses,
  getChapterTranslationFootnotes,
  getChapterWordArrows,
  getChapterSceneBreaks,
  getChapterLineAnnotations,
  getChapterRstRelations,
  getAuthorName,
  getUltTranslation,
  getUltVerses,
  getVcbTranslation,
  getVcbVerses,
  getNoteContents,
} from "@/lib/db/queries";
import type { TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import ExportLayout, { type ExportPrintHeader } from "@/components/export/ExportLayout";
import ExportTextView from "@/components/export/ExportTextView";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { tiptapToHtml } from "@/lib/utils/tiptap-text";
import { parseExportViewParams, getInterlinearExportData } from "@/lib/export/interlinearExportData";

interface PageProps {
  params: Promise<{ book: string; source: string; chapter: string }>;
  searchParams?: Promise<{ t?: string; mode?: string; sub?: string; [key: string]: string | string[] | undefined }>;
}

export default async function ExportChapterPage({ params, searchParams }: PageProps) {
  const { book, source, chapter: chapterStr } = await params;
  const sp = searchParams ? await searchParams : {};
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
    getTranslations(workspaceId),
    getChapterWordArrows(osisBook, chapter, textSource, workspaceId),
    getChapterLineAnnotations(osisBook, chapter, textSource, workspaceId),
    getChapterRstRelations(osisBook, chapter, textSource, workspaceId),
  ]);

  // Include built-in ULT and VCB translations (same as ChapterDisplay does).
  // These are not returned by getTranslations() so must be fetched separately.
  const ultBaseVerses = getUltVerses(osisBook, chapter);
  const vcbBaseVerses = getVcbVerses(osisBook, chapter);
  const [ultTranslation, vcbTranslation] = await Promise.all([
    ultBaseVerses.length > 0 ? getUltTranslation(workspaceId) : Promise.resolve(null),
    vcbBaseVerses.length > 0 ? getVcbTranslation(workspaceId) : Promise.resolve(null),
  ]);
  // Merge ULT/VCB with user translations, then deduplicate by abbreviation so a
  // custom translation named the same as a built-in never creates two entries with
  // the same key in the rendered translation list.
  const allTranslationsRaw = [
    ...(ultTranslation && !availableTranslations.some(t => t.id === ultTranslation.id) ? [ultTranslation] : []),
    ...availableTranslations,
    ...(vcbTranslation && !availableTranslations.some(t => t.id === vcbTranslation.id) ? [vcbTranslation] : []),
  ];
  const _seenAbbr = new Set<string>();
  const allTranslations = allTranslationsRaw.filter(t => {
    const key = t.abbreviation.toLowerCase();
    if (_seenAbbr.has(key)) return false;
    _seenAbbr.add(key);
    return true;
  });

  // If the caller passed ?t=ESV,NIV (written by NavLinks from localStorage),
  // show only those translations.  No ?t= means the user has no translation
  // active, so show nothing.  Case-insensitive comparison guards against minor
  // casing differences between localStorage and the DB abbreviation.
  // No fallback-to-all: showing all when only one was intended is more confusing
  // than showing none.
  const requestedAbbrs = sp.t
    ? String(sp.t).split(",").map((a) => decodeURIComponent(a.trim())).filter(Boolean)
    : null;
  const visibleTranslations = requestedAbbrs === null
    ? []
    : allTranslations.filter((t) =>
        requestedAbbrs.some((abbr) => abbr.toLowerCase() === t.abbreviation.toLowerCase())
      );

  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    visibleTranslations.map(async (t) => {
      translationVerseData[t.id] = await getTranslationVerses(t.id, osisBook, chapter, workspaceId);
    })
  );

  // Merge ULT/VCB base verses with any user edits (same logic as ChapterDisplay).
  // DB rows are user edits that override the static base text.
  if (ultTranslation && ultBaseVerses.length > 0 && visibleTranslations.some(t => t.id === ultTranslation.id)) {
    const editedMap = new Map((translationVerseData[ultTranslation.id] ?? []).map(v => [v.verse, v]));
    translationVerseData[ultTranslation.id] = ultBaseVerses.map((base, i) =>
      editedMap.get(base.verse) ?? {
        id: -(i + 1), workspaceId: ultTranslation!.workspaceId,
        translationId: ultTranslation!.id, osisRef: `${osisBook}.${chapter}.${base.verse}`,
        bookId: 0, chapter, verse: base.verse, text: base.text,
      }
    );
  }
  if (vcbTranslation && vcbBaseVerses.length > 0 && visibleTranslations.some(t => t.id === vcbTranslation.id)) {
    const editedMap = new Map((translationVerseData[vcbTranslation.id] ?? []).map(v => [v.verse, v]));
    translationVerseData[vcbTranslation.id] = vcbBaseVerses.map((base, i) =>
      editedMap.get(base.verse) ?? {
        id: -(i + 1), workspaceId: vcbTranslation!.workspaceId,
        translationId: vcbTranslation!.id, osisRef: `${osisBook}.${chapter}.${base.verse}`,
        bookId: 0, chapter, verse: base.verse, text: base.text,
      }
    );
  }

  // Fetch footnotes for all visible translations (user-created, ULT, and VCB).
  const translationFootnoteData: Record<number, TranslationFootnote[]> = {};
  await Promise.all(
    visibleTranslations.map(async (t) => {
      translationFootnoteData[t.id] = await getChapterTranslationFootnotes(t.id, osisBook, chapter);
    })
  );

  const activeTranslationAbbrevs = visibleTranslations
    .filter((t) => (translationVerseData[t.id]?.length ?? 0) > 0)
    .map((t) => t.abbreviation);

  // Reproduce whatever interlinear sub-mode (if any) was active in the live
  // view when the user clicked Export — see NavLinks.tsx/PassageExportLink.tsx.
  const { displayMode, interlinearSubMode } = parseExportViewParams(sp);
  const interlinearData = await getInterlinearExportData({
    osisBook, chapters: [chapter], textSource, workspaceId,
    translationAbbrs: activeTranslationAbbrevs,
    displayMode, interlinearSubMode,
  });

  const bookName   = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  const isHebrew   = words[0]?.language === "hebrew";
  const filename   = `${osisBook}-${chapter}`;
  const authorName = await getAuthorName(workspaceId);
  const revealHref = `/api/export/reveal?book=${encodeURIComponent(osisBook)}&source=${textSource}&chapter=${chapter}`;

  // Build note keys for every verse in this chapter plus the chapter-level note.
  const verseNums = [...new Set(words.map((w) => w.verse))].sort((a, b) => a - b);
  const metaKey   = `meta:chapter:${osisBook}.${chapter}`;
  const sermonKey = `sermon:chapter:${osisBook}.${chapter}`;
  const noteContext = {
    title: `${bookName} ${chapter}`,
    keys: [
      sermonKey,
      `chapter:${osisBook}.${chapter}`,
      ...verseNums.map((v) => `verse:${osisBook}.${chapter}.${v}`),
    ],
    metaKey,
  };

  // Fetch meta + sermon notes for the print header
  const noteContents = await getNoteContents([metaKey, sermonKey], workspaceId);
  const rawMeta = noteContents[metaKey] ?? "{}";
  let parsedMeta: { mainIdea?: string; customFields?: Array<{ id: string; name: string; value: string }> } = {};
  try { parsedMeta = JSON.parse(rawMeta); } catch { /* ignore */ }
  const outlineHtml = tiptapToHtml(noteContents[sermonKey] ?? "{}");

  const printHeader: ExportPrintHeader = {
    title: `${bookName} ${chapter}`,
    subtitle: `Structura · ${[textSource, ...activeTranslationAbbrevs].join(" – ")}`,
    authorName: authorName || undefined,
    mainIdea: parsedMeta.mainIdea || undefined,
    outlineHtml: outlineHtml || undefined,
    customFields: parsedMeta.customFields ?? [],
  };

  return (
    <div data-export-page style={{ backgroundColor: "var(--background)", minHeight: "100vh" }}>
      <ExportLayout revealHref={revealHref} filename={filename} backHref={`/${encodeURIComponent(osisBook)}/${textSource}/${chapter}`} noteContext={noteContext} printHeader={printHeader}>
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
          availableTranslations={visibleTranslations}
          translationVerseData={translationVerseData}
          translationFootnoteData={translationFootnoteData}
          wordArrows={wordArrows}
          lineAnnotations={lineAnnotations}
          rstRelations={rstRelations}
          displayMode={displayMode}
          interlinearSubMode={interlinearSubMode}
          constituentLabelMap={interlinearData.constituentLabelMap}
          constituentGroupMap={interlinearData.constituentGroupMap}
          transliterationFormatMap={interlinearData.transliterationFormatMap}
          datasetEntryMap={interlinearData.datasetEntryMap}
          datasetGroupMap={interlinearData.datasetGroupMap}
          datasetLabelColors={interlinearData.datasetLabelColors}
          datasetDirection={interlinearData.datasetDirection}
        />
      </ExportLayout>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { book, chapter } = await params;
  const osisBook  = decodeURIComponent(book);
  const bookName  = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  return { title: `Export ${bookName} ${chapter} — Structura` };
}
