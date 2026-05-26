export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import {
  getPassage,
  getPassageWords,
  getBook,
  getCharacters,
  getWordTags,
  getChapterParagraphBreaks,
  getChapterCharacterRefs,
  getChapterSpeechSections,
  getChapterWordTagRefs,
  getChapterLineIndents,
  getChapterWordFormatting,
  getTranslations,
  getTranslationVerses,
  getChapterTranslationFootnotes,
  getChapterClauseRelationships,
  getChapterWordArrows,
  getChapterSceneBreaks,
  getChapterLineAnnotations,
  getChapterRstRelations,
  getAuthorName,
  getUltTranslation,
  getUltVerses,
  getVcbTranslation,
  getVcbVerses,
} from "@/lib/db/queries";
import type { TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { TextSource } from "@/lib/morphology/types";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import ExportLayout from "@/components/export/ExportLayout";
import ExportTextView from "@/components/export/ExportTextView";
import { getActiveWorkspaceId } from "@/lib/workspace";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ t?: string; [key: string]: string | string[] | undefined }>;
}

export default async function ExportPassagePage({ params, searchParams }: PageProps) {
  const { id: idStr } = await params;
  const sp = searchParams ? await searchParams : {};
  const id = parseInt(idStr, 10);

  if (isNaN(id)) notFound();

  const passage = await getPassage(id);
  if (!passage) notFound();

  const workspaceId = await getActiveWorkspaceId();

  const osisBook   = passage.book;
  const textSource = passage.textSource as TextSource;

  const [bookRecord, words] = await Promise.all([
    getBook(osisBook),
    getPassageWords(
      osisBook, textSource,
      passage.startChapter, passage.startVerse,
      passage.endChapter,   passage.endVerse,
    ),
  ]);

  if (!bookRecord) notFound();
  if (!words || words.length === 0) notFound();

  // Build the list of chapters covered by this passage
  const chapterRange: number[] = [];
  for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) chapterRange.push(ch);

  const [characters, wordTags, perChapterResults, availableTranslations] = await Promise.all([
    getCharacters(osisBook, workspaceId),
    getWordTags(osisBook, workspaceId),
    Promise.all(
      chapterRange.map((ch) =>
        Promise.all([
          getChapterParagraphBreaks(osisBook, ch, workspaceId),
          getChapterCharacterRefs(osisBook, ch, workspaceId),
          getChapterSpeechSections(osisBook, ch, textSource, workspaceId),
          getChapterWordTagRefs(osisBook, ch, workspaceId),
          getChapterLineIndents(osisBook, ch, workspaceId),
          getChapterWordFormatting(osisBook, ch, workspaceId),
          getChapterSceneBreaks(osisBook, ch, workspaceId),
          getChapterClauseRelationships(osisBook, ch, textSource, workspaceId),
          getChapterWordArrows(osisBook, ch, textSource, workspaceId),
          getChapterLineAnnotations(osisBook, ch, textSource, workspaceId),
          getChapterRstRelations(osisBook, ch, textSource, workspaceId),
        ])
      )
    ),
    getTranslations(workspaceId),
  ]);

  // Flatten per-chapter data
  const paragraphBreakIds   = perChapterResults.flatMap(([p]) => p);
  const characterRefs       = perChapterResults.flatMap(([, r]) => r);
  const speechSections      = perChapterResults.flatMap(([,, s]) => s);
  const wordTagRefs         = perChapterResults.flatMap(([,,, t]) => t);
  const lineIndents         = perChapterResults.flatMap(([,,,, l]) => l);
  const wordFormatting      = perChapterResults.flatMap(([,,,,, f]) => f);
  const sceneBreaks         = perChapterResults.flatMap(([,,,,,, sb]) => sb);
  const clauseRelationships = perChapterResults.flatMap(([,,,,,,, cr]) => cr);
  const wordArrows          = perChapterResults.flatMap(([,,,,,,,, wa]) => wa);
  const lineAnnotations     = perChapterResults.flatMap(([,,,,,,,,, la]) => la);
  const rstRelations        = perChapterResults.flatMap(([,,,,,,,,,, rr]) => rr);

  // Include built-in ULT and VCB translations (same as ChapterDisplay does).
  const ultBaseVersesByChapter = new Map(
    chapterRange.map((ch) => [ch, getUltVerses(osisBook, ch)])
  );
  const vcbBaseVersesByChapter = new Map(
    chapterRange.map((ch) => [ch, getVcbVerses(osisBook, ch)])
  );
  const hasUltBase = [...ultBaseVersesByChapter.values()].some(v => v.length > 0);
  const hasVcbBase = [...vcbBaseVersesByChapter.values()].some(v => v.length > 0);
  const [ultTranslation, vcbTranslation] = await Promise.all([
    hasUltBase ? getUltTranslation(workspaceId) : Promise.resolve(null),
    hasVcbBase ? getVcbTranslation(workspaceId) : Promise.resolve(null),
  ]);
  const allTranslations = [
    ...(ultTranslation && !availableTranslations.some(t => t.id === ultTranslation.id) ? [ultTranslation] : []),
    ...availableTranslations,
    ...(vcbTranslation && !availableTranslations.some(t => t.id === vcbTranslation.id) ? [vcbTranslation] : []),
  ];

  // If the caller passed ?t=ESV,NIV (written by PassageExportLink from localStorage),
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

  // Translation verses for all covered chapters
  const translationVerseData: Record<number, TranslationVerse[]> = {};
  await Promise.all(
    visibleTranslations.map(async (t) => {
      const versesPerChapter = await Promise.all(
        chapterRange.map((ch) => getTranslationVerses(t.id, osisBook, ch, workspaceId))
      );
      translationVerseData[t.id] = versesPerChapter.flat();
    })
  );

  // Merge ULT/VCB base verses with user edits (same logic as ChapterDisplay).
  if (ultTranslation && hasUltBase && visibleTranslations.some(t => t.id === ultTranslation.id)) {
    const allBase = chapterRange.flatMap(ch =>
      (ultBaseVersesByChapter.get(ch) ?? []).map((base, i) => ({ ...base, chapter: ch, idx: i }))
    );
    const editedMap = new Map((translationVerseData[ultTranslation.id] ?? []).map(v => [`${v.chapter}:${v.verse}`, v]));
    translationVerseData[ultTranslation.id] = allBase.map(base =>
      editedMap.get(`${base.chapter}:${base.verse}`) ?? {
        id: -(base.idx + 1), workspaceId: ultTranslation!.workspaceId,
        translationId: ultTranslation!.id, osisRef: `${osisBook}.${base.chapter}.${base.verse}`,
        bookId: 0, chapter: base.chapter, verse: base.verse, text: base.text,
      }
    );
  }
  if (vcbTranslation && hasVcbBase && visibleTranslations.some(t => t.id === vcbTranslation.id)) {
    const allBase = chapterRange.flatMap(ch =>
      (vcbBaseVersesByChapter.get(ch) ?? []).map((base, i) => ({ ...base, chapter: ch, idx: i }))
    );
    const editedMap = new Map((translationVerseData[vcbTranslation.id] ?? []).map(v => [`${v.chapter}:${v.verse}`, v]));
    translationVerseData[vcbTranslation.id] = allBase.map(base =>
      editedMap.get(`${base.chapter}:${base.verse}`) ?? {
        id: -(base.idx + 1), workspaceId: vcbTranslation!.workspaceId,
        translationId: vcbTranslation!.id, osisRef: `${osisBook}.${base.chapter}.${base.verse}`,
        bookId: 0, chapter: base.chapter, verse: base.verse, text: base.text,
      }
    );
  }

  const translationFootnoteData: Record<number, TranslationFootnote[]> = {};
  await Promise.all(
    visibleTranslations.map(async (t) => {
      const footnotesPerChapter = await Promise.all(
        chapterRange.map((ch) => getChapterTranslationFootnotes(t.id, osisBook, ch))
      );
      translationFootnoteData[t.id] = footnotesPerChapter.flat();
    })
  );

  const activeTranslationAbbrevs = visibleTranslations
    .filter((t) => (translationVerseData[t.id]?.length ?? 0) > 0)
    .map((t) => t.abbreviation);

  const bookName   = OSIS_REF_BOOK_NAMES[osisBook] ?? osisBook;
  const isHebrew   = bookRecord.language === "hebrew";
  const authorName = await getAuthorName(workspaceId);

  // Use first chapter for API route (single chapter passages most common)
  // For multi-chapter passages, include passageId
  const passageLabel = passage.label
    || `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`;
  const filename = `passage-${id}`;
  const revealHref = `/api/export/reveal?passageId=${id}`;

  // Build note keys: passage-level, then per-chapter, then per-verse (ordered).
  const verseRefsSorted = [...new Set(words.map((w) => `${w.chapter}:${w.verse}`))]
    .sort((a, b) => {
      const [ac, av] = a.split(":").map(Number);
      const [bc, bv] = b.split(":").map(Number);
      return ac !== bc ? ac - bc : av - bv;
    });
  const noteContext = {
    title: passageLabel,
    keys: [
      `passage:${id}`,
      ...chapterRange.map((ch) => `chapter:${osisBook}.${ch}`),
      ...verseRefsSorted.map((ref) => { const [ch, v] = ref.split(":"); return `verse:${osisBook}.${ch}.${v}`; }),
    ],
  };

  return (
    <div data-export-page style={{ backgroundColor: "var(--background)", minHeight: "100vh" }}>
      {/* Print header — visible only in print */}
      <div className="hidden print:block px-8 pt-6 pb-2">
        <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.25rem", fontWeight: "bold" }}>
          {passageLabel}
        </h1>
        <p style={{ fontSize: "0.75rem", color: "#78716c" }}>Structura · {[textSource, ...activeTranslationAbbrevs].join(" – ")}</p>
        {authorName && (
          <p style={{ fontSize: "0.75rem", color: "#78716c" }}>Author: {authorName}</p>
        )}
      </div>

      <ExportLayout revealHref={revealHref} filename={filename} backHref={`/${encodeURIComponent(osisBook)}/${textSource}/passage/${id}`} noteContext={noteContext}>
        <div className="px-6 pt-4 pb-2 print:hidden" style={{ borderBottom: "1px solid var(--border)" }}>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: "bold",
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: "var(--foreground)",
            }}
          >
            {passageLabel}
          </h1>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>
            {words.length.toLocaleString()} words · {textSource}
          </p>
        </div>

        <ExportTextView
          words={words}
          book={osisBook}
          chapter={passage.startChapter}
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
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!isNaN(id)) {
    const passage = await getPassage(id);
    if (passage) {
      const bookName = OSIS_REF_BOOK_NAMES[passage.book] ?? passage.book;
      const label    = passage.label
        || `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`;
      return { title: `Export ${label} — Structura` };
    }
  }
  return { title: "Export Passage — Structura" };
}
