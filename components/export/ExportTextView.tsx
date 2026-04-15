"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import type {
  Word, Character, CharacterRef, SpeechSection,
  WordTag, WordTagRef, ClauseRelationship, WordArrow, LineAnnotation, RstRelation, RstCustomType,
} from "@/lib/db/schema";
import type { Translation, TranslationVerse } from "@/lib/db/schema";
import VerseDisplay from "@/components/text/VerseDisplay";
import ClauseRelationshipOverlay from "@/components/text/ClauseRelationshipOverlay";
import WordArrowOverlay from "@/components/text/WordArrowOverlay";
import RstRelationOverlay from "@/components/text/RstRelationOverlay";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";

interface Props {
  words: Word[];
  book: string;
  chapter: number;
  isHebrew: boolean;
  paragraphBreakIds: string[];
  characters: Character[];
  characterRefs: CharacterRef[];
  speechSections: SpeechSection[];
  wordTags: WordTag[];
  wordTagRefs: WordTagRef[];
  lineIndents: { wordId: string; indentLevel: number }[];
  wordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[];
  sceneBreaks: { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean }[];
  availableTranslations: Translation[];
  translationVerseData: Record<number, TranslationVerse[]>;
  clauseRelationships: ClauseRelationship[];
  wordArrows: WordArrow[];
  lineAnnotations: LineAnnotation[];
  rstRelations: RstRelation[];
}

