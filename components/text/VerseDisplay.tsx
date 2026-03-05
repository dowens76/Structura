"use client";

import type { Word, CharacterRef, Character, SpeechSection } from "@/lib/db/schema";
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
  activeCharId,
  speechRangeStartWordId,
  book,
  chapter,
  onSelectTranslationWord,
  onToggleTranslationParagraphBreak,
  highlightCharIds,
  onDeleteSpeechSection,
}: VerseDisplayProps) {
  const firstWordId = words[0]?.wordId;
  const verseStartsNewParagraph = firstWordId ? paragraphBreakIds.has(firstWordId) : false;

  const pilcrowClass = editingParagraphs
    ? "text-amber-500"
    : "text-stone-300 dark:text-stone-600";

  // ── Speech box ─────────────────────────────────────────────────────────────
  // Apply the verse-level speech box (coloured side border + tinted background)
  // ONLY when the same section covers BOTH the first and last word of this verse.
  // When a section starts or ends mid-verse the border would misrepresent the
  // actual range; those words are highlighted inline instead (see wordRuns below).
  const firstWordSection = firstWordId ? (wordSpeechMap.get(firstWordId) ?? null) : null;
  const lastWordId = words[words.length - 1]?.wordId;
  const lastWordSection = lastWordId ? (wordSpeechMap.get(lastWordId) ?? null) : null;
  const speechSection = (
    firstWordSection !== null &&
    lastWordSection !== null &&
    firstWordSection.id === lastWordSection.id
  ) ? firstWordSection : null;

  const prevLastSection  = prevVerseLastWordId ? (wordSpeechMap.get(prevVerseLastWordId) ?? null) : null;
  const nextFirstSection = nextVerseFirstWordId ? (wordSpeechMap.get(nextVerseFirstWordId) ?? null) : null;

  const speaker = speechSection ? characterMap.get(speechSection.characterId) : null;

  // Merge consecutive same-speaker verses into one box (no rounded corners at seam)
  const isSpeechStart = !!speaker && prevLastSection?.characterId !== speechSection?.characterId;
  const isSpeechEnd   = !!speaker && nextFirstSection?.characterId !== speechSection?.characterId;

  const speechStyle: React.CSSProperties = speaker ? {
    backgroundColor: `${speaker.color}18`,
    borderLeft:   isHebrew ? "none"                      : `3px solid ${speaker.color}`,
    borderRight:  isHebrew ? `3px solid ${speaker.color}` : "none",
    paddingLeft:  isHebrew ? "0.5rem"   : "0.75rem",
    paddingRight: isHebrew ? "0.75rem"  : "0.5rem",
    marginLeft:   isHebrew ? 0          : "-0.75rem",
    marginRight:  isHebrew ? "-0.75rem" : 0,
    borderRadius: [
      isSpeechStart ? "4px" : "0",
      isSpeechStart ? "4px" : "0",
      isSpeechEnd   ? "4px" : "0",
      isSpeechEnd   ? "4px" : "0",
    ].join(" "),
    position: "relative",
  } : {};

  // ── Inline partial-verse speech highlighting ────────────────────────────────
  // Group words into runs by inline speech section. A word needs inline
  // highlighting when it is in a section that is NOT the verse-level box section.
  type WordRun = { inlineSec: SpeechSection | null; wordIndices: number[] };
  const wordRuns: WordRun[] = [];
  words.forEach((word, i) => {
    const sec = wordSpeechMap.get(word.wordId) ?? null;
    const inlineSec = (sec && (!speechSection || sec.id !== speechSection.id)) ? sec : null;
    const last = wordRuns[wordRuns.length - 1];
    if (last && last.inlineSec?.id === inlineSec?.id) {
      last.wordIndices.push(i);
    } else {
      wordRuns.push({ inlineSec, wordIndices: [i] });
    }
  });

  const verseNumber = (
    <span
      className="text-stone-400 dark:text-stone-600 text-sm font-mono select-none shrink-0 mt-1"
      style={{ minWidth: "1.75rem", textAlign: isHebrew ? "right" : "left" }}
    >
      {verseNum}
    </span>
  );

  // In parallel mode both columns share an absolute line height
  const isParallel = translationTexts.length > 0;
  const sharedLineHeight = isParallel ? "var(--source-row-height)" : undefined;

  const sourceWords = (
    <span
      className={`flex-1 ${isHebrew ? "text-hebrew" : "text-greek"}${isParallel ? "" : " leading-loose"}`}
      style={isParallel ? { lineHeight: sharedLineHeight } : undefined}
      lang={isHebrew ? "he" : "grc"}
    >
      {wordRuns.map((run, ri) => {
        const runChar = run.inlineSec ? characterMap.get(run.inlineSec.characterId) : null;
        const runStyle: React.CSSProperties = runChar ? {
          backgroundColor: `${runChar.color}18`,
        } : {};
        return (
          <span key={ri} style={runStyle}>
            {run.wordIndices.map((i) => {
              const word = words[i];
              const isBreakHere = paragraphBreakIds.has(word.wordId);
              const isMidVerseBreak = isBreakHere && i > 0;
              const isRangeStart = word.wordId === speechRangeStartWordId;
              return (
                <span key={word.wordId}>
                  {isMidVerseBreak && (
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
                    isRangeStart={isRangeStart}
                    highlightCharIds={highlightCharIds}
                  />
                  {i < words.length - 1 && " "}
                </span>
              );
            })}
            {/* Inline × button at the end of a partial-verse run */}
            {runChar && editingSpeech && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDeleteSpeechSection(run.inlineSec!.id); }}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[11px] leading-none ml-0.5 align-middle"
                style={{ backgroundColor: runChar.color, opacity: 0.85 }}
                title={`Delete "${runChar.name}" speech section`}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </span>
  );

  // Red × button shown in the corner of a verse-level speech box on the FIRST
  // verse of the section. Absolute-positioned within the relative speechStyle div.
  const speechDeleteBtn = speaker && editingSpeech && isSpeechStart ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onDeleteSpeechSection(speechSection!.id); }}
      className="absolute flex items-center justify-center w-5 h-5 rounded-full text-white text-sm leading-none z-10"
      style={{
        backgroundColor: speaker.color,
        top: "4px",
        ...(isHebrew ? { left: "4px" } : { right: "4px" }),
      }}
      title={`Delete "${speaker.name}" speech section`}
    >
      ×
    </button>
  ) : null;

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

  if (translationTexts.length === 0) {
    return (
      <div
        className={verseStartsNewParagraph ? "mt-5" : ""}
        style={speechStyle}
      >
        {speechDeleteBtn}
        {verseSeparator}
        <div
          className={`mb-4 flex gap-3${editingSpeech ? " cursor-crosshair" : ""}`}
          dir={isHebrew ? "rtl" : "ltr"}
        >
          {verseNumber}
          {sourceWords}
        </div>
      </div>
    );
  }

  // Two-column layout: source left, translation(s) right
  return (
    <div
      className={`grid grid-cols-2 gap-6 border-b border-[var(--border)] py-4 last:border-0 ${
        verseStartsNewParagraph ? "mt-4" : ""
      }`}
      style={speechStyle}
    >
      {speechDeleteBtn}
      {verseSeparator && (
        <div className="col-span-2 -mb-2">{verseSeparator}</div>
      )}
      <div
        className={`flex gap-3${editingSpeech ? " cursor-crosshair" : ""}`}
        dir={isHebrew ? "rtl" : "ltr"}
      >
        {verseNumber}
        {sourceWords}
      </div>
      <div className="flex flex-col gap-2">
        {translationTexts.map(({ abbr, text }) => {
          // Split into individual word tokens (whitespace-delimited) so each
          // can receive a character-ref underline and be clickable in refs/paragraph modes.
          const tokens = text.split(/\s+/).filter(Boolean);
          // Verse-level paragraph break for this translation
          const tvStartsNewParagraph = paragraphBreakIds.has(
            `tv:${abbr}:${book}.${chapter}.${verseNum}.0`
          );
          return (
            <div key={abbr}>
              {/* Dashed separator when this translation starts a new paragraph */}
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
              {translationTexts.length > 1 && (
                <span className="block text-[10px] font-mono font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-0.5">
                  {abbr}
                </span>
              )}
              <p
                className="text-stone-800 dark:text-stone-200"
                style={{
                  fontSize: "var(--translation-font-size, 0.875rem)",
                  lineHeight: "var(--source-row-height, 1.625)",
                }}
              >
                {tokens.map((token, wi) => {
                  const wordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`;
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

                  // Yellow halo when this token's character is highlighted
                  const isTokenHighlighted = highlightCharIds.size > 0 && ref != null && (
                    highlightCharIds.has(ref.character1Id) ||
                    (ref.character2Id != null && highlightCharIds.has(ref.character2Id))
                  );
                  const haloStyle: React.CSSProperties = isTokenHighlighted
                    ? { boxShadow: "0 0 0 3px rgba(253, 224, 71, 0.85)", borderRadius: "2px" }
                    : {};

                  // Mid-verse paragraph break: insert <br/> + ¶ before this token
                  const isMidVerseBreak = wi > 0 && paragraphBreakIds.has(wordId);

                  const tokenClassName = editingRefs
                    ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                    : editingParagraphs
                    ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    : editingSpeech
                    ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                    : undefined;

                  // In speech mode: clicking a translation token passes any source word
                  // from this verse to onSelectWord; ChapterDisplay snaps to the verse's
                  // first or last word automatically.
                  const handleClick = editingRefs
                    ? () => onSelectTranslationWord(wordId, abbr)
                    : editingParagraphs
                    ? () => onToggleTranslationParagraphBreak(wordId, abbr)
                    : editingSpeech
                    ? () => { if (words[0]) onSelectWord(words[0]); }
                    : undefined;

                  return (
                    <span key={wi}>
                      {isMidVerseBreak && (
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
                        style={{ ...underlineStyle, ...haloStyle }}
                        className={tokenClassName}
                        onClick={handleClick}
                      >{token}</span>
                      {wi < tokens.length - 1 && " "}
                    </span>
                  );
                })}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
