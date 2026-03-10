"use client";

import type { Word, CharacterRef, Character, SpeechSection, WordTag, WordTagRef } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry } from "@/lib/morphology/types";
import type { ColorRule } from "@/lib/morphology/colorRules";
import WordToken from "./WordToken";

interface VerseDisplayProps {
  verseNum: number;
  words: Word[];
  displayMode: DisplayMode;
  grammarFilter: GrammarFilterState;
  colorRules: ColorRule[];
  onSelectWord: (word: Word, shiftHeld?: boolean) => void;
  selectedWordId: string | null;
  isHebrew: boolean;
  showTooltips: boolean;
  translationTexts: TranslationTextEntry[];
  useLinguisticTerms: boolean;
  paragraphBreakIds: Set<string>;
  editingParagraphs: boolean;
  // Character tagging
  characterRefMap: Map<string, CharacterRef>;
  characterMap: Map<number, Character>;
  wordSpeechMap: Map<string, SpeechSection>;
  prevVerseLastWordId: string | null;
  nextVerseFirstWordId: string | null;
  editingRefs: boolean;
  editingSpeech: boolean;
  activeCharId: number | null;
  speechRangeStartWordId: string | null;
  // Translation word tagging
  book: string;
  chapter: number;
  onSelectTranslationWord: (wordId: string, abbr: string) => void;
  // Translation paragraph breaks
  onToggleTranslationParagraphBreak: (wordId: string, abbr: string) => void;
  // Character highlight
  highlightCharIds: Set<number>;
  // Speech section delete (via × button)
  onDeleteSpeechSection: (sectionId: number) => void;
  // Word / concept tag highlighting
  wordTagRefMap: Map<string, WordTagRef>;
  wordTagMap: Map<number, WordTag>;
  editingWordTags: boolean;
  highlightWordTagIds: Set<number>;
  // Paragraph indentation
  lineIndentMap: Map<string, number>;
  wordToParaStart: Map<string, string>;
  editingIndents: boolean;
  onSetSegmentIndent: (paraStartWordId: string, level: number) => void;
  // Bold / italic formatting
  wordFormattingMap?: Map<string, { isBold: boolean; isItalic: boolean }>;
  editingFormatting?: boolean;
  // Source text visibility
  hideSourceText?: boolean;
  // Translation text editing
  editingTranslation?: boolean;
  onUpdateTranslationVerse?: (abbr: string, verse: number, newText: string) => void;
}

// Split a word array into paragraph segments at break boundaries.
function computeSegments(ws: Word[], breakIds: Set<string>): Word[][] {
  const segs: Word[][] = [];
  let cur: Word[] = [];
  ws.forEach((w, i) => {
    if (i > 0 && breakIds.has(w.wordId)) { segs.push(cur); cur = []; }
    cur.push(w);
  });
  if (cur.length > 0) segs.push(cur);
  return segs;
}