export default function ExportTextView({
  words,
  book,
  chapter,
  isHebrew,
  paragraphBreakIds: paragraphBreakIdArray,
  characters,
  characterRefs,
  speechSections,
  wordTags,
  wordTagRefs,
  lineIndents,
  wordFormatting,
  sceneBreaks,
  availableTranslations,
  translationVerseData,
  clauseRelationships,
  wordArrows,
  lineAnnotations,
  rstRelations,
}: Props) {
  // ── Refs for overlay positioning ─────────────────────────────────────────
  // outerRef: non-clipping wrapper — WordArrowOverlay SVG positions relative to this
  // containerRef: content container — ClauseRelationshipOverlay SVG + DOM queries
  const outerRef     = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Custom RST types (fetched on mount, same as ChapterDisplay) ─────────────
  const [customRstTypes, setCustomRstTypes] = useState<RstCustomType[]>([]);
  useEffect(() => {
    fetch("/api/rst-custom-types")
      .then((r) => r.json())
      .then((rows: RstCustomType[]) => setCustomRstTypes(rows))
      .catch(() => {});
  }, []);
  const allRstTypes = useMemo<RstTypeEntry[]>(
    () => [...RELATIONSHIP_TYPES, ...customRstTypes],
    [customRstTypes],
  );

  // ── Active translations (read from localStorage, same keys as ChapterDisplay) ──
  // Start empty; populate after mount so we never try to read localStorage on the server.
  const [activeAbbrs, setActiveAbbrs] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("structura:activeTranslations");
      const abbrs: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      setActiveAbbrs(new Set(abbrs));
    } catch {
      // ignore parse errors
    }
    setMounted(true);
  }, []);

  // ── Build lookup maps ───────────────────────────────────────────────────
  const paragraphBreakIds = useMemo(
    () => new Set(paragraphBreakIdArray),
    [paragraphBreakIdArray]
  );

  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  const characterRefMap = useMemo(
    () => new Map(characterRefs.map((r) => [r.wordId, r])),
    [characterRefs]
  );

  // wordId → SpeechSection[] sorted largest-range-first (outermost → innermost).
  const wordSpeechMap = useMemo<Map<string, SpeechSection[]>>(() => {
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));
    const sorted = [...speechSections].sort((a, b) => {
      const aLen = (posMap.get(a.endWordId) ?? 0) - (posMap.get(a.startWordId) ?? 0);
      const bLen = (posMap.get(b.endWordId) ?? 0) - (posMap.get(b.startWordId) ?? 0);
      return bLen - aLen;
    });
    const result = new Map<string, SpeechSection[]>();
    for (const section of sorted) {
      const si = posMap.get(section.startWordId) ?? -1;
      const ei = posMap.get(section.endWordId)   ?? -1;
      if (si < 0 || ei < 0) continue;
      for (let i = si; i <= ei; i++) {
        const wid = words[i].wordId;
        const arr = result.get(wid);
        if (arr) arr.push(section);
        else result.set(wid, [section]);
      }
    }
    return result;
  }, [words, speechSections]);

  const wordTagMap = useMemo(
    () => new Map(wordTags.map((t) => [t.id, t])),
    [wordTags]
  );

  const wordTagRefMap = useMemo(
    () => new Map(wordTagRefs.map((r) => [r.wordId, r])),
    [wordTagRefs]
  );

  const lineIndentMap = useMemo(
    () => new Map(lineIndents.map((li) => [li.wordId, li.indentLevel])),
    [lineIndents]
  );

  // wordId → first wordId of its paragraph segment.
  // Verse boundaries reset the paragraph start so indent levels from the last
  // segment of verse N never leak into the first segment of verse N+1.
  const wordToParaStart = useMemo(() => {
    const map = new Map<string, string>();
    let currentStart = words[0]?.wordId ?? "";
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (i > 0 && words[i - 1].verse !== word.verse) currentStart = word.wordId;
      if (paragraphBreakIds.has(word.wordId)) currentStart = word.wordId;
      map.set(word.wordId, currentStart);
    }
    return map;
  }, [words, paragraphBreakIds]);

  const wordFormattingMap = useMemo(
    () => new Map(wordFormatting.map((f) => [f.wordId, { isBold: f.isBold, isItalic: f.isItalic }])),
    [wordFormatting]
  );

  const sceneBreakMap = useMemo(() => {
    const m = new Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }>>();
    for (const sb of sceneBreaks) {
      const arr = m.get(sb.wordId) ?? [];
      arr.push({ heading: sb.heading, level: sb.level, verse: sb.verse, outOfSequence: sb.outOfSequence, extendedThrough: null });
      m.set(sb.wordId, arr);
    }
    return m;
  }, [sceneBreaks]);

  // First word of every paragraph segment — needed by ClauseRelationshipOverlay
  const paragraphFirstWordIds = useMemo(() => {
    if (!words.length) return [];
    return words
      .filter((w, i) =>
        i === 0 ||
        paragraphBreakIds.has(w.wordId) ||
        words[i - 1].verse !== w.verse
      )
      .map((w) => w.wordId);
  }, [words, paragraphBreakIds]);

  // ── Annotation coverage map (mirrors ChapterDisplay logic) ───────────────
  type SegAnnotationEntry = { annotation: LineAnnotation; isStart: boolean; isEnd: boolean };
  const annotationsBySegment = useMemo<Map<string, SegAnnotationEntry[]>>(() => {
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const map = new Map<string, SegAnnotationEntry[]>();
    for (const ann of lineAnnotations) {
      const startPos = posMap.get(ann.startWordId) ?? -1;
      const endPos   = posMap.get(ann.endWordId)   ?? -1;
      if (startPos < 0) continue;
      const lo = startPos;
      const hi = endPos >= 0 ? Math.max(startPos, endPos) : startPos;
      for (let i = lo; i <= hi; i++) {
        const segId = segIds[i];
        if (!map.has(segId)) map.set(segId, []);
        map.get(segId)!.push({ annotation: ann, isStart: i === lo, isEnd: i === hi });
      }
    }
    return map;
  }, [lineAnnotations, paragraphFirstWordIds]);

  const themeColorsByLabel = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const ann of lineAnnotations) {
      if (ann.annotType === "theme" && !map.has(ann.label)) {
        map.set(ann.label, ann.color);
      }
    }
    return map;
  }, [lineAnnotations]);

  // ── Group words by verse ──────────────────────────────────────────────
  const verseGroups = useMemo(() => {
    const map = new Map<number, Word[]>();
    for (const w of words) {
      if (!map.has(w.verse)) map.set(w.verse, []);
      map.get(w.verse)!.push(w);
    }
    return map;
  }, [words]);

  const verseNums = useMemo(
    () => [...verseGroups.keys()].sort((a, b) => a - b),
    [verseGroups]
  );

  // ── Translation text entries per verse (only user's active translations) ──
  // After mount we know which abbreviations are active; before mount show nothing
  // (same behaviour as ChapterDisplay which also starts with no active translations).
  const translationVerseMap = useMemo(() => {
    if (!mounted) return new Map<number, { abbr: string; text: string }[]>();
    const map = new Map<number, { abbr: string; text: string }[]>();
    for (const t of availableTranslations) {
      if (!activeAbbrs.has(t.abbreviation)) continue;
      const verses = translationVerseData[t.id] ?? [];
      for (const v of verses) {
        if (!map.has(v.verse)) map.set(v.verse, []);
        map.get(v.verse)!.push({ abbr: t.abbreviation, text: v.text });
      }
    }
    return map;
  }, [mounted, activeAbbrs, availableTranslations, translationVerseData]);

  const hasTranslation =
    mounted && availableTranslations.some((t) => activeAbbrs.has(t.abbreviation));

  // ── Noop callbacks (read-only view) ───────────────────────────────────
  const noop = () => {};
  const noopWord = (_w: Word) => {};

  return (
    // outerRef: full-width wrapper — WordArrowOverlay SVG is absolute inside this
    <div ref={outerRef} style={{ position: "relative" }}>
      <WordArrowOverlay
        arrows={wordArrows}
        containerRef={containerRef}
        outerRef={outerRef}
        editing={false}
        selectedFromWordId={null}
        onDeleteArrow={noop}
      />

      {/* containerRef: content container — ClauseRelationshipOverlay SVG is absolute inside this */}
      <div ref={containerRef} className="relative px-6 py-6 max-w-4xl mx-auto">
        <ClauseRelationshipOverlay
          relationships={clauseRelationships}
          containerRef={containerRef}
          isHebrew={isHebrew}
          hasTranslation={hasTranslation}
          hasSource={true}
          editing={false}
          paragraphFirstWordIds={paragraphFirstWordIds}
          selectedSegWordId={null}
          onSelectSegment={noop}
          onDeleteRelationship={noop}
        />
        <RstRelationOverlay
          relations={rstRelations}
          containerRef={containerRef}
          isHebrew={isHebrew}
          hasTranslation={hasTranslation}
          editing={false}
          paragraphFirstWordIds={paragraphFirstWordIds}
          selectedNucleusWordId={null}
          selectedSatelliteWordId={null}
          editingGroupId={null}
          onSelectSegment={noop}
          onDeleteGroup={noop}
          customTypes={allRstTypes}
        />

        {verseNums.map((verseNum) => {
          const verseWords = verseGroups.get(verseNum)!;
          const allWordIds = words.map((w) => w.wordId);
          const firstWordIdx = allWordIds.indexOf(verseWords[0].wordId);
          const prevVerseLastWordId = firstWordIdx > 0 ? words[firstWordIdx - 1].wordId : null;
          const lastWordIdx = allWordIds.indexOf(verseWords[verseWords.length - 1].wordId);
          const nextVerseFirstWordId = lastWordIdx < words.length - 1 ? words[lastWordIdx + 1].wordId : null;

          return (
            <VerseDisplay
              key={verseNum}
              verseNum={verseNum}
              words={verseWords}
              displayMode="clean"
              grammarFilter={{
                noun: true, verb: true, adjective: true, adverb: true,
                preposition: true, conjunction: true, pronoun: true,
                particle: true, article: true, interjection: true,
              }}
              colorRules={[]}
              onSelectWord={noopWord}
              selectedWordId={null}
              isHebrew={isHebrew}
              showTooltips={false}
              translationTexts={translationVerseMap.get(verseNum) ?? []}
              useLinguisticTerms={false}
              paragraphBreakIds={paragraphBreakIds}
              editingParagraphs={false}
              characterRefMap={characterRefMap}
              characterMap={characterMap}
              wordSpeechMap={wordSpeechMap}
              prevVerseLastWordId={prevVerseLastWordId}
              nextVerseFirstWordId={nextVerseFirstWordId}
              editingRefs={false}
              editingSpeech={false}
              activeCharId={null}
              speechRangeStartWordId={null}
              book={book}
              chapter={chapter}
              onSelectTranslationWord={noop}
              onToggleTranslationParagraphBreak={noop}
              highlightCharIds={new Set()}
              onDeleteSpeechSection={noop}
              wordTagRefMap={wordTagRefMap}
              wordTagMap={wordTagMap}
              editingWordTags={false}
              highlightWordTagIds={new Set()}
              lineIndentMap={lineIndentMap}
              wordToParaStart={wordToParaStart}
              editingIndents={false}
              onSetSegmentIndent={noop}
              wordFormattingMap={wordFormattingMap}
              editingFormatting={false}
              sceneBreakMap={sceneBreakMap}
              editingScenes={false}
              annotationsBySegment={annotationsBySegment}
              themeColorsByLabel={themeColorsByLabel}
              editingAnnotations={false}
              annotRangeStartWordId={null}
              annotRangeEndWordId={null}
              showAnnotationCol={lineAnnotations.length > 0}
              rstSourcePad={rstRelations.length > 0 ? 48 : 0}
            />
          );
        })}
      </div>
    </div>
  );
}