export default function VerseDisplay({
  verseNum,
  words,
  displayMode,
  grammarFilter,
  colorRules,
  onSelectWord,
  selectedWordId,
  isHebrew,
  showTooltips,
  translationTexts,
  useLinguisticTerms,
  paragraphBreakIds,
  editingParagraphs,
  characterRefMap,
  characterMap,
  wordSpeechMap,
  prevVerseLastWordId,
  nextVerseFirstWordId,
  editingRefs,
  editingSpeech,
  activeCharId: _activeCharId,
  speechRangeStartWordId,
  book,
  chapter,
  onSelectTranslationWord,
  onToggleTranslationParagraphBreak,
  highlightCharIds,
  onDeleteSpeechSection,
  wordTagRefMap,
  wordTagMap,
  editingWordTags,
  highlightWordTagIds,
  lineIndentMap,
  wordToParaStart,
  editingIndents,
  onSetSegmentIndent,
  wordFormattingMap = new Map() as Map<string, { isBold: boolean; isItalic: boolean }>,
  editingFormatting = false,
  hideSourceText = false,
  editingTranslation = false,
  onUpdateTranslationVerse,
}: VerseDisplayProps) {
  const firstWordId = words[0]?.wordId;
  const verseStartsNewParagraph = firstWordId ? paragraphBreakIds.has(firstWordId) : false;

  const pilcrowClass = editingParagraphs
    ? "text-amber-500"
    : "text-stone-300 dark:text-stone-600";

  // ── Paragraph segments ──────────────────────────────────────────────────
  const sourceSegments = computeSegments(words, paragraphBreakIds);
  const multiSeg = sourceSegments.length > 1;
  const paraLabels = sourceSegments.map((_, si) =>
    multiSeg ? `${verseNum}${String.fromCharCode(97 + si)}` : `${verseNum}`
  );

  // ── Cross-verse speech continuation ──────────────────────────────────────
  // When a speech section bridges into/from a neighbouring verse we collapse
  // the gap between those verse rows so the coloured box appears unbroken.
  const crossFirstWord = sourceSegments[0]?.[0] ?? null;
  const crossLastSeg   = sourceSegments[sourceSegments.length - 1];
  const crossLastWord  = crossLastSeg[crossLastSeg.length - 1] ?? null;
  const crossPrevSec   = prevVerseLastWordId
    ? (wordSpeechMap.get(prevVerseLastWordId) ?? null) : null;
  const crossFirstSec  = crossFirstWord
    ? (wordSpeechMap.get(crossFirstWord.wordId) ?? null) : null;
  const speechContinuesFromPrev =
    !!(crossPrevSec && crossFirstSec && crossPrevSec.id === crossFirstSec.id);
  const crossNextSec  = nextVerseFirstWordId
    ? (wordSpeechMap.get(nextVerseFirstWordId) ?? null) : null;
  const crossLastSec2 = crossLastWord
    ? (wordSpeechMap.get(crossLastWord.wordId) ?? null) : null;
  const speechContinuesIntoNext =
    !!(crossNextSec && crossLastSec2 && crossNextSec.id === crossLastSec2.id);

  // Dashed separator shown above verses that start a new paragraph
  const verseSeparator = verseStartsNewParagraph ? (
    <div
      className={`w-full border-t border-dashed mb-2 ${
        editingParagraphs
          ? "border-amber-400"
          : "border-stone-300 dark:border-stone-600"
      }`}
      aria-hidden="true"
    />
  ) : null;

  // ── Speech box helpers ──────────────────────────────────────────────────
  type SegSpeechData = {
    segSpeech: SpeechSection | null;
    segSpeaker: Character | null;
    isSegStart: boolean;
    isSegEnd: boolean;
  };

  function getSegSpeech(seg: Word[], si: number): SegSpeechData {
    const segFirstSec = wordSpeechMap.get(seg[0].wordId) ?? null;
    const segLastSec  = wordSpeechMap.get(seg[seg.length - 1].wordId) ?? null;
    const segSpeech   = (segFirstSec && segLastSec && segFirstSec.id === segLastSec.id)
      ? segFirstSec : null;
    const segSpeaker  = segSpeech ? (characterMap.get(segSpeech.characterId) ?? null) : null;

    const prevWordId = si === 0
      ? prevVerseLastWordId
      : (sourceSegments[si - 1][sourceSegments[si - 1].length - 1]?.wordId ?? null);
    const nextWordId = si === sourceSegments.length - 1
      ? nextVerseFirstWordId
      : (sourceSegments[si + 1][0]?.wordId ?? null);
    const prevSec = prevWordId ? (wordSpeechMap.get(prevWordId) ?? null) : null;
    const nextSec = nextWordId ? (wordSpeechMap.get(nextWordId) ?? null) : null;
    const isSegStart = !!segSpeaker && prevSec?.id !== segSpeech?.id;
    const isSegEnd   = !!segSpeaker && nextSec?.id !== segSpeech?.id;
    return { segSpeech, segSpeaker, isSegStart, isSegEnd };
  }

  // Build the CSS style that wraps a paragraph row (or segment div in single-col)
  function segBoxStyle(
    segSpeaker: Character | null,
    isSegStart: boolean,
    isSegEnd: boolean
  ): React.CSSProperties {
    if (!segSpeaker) return {};
    return {
      backgroundColor: `${segSpeaker.color}0C`,
      borderLeft:   isHebrew ? "none"                          : `3px solid ${segSpeaker.color}`,
      borderRight:  isHebrew ? `3px solid ${segSpeaker.color}` : "none",
      paddingLeft:  isHebrew ? "0.5rem"   : "0.75rem",
      paddingRight: isHebrew ? "0.75rem"  : "0.5rem",
      marginLeft:   isHebrew ? 0          : "-0.75rem",
      marginRight:  isHebrew ? "-0.75rem" : 0,
      borderRadius: [
        isSegStart ? "4px" : "0",
        isSegStart ? "4px" : "0",
        isSegEnd   ? "4px" : "0",
        isSegEnd   ? "4px" : "0",
      ].join(" "),
      position: "relative",
    };
  }

  // Delete button (absolute-positioned, shown on first row of a speech section)
  function renderDeleteBtn(
    segSpeaker: Character | null,
    segSpeech: SpeechSection | null,
    isSegStart: boolean
  ): React.ReactNode {
    if (!segSpeaker || !segSpeech || !editingSpeech || !isSegStart) return null;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDeleteSpeechSection(segSpeech.id); }}
        className="absolute flex items-center justify-center w-5 h-5 rounded-full text-white text-sm leading-none z-10"
        style={{
          backgroundColor: segSpeaker.color,
          top: "4px",
          ...(isHebrew ? { left: "4px" } : { right: "4px" }),
        }}
        title={`Delete "${segSpeaker.name}" speech section`}
      >
        ×
      </button>
    );
  }

  // ── Word runs ───────────────────────────────────────────────────────────
  type SegRun = { inlineSec: SpeechSection | null; words: Word[] };

  function computeRuns(seg: Word[], segSpeech: SpeechSection | null): SegRun[] {
    const runs: SegRun[] = [];
    seg.forEach((w) => {
      const sec = wordSpeechMap.get(w.wordId) ?? null;
      const inlineSec = (sec && (!segSpeech || sec.id !== segSpeech.id)) ? sec : null;
      const last = runs[runs.length - 1];
      if (last && last.inlineSec?.id === inlineSec?.id) last.words.push(w);
      else runs.push({ inlineSec, words: [w] });
    });
    return runs;
  }

  function renderRuns(runs: SegRun[]): React.ReactNode {
    return runs.map((run, ri) => {
      const runChar = run.inlineSec ? characterMap.get(run.inlineSec.characterId) : null;
      const runStyle: React.CSSProperties = runChar
        ? { backgroundColor: `${runChar.color}0C` } : {};
      return (
        <span key={ri} style={runStyle}>
          {run.words.map((word, wi) => (
            <span key={word.wordId}>
              <WordToken
                word={word}
                displayMode={displayMode}
                grammarFilter={grammarFilter}
                colorRules={colorRules}
                onSelect={onSelectWord}
                selectedWordId={selectedWordId}
                showTooltip={showTooltips}
                useLinguisticTerms={useLinguisticTerms}
                editingParagraphs={editingParagraphs}
                characterRef={characterRefMap.get(word.wordId) ?? null}
                characterMap={characterMap}
                editingRefs={editingRefs}
                editingSpeech={editingSpeech}
                isRangeStart={word.wordId === speechRangeStartWordId}
                highlightCharIds={highlightCharIds}
                wordTagRef={wordTagRefMap.get(word.wordId) ?? null}
                wordTagMap={wordTagMap}
                editingWordTags={editingWordTags}
                highlightWordTagIds={highlightWordTagIds}
                wordFormatting={wordFormattingMap.get(word.wordId) ?? null}
                editingFormatting={editingFormatting}
              />
              {wi < run.words.length - 1 && " "}
            </span>
          ))}
          {runChar && editingSpeech && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSpeechSection(run.inlineSec!.id);
              }}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[11px] leading-none ml-0.5 align-middle"
              style={{ backgroundColor: runChar.color, opacity: 0.85 }}
              title={`Delete "${runChar.name}" speech section`}
            >
              ×
            </button>
          )}
        </span>
      );
    });
  }

  // ── Single-column layout (no translation) ──────────────────────────────
  if (translationTexts.length === 0) {
    return (
      <div className={`${verseStartsNewParagraph ? "mt-5" : ""} ${speechContinuesIntoNext ? "" : "mb-4"}`}>
        {verseSeparator}
        {sourceSegments.map((seg, si) => {
          const { segSpeech, segSpeaker, isSegStart, isSegEnd } = getSegSpeech(seg, si);
          const runs = computeRuns(seg, segSpeech);
          const paraStartId = wordToParaStart.get(seg[0].wordId) ?? seg[0].wordId;
          const indentLevel = lineIndentMap.get(paraStartId) ?? 0;
          return (
            <div
              key={si}
              style={{
                paddingLeft: !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                paddingRight: isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
              }}
            >
              {/* 3-column grid: label | arc-col | source-text.
                  dir="rtl" reverses column order for Hebrew (→ source-text | arc-col | label),
                  so the same template works for both LTR and RTL. */}
              <div
                style={{ gridTemplateColumns: "auto 80px 1fr", ...segBoxStyle(segSpeaker, isSegStart, isSegEnd) }}
                className={`grid items-center${editingSpeech ? " cursor-crosshair" : ""}${si > 0 ? " mt-1" : ""}`}
                dir={isHebrew ? "rtl" : "ltr"}
              >
                {renderDeleteBtn(segSpeaker, segSpeech, isSegStart)}
                {/* Col 1 — Paragraph label / indent controls */}
                {editingIndents ? (
                  <div className="flex items-center gap-0.5" data-seg-label={seg[0].wordId} style={{ minWidth: "3.5rem" }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.max(0, indentLevel - 1)); }}
                      disabled={indentLevel === 0}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Decrease indent"
                    >−</button>
                    <span className="text-teal-600 dark:text-teal-400 text-[10px] font-mono w-4 text-center select-none">
                      {indentLevel > 0 ? indentLevel : "·"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.min(6, indentLevel + 1)); }}
                      disabled={indentLevel >= 6}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Increase indent"
                    >+</button>
                  </div>
                ) : (
                  <span
                    className="text-stone-400 dark:text-stone-600 text-sm font-mono"
                    data-seg-label={seg[0].wordId}
                    data-osis-ref={`${book}.${chapter}.${verseNum}`}
                    style={{ minWidth: "1.75rem", textAlign: isHebrew ? "right" : "left" }}
                  >
                    {paraLabels[si]}
                  </span>
                )}
                {/* Col 2 — Arc column (80px, empty — space for ClauseRelationshipOverlay SVG) */}
                <div />
                {/* Col 3 — Source text */}
                <span
                  className={`${isHebrew ? "text-hebrew" : "text-greek"} leading-loose`}
                  lang={isHebrew ? "he" : "grc"}
                >
                  {renderRuns(runs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Three-column layout: source | label | translation ─────────────────
  // Pre-split translation tokens into paragraph segments (matching the source
  // paragraph structure) so that each source-paragraph row can carry its own
  // translation content — and the speech-box background spans all three cells.

  type TvSeg = { startIdx: number; tokens: string[] };

  const allTvSegs = translationTexts.map(({ abbr, text }) => {
    const tokens = text.split(/\s+/).filter(Boolean);
    const segs: TvSeg[] = [];
    let cur: string[] = [];
    let curStart = 0;
    tokens.forEach((token, wi) => {
      if (wi > 0 && paragraphBreakIds.has(`tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`)) {
        segs.push({ startIdx: curStart, tokens: cur });
        cur = [];
        curStart = wi;
      }
      cur.push(token);
    });
    if (cur.length > 0) segs.push({ startIdx: curStart, tokens: cur });
    return { abbr, text, tvSegs: segs };
  });

  return (
    <div
      className={`${
        speechContinuesIntoNext ? "" : "border-b border-[var(--border)]"
      } ${speechContinuesFromPrev ? "pt-0" : "pt-4"} ${
        speechContinuesIntoNext ? "pb-0" : "pb-4"
      } last:border-0${verseStartsNewParagraph && !speechContinuesFromPrev ? " mt-4" : ""}`}
    >
      {verseSeparator}

      {/* Each source paragraph is its own 5-cell grid row so the speech-box
          background/border wraps the source, arc columns, label AND translation together. */}
      {sourceSegments.map((seg, si) => {
        const { segSpeech, segSpeaker, isSegStart, isSegEnd } = getSegSpeech(seg, si);
        const runs = computeRuns(seg, segSpeech);

        // Translation content for this row:
        //   • All rows except the last get only tvSegs[si] (if it exists).
        //   • The last source row gets tvSegs[si…end] (all remaining tv paragraphs).
        const tvRowContent = allTvSegs.map(({ abbr, text: tvFullText, tvSegs }) => {
          const isLastRow = si === sourceSegments.length - 1;
          const rowSegs: TvSeg[] = si < sourceSegments.length - 1
            ? (tvSegs[si] ? [tvSegs[si]] : [])
            : tvSegs.slice(si);

          // Verse-level translation paragraph separator (first row only)
          const tvStartsNewParagraph = si === 0
            && paragraphBreakIds.has(`tv:${abbr}:${book}.${chapter}.${verseNum}.0`);

          // ── Translation edit mode: show a plain textarea for direct text editing ──
          if (editingTranslation) {
            if (!isLastRow) return null; // only show edit area in the last (or only) row
            return (
              <div key={abbr}>
                {translationTexts.length > 1 && (
                  <span className="block text-[10px] font-mono font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-0.5">
                    {abbr}
                  </span>
                )}
                <textarea
                  key={`${abbr}-${verseNum}`}
                  defaultValue={tvFullText}
                  onBlur={(e) => onUpdateTranslationVerse?.(abbr, verseNum, e.target.value.trim())}
                  rows={3}
                  className="w-full resize-y rounded border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:text-stone-100"
                  style={{
                    fontSize: "var(--translation-font-size, 0.875rem)",
                    lineHeight: 1.6,
                  }}
                  spellCheck={false}
                />
              </div>
            );
          }

          const hasContent = rowSegs.length > 0;

          return (
            <div key={abbr}>
              {tvStartsNewParagraph && (
                <div
                  className={`w-full border-t border-dashed mb-1 ${
                    editingParagraphs
                      ? "border-amber-400"
                      : "border-stone-300 dark:border-stone-600"
                  }`}
                  aria-hidden="true"
                />
              )}
              {/* Abbreviation label: only on row 0, only when multiple translations */}
              {translationTexts.length > 1 && si === 0 && (
                <span className="block text-[10px] font-mono font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-0.5">
                  {abbr}
                </span>
              )}
              {hasContent && (
                <p
                  className="text-stone-800 dark:text-stone-200"
                  style={{
                    fontSize: "var(--translation-font-size, 0.875rem)",
                    lineHeight: "var(--source-row-height, 1.625)",
                  }}
                >
                  {rowSegs.flatMap((tvSeg, segIdx) =>
                    tvSeg.tokens.map((token, localWi) => {
                      const globalWi = tvSeg.startIdx + localWi;
                      const wordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi}`;
                      const ref = characterRefMap.get(wordId);
                      const char1 = ref ? characterMap.get(ref.character1Id) : null;
                      const char2 = ref?.character2Id != null
                        ? characterMap.get(ref.character2Id)
                        : null;

                      const underlineStyle: React.CSSProperties = char1 && char2 ? {
                        backgroundImage: `repeating-linear-gradient(to right, ${char1.color} 0px, ${char1.color} 4px, ${char2.color} 4px, ${char2.color} 8px)`,
                        backgroundSize: "100% 2px",
                        backgroundPosition: "center bottom",
                        backgroundRepeat: "no-repeat",
                        paddingBottom: "2px",
                      } : char1 ? {
                        textDecoration: "underline",
                        textDecorationColor: char1.color,
                        textDecorationThickness: "2px",
                        textUnderlineOffset: "2px",
                      } : {};

                      const isTokenHighlighted = highlightCharIds.size > 0 && ref != null && (
                        highlightCharIds.has(ref.character1Id) ||
                        (ref.character2Id != null && highlightCharIds.has(ref.character2Id))
                      );

                      const tvTagRef = wordTagRefMap.get(wordId);
                      const tvTag = tvTagRef ? wordTagMap.get(tvTagRef.tagId) : null;
                      const isTvTagHighlighted = !!tvTag && highlightWordTagIds.has(tvTag.id);

                      // Combine character halo + word-tag ring (box-shadow unaffected by parent bg)
                      const tvShadows: string[] = [];
                      if (isTokenHighlighted) tvShadows.push("0 0 0 3px rgba(253, 224, 71, 0.85)");
                      if (tvTag) {
                        tvShadows.push(
                          isTvTagHighlighted
                            ? `0 0 0 2px ${tvTag.color}, 0 0 6px 1px ${tvTag.color}88`
                            : `0 0 0 1.5px ${tvTag.color}`,
                        );
                      }
                      const tvShadowStyle: React.CSSProperties = tvShadows.length > 0
                        ? { boxShadow: tvShadows.join(", "), borderRadius: "2px" }
                        : {};

                      // Within a tvSeg, localWi > 0 could still have a break (defensive)
                      const isMidVerseBreak = localWi > 0 && paragraphBreakIds.has(wordId);
                      // Between adjacent tvSegs in the same row: add a visual ¶ separator
                      const isInterSegBreak = segIdx > 0 && localWi === 0;

                      // ── Bold / italic formatting for translation tokens ──────
                      const tvFormatting = wordFormattingMap.get(wordId);
                      const tvFormattingStyle: React.CSSProperties = {
                        fontWeight: tvFormatting?.isBold ? "bold" : undefined,
                        fontStyle:  tvFormatting?.isItalic ? "italic" : undefined,
                      };

                      const tokenClassName = editingFormatting
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                        : editingRefs
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                        : editingParagraphs
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                        : editingSpeech
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                        : editingWordTags
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors"
                        : undefined;

                      const handleClick = editingFormatting
                        ? () => onSelectTranslationWord(wordId, abbr)
                        : editingRefs
                        ? () => onSelectTranslationWord(wordId, abbr)
                        : editingParagraphs
                        ? () => onToggleTranslationParagraphBreak(wordId, abbr)
                        : editingSpeech
                        ? () => {
                            // Map clicked translation token to the correct source paragraph
                            let tvParaIdx = 0;
                            for (let j = 1; j <= globalWi; j++) {
                              if (paragraphBreakIds.has(
                                `tv:${abbr}:${book}.${chapter}.${verseNum}.${j}`
                              )) tvParaIdx++;
                            }
                            const srcSeg = sourceSegments[
                              Math.min(tvParaIdx, sourceSegments.length - 1)
                            ];
                            if (srcSeg?.[0]) onSelectWord(srcSeg[0]);
                          }
                        : editingWordTags
                        ? () => onSelectTranslationWord(wordId, abbr)
                        : undefined;

                      const isLastToken =
                        segIdx === rowSegs.length - 1 &&
                        localWi === tvSeg.tokens.length - 1;

                      return (
                        <span key={globalWi}>
                          {(isMidVerseBreak || isInterSegBreak) && (
                            <>
                              <br />
                              <span
                                className={`text-xs select-none font-mono mr-1 ${pilcrowClass}`}
                                aria-hidden="true"
                              >
                                ¶
                              </span>
                            </>
                          )}
                          <span
                            style={{ ...underlineStyle, ...tvShadowStyle, ...tvFormattingStyle }}
                            className={tokenClassName}
                            onClick={handleClick}
                          >
                            {token}
                          </span>
                          {!isLastToken && " "}
                        </span>
                      );
                    })
                  )}
                </p>
              )}
            </div>
          );
        });

        const paraStartId = wordToParaStart.get(seg[0].wordId) ?? seg[0].wordId;
        const indentLevel = lineIndentMap.get(paraStartId) ?? 0;

        return (
          <div key={si}>
            {/* Grid layout:
                5-col (with source): source | source-arc-col | verse-label | translation-arc-col | translation
                3-col (hideSourceText): verse-label | translation-arc-col | translation
                The 80px arc columns provide dedicated space for the SVG arc overlay. */}
            <div
              className={`grid items-center${editingSpeech ? " cursor-crosshair" : ""}`}
              style={{
                gridTemplateColumns: hideSourceText ? "auto 80px 1fr" : "1fr 80px auto 80px 1fr",
                ...segBoxStyle(segSpeaker, isSegStart, isSegEnd),
              }}
            >
              {renderDeleteBtn(segSpeaker, segSpeech, isSegStart)}

              {/* Cols 1–2 — Source words + source arc column (hidden in translation-only mode) */}
              {!hideSourceText && (
                <>
                  {/* Col 1 — Source words. Indent towards the source text's reading direction:
                      Hebrew (RTL) shifts left via paddingRight; Greek (LTR) shifts right via paddingLeft. */}
                  <div
                    dir={isHebrew ? "rtl" : "ltr"}
                    style={{
                      paddingRight: isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                      paddingLeft:  !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                    }}
                  >
                    <span
                      className={`${isHebrew ? "text-hebrew" : "text-greek"} leading-loose`}
                      lang={isHebrew ? "he" : "grc"}
                    >
                      {renderRuns(runs)}
                    </span>
                  </div>

                  {/* Col 2 — Source arc column (80px, empty — filled by ClauseRelationshipOverlay SVG) */}
                  <div />
                </>
              )}

              {/* Col 3 — Paragraph label / indent controls */}
              <div className="flex items-center justify-center">
                {editingIndents ? (
                  <div className="flex items-center gap-0.5" data-seg-label={seg[0].wordId}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.max(0, indentLevel - 1)); }}
                      disabled={indentLevel === 0}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Decrease indent"
                    >−</button>
                    <span className="text-teal-600 dark:text-teal-400 text-[10px] font-mono w-4 text-center select-none">
                      {indentLevel > 0 ? indentLevel : "·"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.min(6, indentLevel + 1)); }}
                      disabled={indentLevel >= 6}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Increase indent"
                    >+</button>
                  </div>
                ) : (
                  <span
                    className="text-stone-400 dark:text-stone-600 text-sm font-mono select-none"
                    data-seg-label={seg[0].wordId}
                    data-osis-ref={`${book}.${chapter}.${verseNum}`}
                    style={{ minWidth: "2.5rem", textAlign: "center" }}
                  >
                    {paraLabels[si]}
                  </span>
                )}
              </div>

              {/* Col 4 — Translation arc column (80px, empty — filled by ClauseRelationshipOverlay SVG) */}
              <div />

              {/* Col 5 — Translation content. English always indents rightward. */}
              <div
                className="flex flex-col gap-1"
                style={{ paddingLeft: indentLevel > 0 ? `${indentLevel * 2}rem` : undefined }}
              >
                {tvRowContent}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
