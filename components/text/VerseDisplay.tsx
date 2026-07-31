"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Word, CharacterRef, Character, SpeechSection, WordTag, WordTagRef, LineAnnotation, TranslationFootnote } from "@/lib/db/schema";
import { renderUsfmText } from "@/lib/utils/usfm-renderer";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry, InterlinearSubMode } from "@/lib/morphology/types";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { PLOT_ELEMENTS, ANNOTATION_PALETTE, getPlotElement, getAnnotationColor } from "@/lib/utils/annotations";
import { resolvedDatasetColor } from "@/lib/utils/datasetColors";
import { encodeUsfmTokens, decodeUsfmToken, tokenizeTranslationText } from "@/lib/utils/translationTokens";
import { wordFallsInPassageRange } from "@/lib/utils/passageRange";
import { analyzeHebrewLine } from "@/lib/phonology/hebrew-syllables";

/** Width of the hanging-indent space (px). RST lines are drawn inside this space. */
const HANG_PX = 32;

/**
 * OSIS codes for books that contain exactly one chapter.
 * Section-heading range labels omit the chapter number for these books
 * (there is only ever one chapter, so it adds no information).
 */
const SINGLE_CHAPTER_BOOKS = new Set(["Obad", "Phlm", "2John", "3John", "Jude"]);

/** Hebrew Unicode ranges: basic Hebrew block + presentation forms A. */
const HEBREW_RE = /[֐-׿יִ-ﭏ]+/g;

/**
 * Renders footnote content with inline Hebrew text displayed using Ezra SIL.
 * Non-Hebrew runs stay italic (inherited); Hebrew runs switch to upright Ezra SIL
 * with unicode-bidi:embed so they flow naturally inside an LTR sentence.
 */
function renderFootnoteContent(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  HEBREW_RE.lastIndex = 0;
  while ((m = HEBREW_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span
        key={m.index}
        style={{
          fontFamily: '"Ezra SIL", "SBL Hebrew", serif',
          fontStyle: "normal",
          fontSize: "1.25em",
          lineHeight: 1,
          direction: "rtl",
          unicodeBidi: "embed",
          display: "inline-block",
        }}
      >
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/** Split a translation token into leading punctuation, core word text, and trailing
 *  punctuation so that only the core is wrapped in the styled/clickable span. */
const LEADING_PUNCT = /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u2014]+/;
const TRAILING_PUNCT = /["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u2014]+$/;
function splitTokenPunctuation(token: string): { leading: string; core: string; trailing: string } {
  const leading = token.match(LEADING_PUNCT)?.[0] ?? "";
  const rest = token.slice(leading.length);
  const trailing = rest.match(TRAILING_PUNCT)?.[0] ?? "";
  return { leading, core: rest.slice(0, rest.length - trailing.length), trailing };
}

import { CommunicativeFunctionPicker, getCommFunctionLeafLabel, useCommFunctionCustoms } from "./CommunicativeFunctionPicker";
import WordToken from "./WordToken";
import TranslationDatasetLabel from "./TranslationDatasetLabel";
import ParseTooltip from "./ParseTooltip";
import { useTranslation } from "@/lib/i18n/LocaleContext";

/**
 * Renders a single LXX word token in the translation column with the same
 * hover-tooltip behavior as source-text WordToken instances. Kept as its own
 * component (rather than inlined in the render loop) because it needs its
 * own hover state per word.
 */
interface LxxWordSpanProps {
  word: Word;
  wordId: string;
  style: React.CSSProperties;
  className?: string;
  isRangeStart?: boolean;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
  showTooltip: boolean;
  useLinguisticTerms: boolean;
}
function LxxWordSpan({ word, wordId, style, className, isRangeStart, onClick, showTooltip, useLinguisticTerms }: LxxWordSpanProps) {
  const [hovering, setHovering] = useState(false);
  const [tooltipBelow, setTooltipBelow] = useState(false);
  const wordRef = useRef<HTMLSpanElement>(null);

  function handleMouseEnter() {
    if (wordRef.current) {
      const rect = wordRef.current.getBoundingClientRect();
      setTooltipBelow(rect.top < 350);
    }
    setHovering(true);
  }

  return (
    <span
      ref={wordRef}
      style={style}
      className={className}
      data-word-id={wordId}
      data-range-start={isRangeStart ? "true" : undefined}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovering(false)}
    >
      {word.surfaceText.replace(/\//g, "")}
      {showTooltip && hovering && (
        <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />
      )}
    </span>
  );
}

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
  wordSpeechMap: Map<string, SpeechSection[]>;
  // Synoptic word-level comparison marking — arbitrary word-range background
  // tint, independent of paragraph segments (see ChapterDisplay.tsx).
  synopticWordMarkColorMap?: Map<string, string>;
  editingWordCompare?: boolean;
  wordCompareRangeStartWordId?: string | null;
  /** When true, the verse-number label column narrows from 5rem to a tight
   *  ~3ch (enough for a 2-3 digit verse number plus a 1-2 character gap
   *  before the text) — used by SynopticView, where every pixel of a narrow
   *  column matters. Defaults to false (unchanged in the regular chapter/
   *  passage view). */
  compactVerseLabels?: boolean;
  prevVerseLastWordId: string | null;
  nextVerseFirstWordId: string | null;
  editingRefs: boolean;
  editingSpeech: boolean;
  activeCharId: number | null;
  speechRangeStartWordId: string | null;
  tagRangeStartWordId?: string | null;
  // Translation word tagging
  book: string;
  chapter: number;
  onSelectTranslationWord: (wordId: string, abbr: string, shiftHeld?: boolean) => void;
  // Translation paragraph breaks
  onToggleTranslationParagraphBreak: (wordId: string, abbr: string) => void;
  // Character highlight
  highlightCharIds: Set<number>;
  // Speech section delete (via × button) and reassign (via character badge)
  onDeleteSpeechSection: (sectionId: number) => void;
  onReassignSpeechSection?: (sectionId: number, newCharId: number) => void;
  // Word / concept tag highlighting
  wordTagRefMap: Map<string, WordTagRef>;
  wordTagMap: Map<number, WordTag>;
  // Verse-range bounds (by passage id) for clipping "passage"-scoped tags to
  // their actual start/end verse — see resolveTag() below.
  passageBoundsById?: Map<number, import("@/lib/utils/passageRange").PassageVerseRange>;
  editingWordTags: boolean;
  highlightWordTagIds: Set<number>;
  // True while a lemma-tag editor is armed to receive a word click (see WordTagPanel's
  // "↑ Text" picker). Word clicks should fill the lemma instead of applying the active tag.
  clusterPickingActive?: boolean;
  // Temporary search hit highlighting (word IDs in the current chapter)
  searchHits?: Set<string>;
  // Find-in-page highlighting
  findHits?: Set<string>;
  findFocusId?: string | null;
  // Paragraph indentation
  lineIndentMap: Map<string, number>;
  translationIndentMap?: Map<string, number>;
  indentsLinked?: boolean;
  wordToParaStart: Map<string, string>;
  editingIndents: boolean;
  onSetSegmentIndent: (paraStartWordId: string, level: number) => void;
  onSetSegmentTvIndent?: (paraStartWordId: string, level: number) => void;
  // Bold / italic formatting
  wordFormattingMap?: Map<string, { isBold: boolean; isItalic: boolean }>;
  editingFormatting?: boolean;
  // Text critical markup
  tcMarkMap?: Map<string, string>;
  editingTc?: boolean;
  onTcMarkWord?: (wordId: string, textSource: string) => void;
  // Interlinear sub-mode
  interlinearSubMode?: InterlinearSubMode;
  constituentLabelMap?: Map<string, string>;
  constituentGroupMap?: Map<string, string>;
  datasetEntryMap?: Map<string, string>;
  // Text direction for the active dataset's labels/inputs — explicit so it
  // doesn't silently inherit dir="rtl" from a Hebrew source-text ancestor.
  datasetDirection?: "ltr" | "rtl";
  transliterationFormatMap?: Map<string, string>;
  onSaveConstituentLabel?: (wordId: string, label: string | null) => void;
  onSaveDatasetEntry?: (wordId: string, value: string | null) => void;
  onSaveTransliterationFormat?: (wordId: string, format: string | null) => void;
  onLemmaClick?: (word: Word) => void;
  // Dataset word grouping
  datasetGroupMap?: Map<string, string>;
  datasetLabelColors?: Map<string, string>;
  datasetGroupingActive?: boolean;
  pendingGroupWordIds?: Set<string>;
  onToggleDatasetGroupMember?: (wordId: string) => void;
  // Source text visibility
  hideSourceText?: boolean;
  // Translation text editing
  editingTranslation?: boolean;
  editingTranslationSource?: boolean;
  onUpdateTranslationVerse?: (abbr: string, verse: number, newText: string) => void;
  onCancelTranslationVerse?: (abbr: string, verse: number) => void;
  // Free-form arrows (applies to both source and translation words)
  editingArrows?: boolean;
  onSelectArrowWordById?: (wordId: string) => void;
  // Section breaks — multiple breaks per wordId (one per level), stacked in display
  sceneBreakMap?: Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }>>;
  editingScenes?: boolean;
  onToggleSceneBreak?: (wordId: string, level: number, verse: number) => void;
  onChangeSceneHeading?: (wordId: string, level: number, heading: string) => void;
  onUpdateSceneHeading?: (wordId: string, level: number, heading: string) => void;
  onUpdateSceneOutOfSequence?: (wordId: string, level: number, outOfSequence: boolean) => void;
  onUpdateSceneExtendedThrough?: (wordId: string, level: number, extendedThrough: number | null) => void;
  onUpdateSceneThematic?: (wordId: string, level: number, thematic: boolean, thematicLetter: string | null) => void;
  onUpdateSceneTransitional?: (wordId: string, level: number, transitional: boolean) => void;
  onChangeSceneBreakLevel?: (wordId: string, fromLevel: number, toLevel: number, verse: number) => void;
  // Precomputed verse ranges: key = `${wordId}:${level}` → { endChapter, endVerse }
  sectionRanges?: Map<string, { endChapter: number; endVerse: number }>;
  // Line annotations
  annotationsBySegment?: Map<string, { annotation: LineAnnotation; isStart: boolean; isEnd: boolean }[]>;
  themeColorsByLabel?: Map<string, string>;
  editingAnnotations?: boolean;
  annotRangeStartWordId?: string | null;
  annotRangeEndWordId?: string | null;
  editingAnnotationId?: number | null;
  onSetEditingAnnotationId?: (id: number | null) => void;
  onSelectAnnotationSegment?: (wordId: string, shiftHeld?: boolean) => void;
  onSaveAnnotation?: (data: { annotType: string; label: string; commFunction?: string | null; color: string; description: string | null; outOfSequence: boolean; transitional: boolean }) => Promise<boolean>;
  onCancelAnnotation?: () => void;
  onDeleteAnnotation?: (id: number) => void;
  onUpdateAnnotation?: (id: number, updates: { annotType?: string; label?: string; commFunction?: string | null; color?: string; description?: string | null; outOfSequence?: boolean; transitional?: boolean }) => void;
  onExpandAnnotationRange?: (id: number, direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end") => void;
  showAnnotationCol?: boolean;
  showAtnachBreaks?: boolean;
  /** Shows a stresses/syllables count column, aligned past the end of the
   *  Hebrew text, for each poetic line (paragraph-break-defined segment). */
  showSyllableStress?: boolean;
  showVowels?: boolean;
  showCantillation?: boolean;
  /** Called when the user clicks a verse-number label; used to scroll the notes pane */
  onVerseClick?: (verseNum: number) => void;
  /** Extra gap (px) inserted between the verse-label column and the source-text column
   *  so that RST tree arrows don't overlap the verse number. */
  rstSourcePad?: number;
  /** When true, doubles font sizes for section headings and annotation labels */
  presentationMode?: boolean;
  /** Footnotes/cross-references attached to this verse (from USFM import or manual entry). */
  translationFootnotes?: TranslationFootnote[];
  /** Called when the user deletes a footnote from the verse. */
  onDeleteFootnote?: (translationId: number, footnoteId: number) => void;
  /** Called when the user clicks the edit button on a footnote. */
  onEditFootnote?: (fn: TranslationFootnote) => void;
  /** When true, the × delete button is shown on footnote chips. */
  editingFootnotes?: boolean;
  /**
   * When set, this verse is in anchor-placement mode for the given footnote.
   * Translation text words become clickable targets; clicking places the anchor.
   */
  anchorMoveFootnote?: { id: number; translationId: number; verse: number; abbr: string };
  /** Called when the user clicks a word to place the footnote anchor. */
  onMoveFootnoteAnchor?: (footnoteId: number, wordIndex: number) => void;
  /** True when at least one translation is active, even if this verse has no text yet.
   *  Used to keep the two-column layout visible and show a "start translating" hint. */
  hasActiveTranslations?: boolean;
  /**
   * When > 0 the active translation(s) use KJV-style verse numbering that is
   * offset from the MT by this many verses (Psalm superscriptions).
   * E.g. offset=1 means MT verse 2 = translation verse 1.
   * Used to display the translation verse number in brackets below the MT
   * verse number, and to suppress the "Enable editing to translate" placeholder
   * on superscription-only verses (where no translation text is expected).
   */
  translationVerseOffset?: number;
  /**
   * When set, returns a KJV cross-chapter reference label for a given MT verse
   * number, e.g. "1:17" for MT Jonah 2:1.  Takes precedence over
   * `translationVerseOffset` for the bracketed-label display.
   * Used for Jonah ch2, Joel ch3-4, Malachi ch3 tail.
   */
  translationVerseLabelFn?: (verseNum: number) => string | null;
}

// ── Annotation sub-components ────────────────────────────────────────────────
// Defined at module level so React can track identity between renders.

/**
 * 20-swatch colour picker for Theme and Desc annotations.
 * Uses onMouseDown + preventDefault so clicking a swatch never blurs an active
 * text input (preventing premature commitEdit calls in AnnotBadge editing mode).
 * When `locked` is true, shows only the current colour with a "Matches label" hint.
 */
function ColorPalette({
  value,
  onChange,
  locked,
}: {
  value: string;
  onChange: (color: string) => void;
  locked?: boolean;
}) {
  if (locked) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className="w-4 h-4 rounded shrink-0"
          style={{ backgroundColor: value }}
          title={`Color locked to label: ${value}`}
        />
        <span className="text-[9px] text-stone-400 dark:text-stone-500">Matches label</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-[3px]">
      {ANNOTATION_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onChange(c); }}
          style={{
            backgroundColor: c,
            width: 16,
            height: 16,
            borderRadius: 3,
            outline: value === c ? "2px solid white" : "none",
            outlineOffset: 1,
            boxShadow: value === c ? `0 0 0 2px ${c}` : "none",
            flexShrink: 0,
          }}
          title={c}
        />
      ))}
    </div>
  );
}

/** Displays one annotation at a segment — full badge at start, continuation bar at middle/end. */
function toSubscript(n: number): string {
  return String(n).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉"[parseInt(c)]).join("");
}

function AnnotBadge({
  annotation,
  isStart,
  isEnd,
  editingAnnotations,
  isEditing,
  onSetEditing,
  presentationMode,
  thematicSubscript,
  themeColorsByLabel,
  onDelete,
  onUpdate,
  onAdjustRange,
}: {
  annotation: LineAnnotation;
  isStart: boolean;
  isEnd: boolean;
  editingAnnotations: boolean;
  isEditing: boolean;
  onSetEditing: (v: boolean) => void;
  presentationMode?: boolean;
  thematicSubscript?: number;
  themeColorsByLabel?: Map<string, string>;
  onDelete?: (id: number) => void;
  onUpdate?: (id: number, updates: { annotType?: string; label?: string; commFunction?: string | null; description?: string | null; color?: string; outOfSequence?: boolean; transitional?: boolean }) => void;
  onAdjustRange?: (id: number, direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end") => void;
}) {
  const { t } = useTranslation();
  const { entries: customCommFunctions } = useCommFunctionCustoms();
  const [draftDesc, setDraftDesc] = useState(annotation.description ?? "");
  const [draftColor, setDraftColor] = useState(annotation.color);
  const [draftOos, setDraftOos] = useState(annotation.outOfSequence ?? false);
  const [draftTransitional, setDraftTransitional] = useState(annotation.transitional ?? false);
  // Annotation type is editable in-place; changing it swaps which per-type
  // label control (plot element / theme letter / comm-function-as-label) is shown.
  const [draftAnnotType, setDraftAnnotType] = useState<"plot" | "theme" | "desc">(
    (annotation.annotType as "plot" | "theme" | "desc") ?? "plot"
  );
  const [draftPlotLabel, setDraftPlotLabel] = useState(
    annotation.annotType === "plot" ? annotation.label : PLOT_ELEMENTS[0].label
  );
  const [draftThemeLabel, setDraftThemeLabel] = useState(
    annotation.annotType === "theme" ? annotation.label : "A"
  );
  // Communicative function: for "desc" annotations it's stored in `label`; for
  // "theme" annotations `label` already holds the theme letter, so it's stored
  // in the separate `commFunction` column instead.
  const [draftCommFunction, setDraftCommFunction] = useState(
    annotation.annotType === "desc" ? (annotation.label ?? "")
    : annotation.annotType === "theme" ? (annotation.commFunction ?? "")
    : ""
  );

  // Keep drafts in sync if annotation is updated externally
  useEffect(() => { setDraftDesc(annotation.description ?? ""); }, [annotation.description]);
  useEffect(() => { setDraftColor(annotation.color); }, [annotation.color]);
  useEffect(() => { setDraftOos(annotation.outOfSequence ?? false); }, [annotation.outOfSequence]);
  useEffect(() => { setDraftTransitional(annotation.transitional ?? false); }, [annotation.transitional]);
  useEffect(() => {
    setDraftAnnotType((annotation.annotType as "plot" | "theme" | "desc") ?? "plot");
    if (annotation.annotType === "plot") setDraftPlotLabel(annotation.label);
    if (annotation.annotType === "theme") setDraftThemeLabel(annotation.label);
  }, [annotation.annotType, annotation.label]);
  useEffect(() => {
    if (annotation.annotType === "desc") setDraftCommFunction(annotation.label ?? "");
    else if (annotation.annotType === "theme") setDraftCommFunction(annotation.commFunction ?? "");
  }, [annotation.label, annotation.commFunction, annotation.annotType]);

  /** Type tabs switch which label control is active; snap the colour to a
   *  sensible default for the newly selected type (mirrors AnnotCreationForm). */
  function handleTypeChange(next: "plot" | "theme" | "desc") {
    setDraftAnnotType(next);
    if (next === "plot") setDraftColor(getPlotElement(draftPlotLabel)?.color ?? draftColor);
    else if (next === "theme") setDraftColor(themeColorsByLabel?.get(draftThemeLabel) ?? draftColor);
  }

  /** Discard all pending edits, reverting every draft field to the saved annotation. */
  function resetDrafts() {
    setDraftDesc(annotation.description ?? "");
    setDraftColor(annotation.color);
    setDraftOos(annotation.outOfSequence ?? false);
    setDraftTransitional(annotation.transitional ?? false);
    setDraftAnnotType((annotation.annotType as "plot" | "theme" | "desc") ?? "plot");
    setDraftPlotLabel(annotation.annotType === "plot" ? annotation.label : PLOT_ELEMENTS[0].label);
    setDraftThemeLabel(annotation.annotType === "theme" ? annotation.label : "A");
    setDraftCommFunction(
      annotation.annotType === "desc" ? (annotation.label ?? "")
      : annotation.annotType === "theme" ? (annotation.commFunction ?? "")
      : ""
    );
  }

  // Safety net: if the editor is closed by something other than the explicit
  // commit paths below (e.g. the annotation-editing toolbar toggle being
  // switched off while this badge is mid-edit), still persist any pending
  // change instead of silently discarding it. A no-op cancel via the "Cancel"
  // button first resets every draft to match `annotation`, so this finds no
  // diff and stays a true cancel in that case.
  const wasEditingRef = useRef(isEditing);
  useEffect(() => {
    if (wasEditingRef.current && !isEditing) {
      const updates = computeUpdates();
      if (Object.keys(updates).length > 0) onUpdate?.(annotation.id, updates);
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  // Commit on outside click. This is a real DOM-containment check rather
  // than a blur/relatedTarget one: WebKit (the engine behind the Tauri
  // desktop app) doesn't reliably populate `relatedTarget` on blur, which
  // used to make clicking inside a nested widget — e.g. opening the
  // communicative-function dropdown — read as "focus left the editor" and
  // save+close the whole dialog before the dropdown could open. Containment
  // checking sidesteps that: the dropdown (and its "manage categories"
  // modal) are still true DOM descendants of the container despite being
  // visually position:fixed, so clicks inside them never count as "outside".
  const editorContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isEditing) return;
    const onDown = (e: MouseEvent) => {
      if (!editorContainerRef.current?.contains(e.target as Node)) commitEdit();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isEditing]);

  const color = getAnnotationColor(annotation.annotType, annotation.label, annotation.color);

  // Continuation block — fills the full column cell height so multi-segment
  // annotations appear as one unbroken vertical strip of color.
  if (!isStart) {
    return (
      <div
        className={[
          "flex-1 min-h-6 flex flex-col overflow-hidden",
          isEnd ? "rounded-b" : "",
        ].filter(Boolean).join(" ")}
        style={{ borderLeft: `3px solid ${color}`, backgroundColor: `${color}18` }}
      >
        {editingAnnotations && isEnd && (
          <div className="flex items-center justify-end gap-0.5 mt-auto pb-0.5 pr-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              title="Shrink: remove this last segment"
              onClick={() => onAdjustRange?.(annotation.id, "shrink-end")}
              className="text-[9px] px-1 py-0 rounded bg-white/70 dark:bg-stone-900/70 text-stone-500 dark:text-stone-400 hover:bg-white dark:hover:bg-stone-900 leading-4"
            >−</button>
            <button
              type="button"
              title="Expand: include the next segment"
              onClick={() => onAdjustRange?.(annotation.id, "expand-end")}
              className="text-[9px] px-1 py-0 rounded bg-white/70 dark:bg-stone-900/70 text-stone-500 dark:text-stone-400 hover:bg-white dark:hover:bg-stone-900 leading-4"
            >+</button>
          </div>
        )}
      </div>
    );
  }

  /** Diff the current drafts against the saved annotation. Returns only the changed fields. */
  function computeUpdates() {
    const newDesc = draftDesc.trim() || null;
    const updates: { annotType?: string; label?: string; commFunction?: string | null; description?: string | null; color?: string; outOfSequence?: boolean; transitional?: boolean } = {};

    // Resolve the label/commFunction/color triple for the (possibly changed) type.
    let newLabel: string;
    let newCommFunction: string | null;
    let newColor: string;
    if (draftAnnotType === "plot") {
      newLabel = draftPlotLabel;
      newCommFunction = null;
      newColor = getPlotElement(draftPlotLabel)?.color ?? draftColor;
    } else if (draftAnnotType === "theme") {
      newLabel = draftThemeLabel.trim() || "A";
      newCommFunction = draftCommFunction || null;
      newColor = draftColor;
    } else {
      newLabel = draftCommFunction;
      newCommFunction = null;
      newColor = draftColor;
    }
    const oldCommFunction = annotation.annotType === "theme" ? (annotation.commFunction ?? null) : null;
    // When the type itself changes, force-write label/commFunction/color to
    // their freshly computed values even if they happen to equal whatever is
    // already in the DB — a row can carry a stale value in a column its old
    // type never displayed (e.g. a leftover commFunction on a "desc" row),
    // and a same-value diff would otherwise leave that stale data in place.
    const typeChanged = draftAnnotType !== annotation.annotType;

    if (typeChanged) updates.annotType = draftAnnotType;
    if (typeChanged || newLabel !== annotation.label) updates.label = newLabel;
    if (typeChanged || newCommFunction !== oldCommFunction) updates.commFunction = newCommFunction;
    if (typeChanged || newColor !== annotation.color) updates.color = newColor;
    if (newDesc !== annotation.description) updates.description = newDesc;
    if (draftOos !== (annotation.outOfSequence ?? false)) updates.outOfSequence = draftOos;
    if (draftTransitional !== (annotation.transitional ?? false)) updates.transitional = draftTransitional;
    return updates;
  }

  function commitEdit() {
    const updates = computeUpdates();
    if (Object.keys(updates).length > 0) onUpdate?.(annotation.id, updates);
    onSetEditing(false);
  }

  const hasLabel = annotation.label !== "";

  // ── Editing state: type/label + description + range controls ────────────
  if (isEditing) {
    const editColor = draftAnnotType === "plot" ? (getPlotElement(draftPlotLabel)?.color ?? draftColor) : draftColor;
    const typeTabs: { key: "plot" | "theme" | "desc"; display: string }[] = [
      { key: "plot",  display: "Plot"  },
      { key: "theme", display: "Theme" },
      { key: "desc",  display: "Desc"  },
    ];
    return (
      <div
        ref={editorContainerRef}
        className={[isEnd ? "rounded" : "rounded-t", "flex-1 overflow-hidden"].join(" ")}
        style={{ borderLeft: `3px solid ${editColor}`, backgroundColor: `${editColor}18` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row */}
        <div className="flex items-center gap-1 px-1.5 pt-1 pb-0.5">
          {draftAnnotType === "plot" && (
            <span
              className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none"
              style={{ backgroundColor: editColor }}
              title={getPlotElement(draftPlotLabel)?.fullName}
            >
              {draftPlotLabel}
            </span>
          )}
          {draftAnnotType === "theme" && (
            <span
              className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none"
              style={{ backgroundColor: editColor }}
            >
              {(draftThemeLabel || "A")}{thematicSubscript != null ? toSubscript(thematicSubscript) : ""}
            </span>
          )}
          {draftAnnotType === "theme" && draftCommFunction && (
            <span
              className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none"
              style={{ backgroundColor: editColor }}
            >
              {getCommFunctionLeafLabel(draftCommFunction, customCommFunctions)}
            </span>
          )}
          {draftAnnotType === "desc" && draftCommFunction && (
            <span
              className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none"
              style={{ backgroundColor: editColor }}
            >
              {getCommFunctionLeafLabel(draftCommFunction, customCommFunctions)}
            </span>
          )}
          <div className="shrink-0 ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={commitEdit}
              className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 text-xs leading-none"
              title="Save"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => { resetDrafts(); onSetEditing(false); }}
              className="text-stone-400 hover:text-stone-600 text-xs leading-none"
              title="Cancel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Type tabs — switch between Plot, Theme, Desc */}
        <div className="flex gap-1 px-1.5 pb-1">
          {typeTabs.map(({ key, display }) => (
            <button
              key={key}
              type="button"
              onMouseDown={(e) => e.preventDefault()} // don't blur description input
              onClick={() => handleTypeChange(key)}
              className={[
                "flex-1 px-1 py-0.5 rounded text-[9px] font-semibold transition-colors",
                draftAnnotType === key
                  ? "bg-indigo-600 text-white"
                  : "bg-white/70 dark:bg-stone-900/70 text-stone-500 dark:text-stone-400 hover:bg-white dark:hover:bg-stone-900",
              ].join(" ")}
            >
              {display}
            </button>
          ))}
        </div>

        {/* Plot element picker — plot annotations only */}
        {draftAnnotType === "plot" && (
          <div className="flex flex-wrap gap-1 px-1.5 pb-1">
            {PLOT_ELEMENTS.map((el) => (
              <button
                key={el.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setDraftPlotLabel(el.label); setDraftColor(el.color); }}
                className="px-1.5 py-0.5 rounded text-[10px] text-white font-bold transition-opacity leading-none"
                style={{ backgroundColor: el.color, opacity: draftPlotLabel === el.label ? 1 : 0.35 }}
                title={el.fullName}
              >
                {el.label}
              </button>
            ))}
          </div>
        )}

        {/* Theme letter — theme annotations only */}
        {draftAnnotType === "theme" && (
          <div className="px-1.5 pb-1">
            <input
              type="text"
              value={draftThemeLabel}
              onChange={(e) => setDraftThemeLabel(e.target.value.toUpperCase().slice(0, 3))}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="A"
              maxLength={3}
              className="w-10 px-1 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-white dark:bg-stone-900 text-[10px] uppercase font-bold text-center"
            />
          </div>
        )}

        {/* Description input */}
        <div className="px-1.5 pb-1">
          <input
            autoFocus
            type="text"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { resetDrafts(); onSetEditing(false); }
              e.stopPropagation();
            }}
            placeholder="Description (optional)"
            className="w-full px-1 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-white dark:bg-stone-900 text-[10px] placeholder:text-stone-400 dark:placeholder:text-stone-600"
          />
        </div>

        {/* Colour palette — theme and desc annotations only */}
        {draftAnnotType !== "plot" && (
          <div className="px-1.5 pb-1">
            <ColorPalette
              value={draftColor}
              onChange={setDraftColor}
              locked={draftAnnotType === "theme" ? themeColorsByLabel?.has(draftThemeLabel) : false}
            />
          </div>
        )}

        {/* Communicative function — theme and desc annotations only */}
        {(draftAnnotType === "theme" || draftAnnotType === "desc") && (
          <div className="px-1.5 pb-1">
            <CommunicativeFunctionPicker value={draftCommFunction} onChange={setDraftCommFunction} />
          </div>
        )}

        {/* Out-of-sequence toggle */}
        <label
          className="flex items-center gap-1.5 px-1.5 pb-1 cursor-pointer select-none"
          onMouseDown={(e) => e.preventDefault()} // prevent blurring description input
        >
          <input
            type="checkbox"
            checked={draftOos}
            onChange={(e) => setDraftOos(e.target.checked)}
            className="w-3 h-3 accent-amber-500 cursor-pointer shrink-0"
          />
          <span className="text-[9px] text-stone-400 dark:text-stone-500">↩ Out of chronological sequence</span>
        </label>

        {/* Transitional (janus) toggle */}
        <label
          className="flex items-center gap-1.5 px-1.5 pb-1 cursor-pointer select-none"
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            type="checkbox"
            checked={draftTransitional}
            onChange={(e) => setDraftTransitional(e.target.checked)}
            className="w-3 h-3 accent-sky-500 cursor-pointer shrink-0"
          />
          <span className="text-[9px] text-stone-400 dark:text-stone-500">⇔ {t("outlinePane.transitionalJanus")}</span>
        </label>

        {/* Range controls */}
        {onAdjustRange && (
          <div className="px-1.5 pb-1.5 flex items-center gap-1">
            <span className="text-[9px] text-stone-400 dark:text-stone-500 shrink-0">Range:</span>
            <div className="flex gap-0.5">
              <button type="button" title="Expand: include segment above start"
                onClick={() => onAdjustRange(annotation.id, "expand-start")}
                className="text-[9px] w-5 h-4 rounded bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 flex items-center justify-center">▲</button>
              <button type="button" title="Shrink: remove first segment"
                onClick={() => onAdjustRange(annotation.id, "shrink-start")}
                className="text-[9px] w-5 h-4 rounded bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 flex items-center justify-center">▼</button>
            </div>
            <span className="text-[9px] text-stone-300 dark:text-stone-600 select-none">·</span>
            <div className="flex gap-0.5">
              <button type="button" title="Shrink: remove last segment"
                onClick={() => onAdjustRange(annotation.id, "shrink-end")}
                className="text-[9px] w-5 h-4 rounded bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 flex items-center justify-center">▲</button>
              <button type="button" title="Expand: include segment below end"
                onClick={() => onAdjustRange(annotation.id, "expand-end")}
                className="text-[9px] w-5 h-4 rounded bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 flex items-center justify-center">▼</button>
            </div>
            {onDelete && (
              <>
                <span className="text-[9px] text-stone-300 dark:text-stone-600 select-none ml-auto">·</span>
                <button type="button" title="Delete this annotation"
                  onClick={() => onDelete(annotation.id)}
                  className="text-[9px] px-1 h-4 rounded bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors">del</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Normal (read / edit-hover) state ─────────────────────────────────────
  const badgeTextCls = presentationMode ? "text-sm" : "text-[10px]";
  return (
    <div
      className={[
        isEnd ? "rounded" : "rounded-t",
        "flex-1 flex flex-col",
        editingAnnotations ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : "",
      ].join(" ")}
      style={{ borderLeft: `3px solid ${color}`, backgroundColor: `${color}18` }}
      onClick={editingAnnotations ? (e) => { e.stopPropagation(); onSetEditing(true); } : undefined}
      title={editingAnnotations ? "Click to edit" : undefined}
    >
      {/* position:relative here so the multi-segment description's top:"100%"
          is relative to just this label-row area, not the full flex-1 badge height. */}
      <div className="flex flex-col px-1.5 py-1 gap-0.5" style={{ position: "relative" }}>
        {/* Label row: oos icon + label badge + delete button */}
        {(annotation.outOfSequence || annotation.transitional || hasLabel || (editingAnnotations && !!onDelete)) && (
          <div className="flex items-center gap-1">
            {annotation.outOfSequence && (
              <span className={`shrink-0 ${badgeTextCls} font-bold text-amber-500 dark:text-amber-400 leading-none`} title="Out of chronological sequence">↩</span>
            )}
            {annotation.transitional && (
              <span className={`shrink-0 ${badgeTextCls} font-bold text-sky-500 dark:text-sky-400 leading-none`} title={t("outlinePane.transitionalJanus")}>⇔</span>
            )}
            {hasLabel && (
              <span
                className={`shrink-0 ${badgeTextCls} font-bold px-1 py-0.5 rounded text-white leading-none`}
                style={{ backgroundColor: color }}
                title={annotation.annotType === "plot" ? getPlotElement(annotation.label)?.fullName : undefined}
              >
                {getCommFunctionLeafLabel(annotation.label, customCommFunctions)}{thematicSubscript != null ? toSubscript(thematicSubscript) : ""}
              </span>
            )}
            {annotation.annotType === "theme" && annotation.commFunction && (
              <span
                className={`shrink-0 ${badgeTextCls} font-bold px-1 py-0.5 rounded text-white leading-none`}
                style={{ backgroundColor: color }}
              >
                {getCommFunctionLeafLabel(annotation.commFunction, customCommFunctions)}
              </span>
            )}
            {editingAnnotations && onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(annotation.id); }}
                className="shrink-0 ml-auto text-stone-300 dark:text-stone-600 hover:text-red-500 dark:hover:text-red-400 text-sm leading-none transition-colors"
                title="Delete annotation"
              >
                ×
              </button>
            )}
          </div>
        )}
        {/* Description: rendered in normal flow for single-segment annotations
            (isStart && isEnd) — overflowing onto the next, unrelated row would
            visually clash with a different annotation's colour. */}
        {annotation.description && isEnd && (
          <span
            className="text-stone-600 dark:text-stone-400 leading-tight min-w-0 break-words"
            style={{ fontSize: "var(--translation-font-size, 0.875rem)" }}
          >
            {annotation.description}
          </span>
        )}
        {/* For multi-segment annotations (start but not end) the description is
            rendered absolutely so its multi-line height does not contribute to
            the badge's content height — keeps the parent flex row (and thus the
            Greek/Hebrew text row) at its natural size while the text overflows
            visually onto the same-coloured continuation bands of the following
            segments.  pointer-events:none so clicks fall through to the segment
            beneath. top:"100%" is relative to this inner div so the description
            always starts just below the label row (or at the top when there is
            none), never at the bottom of the tall flex-1 outer badge. */}
        {annotation.description && !isEnd && (
          <div
            className="px-1.5 pt-0.5"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "100%",
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <span
              className="text-stone-600 dark:text-stone-400 leading-tight min-w-0 break-words"
              style={{ fontSize: "var(--translation-font-size, 0.875rem)" }}
            >
              {annotation.description}
            </span>
          </div>
        )}
      </div>
      {/* In edit mode show the single-segment +/- at the bottom */}
      {editingAnnotations && isEnd && onAdjustRange && (
        <div className="flex items-center gap-0.5 px-1.5 pb-1" onClick={(e) => e.stopPropagation()}>
          <span className="text-[9px] text-stone-400 dark:text-stone-500 mr-0.5">end:</span>
          <button type="button" title="Expand: include the next segment"
            onClick={() => onAdjustRange(annotation.id, "expand-end")}
            className="text-[9px] px-1 py-0 rounded bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 leading-4">+</button>
        </div>
      )}
    </div>
  );
}

/** Inline creation form that appears after range selection. Three tabs: Plot, Theme, Desc. */
function AnnotCreationForm({
  themeColorsByLabel,
  onSave,
  onCancel,
}: {
  themeColorsByLabel?: Map<string, string>;
  onSave: (data: { annotType: string; label: string; commFunction?: string | null; color: string; description: string | null; outOfSequence: boolean; transitional: boolean }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [annotType, setAnnotType] = useState<"plot" | "theme" | "desc">("plot");
  const [plotLabel, setPlotLabel] = useState<string>(PLOT_ELEMENTS[0].label);
  const [themeLabel, setThemeLabel] = useState("A");
  const [color, setColor] = useState<string>(PLOT_ELEMENTS[0].color);
  const [description, setDescription] = useState("");
  const [outOfSequence, setOutOfSequence] = useState(false);
  const [transitional, setTransitional] = useState(false);
  const [commFunction, setCommFunction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep color in sync when type or plot-label changes
  useEffect(() => {
    if (annotType === "plot") {
      setColor(getPlotElement(plotLabel)?.color ?? "#6B7280");
    } else if (annotType === "theme") {
      // Use existing label colour if known; otherwise default to first palette entry
      setColor(themeColorsByLabel?.get(themeLabel) ?? ANNOTATION_PALETTE[0]);
    }
    // "desc" keeps whatever palette colour the user last picked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotType, plotLabel, themeLabel, themeColorsByLabel]);

  async function handleSave() {
    if (saving) return;
    let label: string;
    let finalColor: string;
    if (annotType === "plot") {
      label = plotLabel;
      finalColor = getPlotElement(plotLabel)?.color ?? "#6B7280";
    } else if (annotType === "theme") {
      label = themeLabel.trim() || "A";
      finalColor = color;
    } else {
      label = commFunction;   // Communicative function (may be empty if none selected)
      finalColor = color;
    }
    setSaving(true);
    setSaveError(null);
    const ok = await onSave({
      annotType,
      label,
      commFunction: annotType === "theme" ? (commFunction.trim() || null) : undefined,
      color: finalColor,
      description: description.trim() || null,
      outOfSequence,
      transitional,
    });
    setSaving(false);
    if (!ok) setSaveError("Failed to save — please try again.");
  }

  const tabs: { key: "plot" | "theme" | "desc"; display: string }[] = [
    { key: "plot",  display: "Plot"  },
    { key: "theme", display: "Theme" },
    { key: "desc",  display: "Desc"  },
  ];

  return (
    <div
      className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded p-2 shadow-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Type tabs */}
      <div className="flex gap-1 mb-2">
        {tabs.map(({ key, display }) => (
          <button
            key={key}
            type="button"
            onClick={() => setAnnotType(key)}
            className={[
              "flex-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors",
              annotType === key
                ? "bg-indigo-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            {display}
          </button>
        ))}
      </div>

      {/* Per-type controls */}
      {annotType === "plot" && (
        <div className="flex flex-wrap gap-1 mb-2">
          {PLOT_ELEMENTS.map((el) => (
            <button
              key={el.label}
              type="button"
              onClick={() => setPlotLabel(el.label)}
              className="px-1.5 py-0.5 rounded text-[10px] text-white font-bold transition-opacity leading-none"
              style={{ backgroundColor: el.color, opacity: plotLabel === el.label ? 1 : 0.35 }}
              title={el.fullName}
            >
              {el.label}
            </button>
          ))}
        </div>
      )}

      {annotType === "theme" && (
        <div className="mb-2 flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5">
            <input
              type="text"
              value={themeLabel}
              onChange={(e) => setThemeLabel(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="A"
              maxLength={3}
              className="w-10 px-1 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-transparent text-[10px] uppercase font-bold text-center shrink-0"
            />
            {/* Lock colour to the existing label; let user pick freely for new labels */}
            <ColorPalette
              value={color}
              onChange={setColor}
              locked={themeColorsByLabel?.has(themeLabel)}
            />
          </div>
          <CommunicativeFunctionPicker value={commFunction} onChange={setCommFunction} />
        </div>
      )}

      {annotType === "desc" && (
        <div className="mb-2 flex flex-col gap-1.5">
          <ColorPalette value={color} onChange={setColor} />
          <CommunicativeFunctionPicker value={commFunction} onChange={setCommFunction} />
        </div>
      )}

      {/* Description — required for Desc type, optional for Plot/Theme */}
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={annotType === "desc" ? "Description" : "Description (optional)"}
        className="w-full px-1.5 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-transparent text-[10px] mb-2 placeholder:text-stone-400 dark:placeholder:text-stone-600"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
      />

      {/* Out-of-sequence checkbox */}
      <label className="flex items-center gap-1.5 mb-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={outOfSequence}
          onChange={(e) => setOutOfSequence(e.target.checked)}
          className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
        />
        <span className="text-[10px] text-stone-500 dark:text-stone-400">↩ Out of chronological sequence</span>
      </label>

      {/* Transitional (janus) checkbox */}
      <label className="flex items-center gap-1.5 mb-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={transitional}
          onChange={(e) => setTransitional(e.target.checked)}
          className="w-3 h-3 rounded accent-sky-500 cursor-pointer"
        />
        <span className="text-[10px] text-stone-500 dark:text-stone-400">⇔ {t("outlinePane.transitionalJanus")}</span>
      </label>

      {/* Buttons */}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-[10px] hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
        >
          ✕
        </button>
      </div>
      {saveError && <p className="text-[9px] text-red-500 mt-1">{saveError}</p>}
    </div>
  );
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

// ── TranslationTextarea ──────────────────────────────────────────────────────
// Controlled sub-component for editing a single translation verse.
// useEffect syncs `initialText` into local state so that calling onCancel
// (which restores initialText from the snapshot) also resets the textarea.
interface TranslationTextareaProps {
  initialText: string;
  abbr: string;
  verseNum: number;
  onSave: (abbr: string, verse: number, text: string) => void;
  onCancel: (abbr: string, verse: number) => void;
  sourceMode?: boolean;
}
function TranslationTextarea({ initialText, abbr, verseNum, onSave, onCancel, sourceMode }: TranslationTextareaProps) {
  const [value, setValue] = useState(initialText);
  const savedRef = useRef(false);
  const valueRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to onSave so the unmount cleanup always calls the latest version
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; });

  // If the parent resets initialText (e.g. after Cancel), mirror it here and allow saving again
  useEffect(() => {
    setValue(initialText);
    valueRef.current = initialText;
    savedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [initialText]);

  // On unmount (editing disabled / verse changed), save with trailing spaces trimmed
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSaveRef.current(abbr, verseNum, valueRef.current.trim());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function triggerSave(text: string) {
    // Auto-save during typing pauses — do NOT trim so the user can keep typing
    if (!savedRef.current) {
      savedRef.current = true;
      onSave(abbr, verseNum, text);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    valueRef.current = next;
    savedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerSave(valueRef.current), 2000);
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={handleChange}
        data-translation-textarea="true"
        data-verse={verseNum}
        data-abbr={abbr}
        onBlur={() => {
          // User navigated away — cancel debounce and save with trailing spaces trimmed
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = null;
          savedRef.current = true;
          onSave(abbr, verseNum, valueRef.current.trim());
        }}
        rows={sourceMode ? 4 : 3}
        className={[
          "w-full resize-y rounded border px-2 py-1 focus:outline-none focus:ring-1",
          sourceMode
            ? "font-mono text-xs border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 focus:ring-amber-400 text-amber-900 dark:text-amber-200"
            : "border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 focus:ring-sky-500",
        ].join(" ")}
        style={sourceMode ? { lineHeight: 1.7 } : {
          color: "var(--foreground)",
          fontSize: "var(--translation-font-size, 0.875rem)",
          lineHeight: 1.6,
        }}
        spellCheck={false}
      />
      <button
        type="button"
        // Prevent blur from firing before the click is processed
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          savedRef.current = true;
          onCancel(abbr, verseNum);
        }}
        className="mt-0.5 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 underline"
      >
        Cancel
      </button>
    </div>
  );
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
  synopticWordMarkColorMap,
  editingWordCompare = false,
  wordCompareRangeStartWordId = null,
  compactVerseLabels = false,
  prevVerseLastWordId,
  nextVerseFirstWordId,
  editingRefs,
  editingSpeech,
  activeCharId: _activeCharId,
  speechRangeStartWordId,
  tagRangeStartWordId = null,
  book,
  chapter,
  onSelectTranslationWord,
  onToggleTranslationParagraphBreak,
  highlightCharIds,
  onDeleteSpeechSection,
  onReassignSpeechSection,
  wordTagRefMap,
  wordTagMap,
  passageBoundsById,
  editingWordTags,
  clusterPickingActive = false,
  highlightWordTagIds,
  searchHits,
  findHits,
  findFocusId,
  lineIndentMap,
  translationIndentMap,
  indentsLinked = true,
  wordToParaStart,
  editingIndents,
  onSetSegmentIndent,
  onSetSegmentTvIndent,
  wordFormattingMap = new Map() as Map<string, { isBold: boolean; isItalic: boolean }>,
  editingFormatting = false,
  tcMarkMap,
  editingTc = false,
  onTcMarkWord,
  interlinearSubMode = "lemma" as InterlinearSubMode,
  constituentLabelMap = new Map<string, string>(),
  constituentGroupMap = new Map<string, string>(),
  datasetEntryMap = new Map<string, string>(),
  datasetDirection = "ltr",
  transliterationFormatMap = new Map<string, string>(),
  onSaveConstituentLabel,
  onSaveDatasetEntry,
  onSaveTransliterationFormat,
  onLemmaClick,
  datasetGroupMap = new Map<string, string>(),
  datasetLabelColors = new Map<string, string>(),
  datasetGroupingActive = false,
  pendingGroupWordIds = new Set<string>(),
  onToggleDatasetGroupMember,
  hideSourceText = false,
  editingTranslation = false,
  editingTranslationSource = false,
  onUpdateTranslationVerse,
  onCancelTranslationVerse,
  editingArrows = false,
  onSelectArrowWordById,
  sceneBreakMap = new Map() as Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }>>,
  editingScenes = false,
  onToggleSceneBreak,
  onChangeSceneHeading,
  onUpdateSceneHeading,
  onUpdateSceneOutOfSequence,
  onUpdateSceneExtendedThrough,
  onUpdateSceneThematic,
  onUpdateSceneTransitional,
  onChangeSceneBreakLevel,
  sectionRanges,
  annotationsBySegment,
  themeColorsByLabel,
  editingAnnotations = false,
  annotRangeStartWordId = null,
  annotRangeEndWordId = null,
  editingAnnotationId = null,
  onSetEditingAnnotationId,
  onSelectAnnotationSegment,
  onSaveAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onExpandAnnotationRange,
  showAnnotationCol = false,
  onVerseClick,
  rstSourcePad = 0,
  presentationMode = false,
  showAtnachBreaks = false,
  showSyllableStress = false,
  showVowels = true,
  showCantillation = true,
  translationFootnotes = [] as TranslationFootnote[],
  onDeleteFootnote,
  onEditFootnote,
  editingFootnotes = false,
  anchorMoveFootnote,
  onMoveFootnoteAnchor,
  hasActiveTranslations = false,
  translationVerseOffset = 0,
  translationVerseLabelFn,
}: VerseDisplayProps) {
  const { t } = useTranslation();
  const firstWordId = words[0]?.wordId;
  const verseStartsNewParagraph = firstWordId ? paragraphBreakIds.has(firstWordId) : false;


  const pilcrowClass = editingParagraphs
    ? "text-amber-500"
    : "text-stone-300 dark:text-stone-600";

  // ── Sub-verse letters for section break range labels ────────────────────
  // Maps each break wordId → sub-verse letter ("", "b", "c", …).
  // Derived from the verse's words array (already sorted by positionInVerse):
  // position 1 = verse start (no letter); subsequent mid-verse break positions get b, c, …
  const breakLetterMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!sceneBreakMap) return map;
    const wordsWithBreaks = words.filter((w) => sceneBreakMap.has(w.wordId));
    let midIdx = 0;
    for (const word of wordsWithBreaks) {
      if (word.positionInVerse === 1) {
        map.set(word.wordId, "");
      } else {
        map.set(word.wordId, String.fromCharCode(97 + 1 + midIdx));
        midIdx++;
      }
    }
    return map;
  }, [sceneBreakMap, words]);

  // ── Thematic annotation subscripts ──────────────────────────────────────
  // For "theme" annotations: when the same label letter appears more than once
  // in the chapter, each occurrence gets a subscript number (A₁, A₂, …).
  // Computed from annotationsBySegment in segment order (= document order).
  const thematicSubscripts = useMemo(() => {
    if (!annotationsBySegment) return new Map<number, number>();
    // Collect all theme annotation starts in segment order
    const starts: { id: number; label: string }[] = [];
    for (const entries of annotationsBySegment.values()) {
      for (const { annotation, isStart } of entries) {
        if (isStart && annotation.annotType === "theme") {
          starts.push({ id: annotation.id, label: annotation.label ?? "" });
        }
      }
    }
    // Pass 1: totals per label
    const totals = new Map<string, number>();
    for (const { label } of starts) totals.set(label, (totals.get(label) ?? 0) + 1);
    // Pass 2: assign subscripts where total > 1
    const running = new Map<string, number>();
    const result = new Map<number, number>();
    for (const { id, label } of starts) {
      if ((totals.get(label) ?? 0) > 1) {
        const n = (running.get(label) ?? 0) + 1;
        running.set(label, n);
        result.set(id, n);
      }
    }
    return result;
  }, [annotationsBySegment]);

  // ── Paragraph segments ──────────────────────────────────────────────────
  const sourceSegments = computeSegments(words, paragraphBreakIds);
  const multiSeg = sourceSegments.length > 1;
  const paraLabels = sourceSegments.map((_, si) =>
    multiSeg ? `${verseNum}${String.fromCharCode(97 + si)}` : `${verseNum}`
  );

  // ── Cross-verse speech continuation ──────────────────────────────────────
  // When any speech section (including nested ones) bridges into/from a
  // neighbouring verse we collapse the gap so coloured boxes appear unbroken.
  const crossFirstWord = sourceSegments[0]?.[0] ?? null;
  const crossLastSeg   = sourceSegments[sourceSegments.length - 1];
  const crossLastWord  = crossLastSeg[crossLastSeg.length - 1] ?? null;

  const crossPrevSecs  = prevVerseLastWordId
    ? (wordSpeechMap.get(prevVerseLastWordId) ?? []) : [];
  const crossFirstSecs = crossFirstWord
    ? (wordSpeechMap.get(crossFirstWord.wordId) ?? []) : [];
  const crossPrevIds   = new Set(crossPrevSecs.map((s) => s.id));
  const speechContinuesFromPrev = crossFirstSecs.some((s) => crossPrevIds.has(s.id));

  const crossNextSecs  = nextVerseFirstWordId
    ? (wordSpeechMap.get(nextVerseFirstWordId) ?? []) : [];
  const crossLastSecs  = crossLastWord
    ? (wordSpeechMap.get(crossLastWord.wordId) ?? []) : [];
  const crossNextIds   = new Set(crossNextSecs.map((s) => s.id));
  const speechContinuesIntoNext = crossLastSecs.some((s) => crossNextIds.has(s.id));

  // Annotation box: suppress inter-verse spacing when an annotation spans the verse boundary.
  const firstSegWordId = sourceSegments[0]?.[0]?.wordId ?? null;
  const lastSegWordId  = sourceSegments[sourceSegments.length - 1]?.[0]?.wordId ?? null;
  const annotContinuesFromPrev = !!(firstSegWordId &&
    (annotationsBySegment?.get(firstSegWordId) ?? []).some(e => !e.isStart));
  const annotContinuesIntoNext = !!(lastSegWordId &&
    (annotationsBySegment?.get(lastSegWordId) ?? []).some(e => !e.isEnd));


  // ── Speech box helpers ──────────────────────────────────────────────────
  // A LayerData describes one speech section that spans an entire paragraph segment.
  // Layers are ordered outermost (largest range) → innermost (smallest range).
  type LayerData = {
    segSpeech: SpeechSection;
    segSpeaker: Character;
    isSegStart: boolean; // this layer's box begins at this segment
    isSegEnd:   boolean; // this layer's box ends at this segment
  };

  type SegSpeechData = {
    // Back-compat aliases for callers that only care about the primary (outermost) layer
    segSpeech:  SpeechSection | null;
    segSpeaker: Character | null;
    isSegStart: boolean;
    isSegEnd:   boolean;
    // All layers (may be empty when the segment has no speech)
    layers: LayerData[];
  };

  function getSegSpeech(seg: Word[], si: number): SegSpeechData {
    const firstSecs = wordSpeechMap.get(seg[0].wordId) ?? [];
    const lastSecs  = wordSpeechMap.get(seg[seg.length - 1].wordId) ?? [];
    const lastIds   = new Set(lastSecs.map((s) => s.id));

    // A section "belongs to this segment" only if it covers the entire segment
    // (i.e. both the first and last word are inside the section).
    const segSections = firstSecs.filter((s) => lastIds.has(s.id));

    const prevWordId = si === 0
      ? prevVerseLastWordId
      : (sourceSegments[si - 1][sourceSegments[si - 1].length - 1]?.wordId ?? null);
    const nextWordId = si === sourceSegments.length - 1
      ? nextVerseFirstWordId
      : (sourceSegments[si + 1][0]?.wordId ?? null);
    const prevIds = new Set((prevWordId ? (wordSpeechMap.get(prevWordId) ?? []) : []).map((s) => s.id));
    const nextIds = new Set((nextWordId ? (wordSpeechMap.get(nextWordId) ?? []) : []).map((s) => s.id));

    const layers: LayerData[] = [];
    for (const section of segSections) {
      const speaker = characterMap.get(section.characterId) ?? null;
      if (!speaker) continue;
      layers.push({
        segSpeech:  section,
        segSpeaker: speaker,
        isSegStart: !prevIds.has(section.id),
        isSegEnd:   !nextIds.has(section.id),
      });
    }

    const outer = layers[0] ?? null;
    return {
      segSpeech:  outer?.segSpeech  ?? null,
      segSpeaker: outer?.segSpeaker ?? null,
      isSegStart: outer?.isSegStart ?? false,
      isSegEnd:   outer?.isSegEnd   ?? false,
      layers,
    };
  }

  // Build the CSS style for one nesting layer of a speech box.
  // depth=0 → outermost (extends slightly to the left with a negative margin).
  // depth=1 → next inner layer (slightly less extension, so bars stack visually).
  // depth≥2 → innermost; no extension beyond the text area.
  function segBoxStyle(
    segSpeaker: Character | null,
    isSegStart: boolean,
    isSegEnd: boolean,
    depth: number = 0
  ): React.CSSProperties {
    if (!segSpeaker) return {};
    const side = `3px solid ${segSpeaker.color}`;
    const edge = `1.5px solid ${segSpeaker.color}`;
    // Each depth level is 0.375 rem less extended than the previous.
    // depth 0 → 0.75 rem extension (the original), depth 1 → 0.375 rem, depth 2+ → 0 rem
    const extRem = Math.max(0, 0.75 - depth * 0.375);
    const radius = depth === 0 ? "4px" : "2px";
    return {
      backgroundColor: `${segSpeaker.color}0C`,
      borderLeft:   isHebrew ? "none" : side,
      borderRight:  isHebrew ? side   : "none",
      borderTop:    isSegStart ? edge : "none",
      borderBottom: isSegEnd   ? edge : "none",
      paddingLeft:  isHebrew ? "0.5rem"        : `${extRem}rem`,
      paddingRight: isHebrew ? `${extRem}rem`  : "0.5rem",
      marginLeft:   isHebrew ? 0               : `-${extRem}rem`,
      marginRight:  isHebrew ? `-${extRem}rem` : 0,
      borderRadius: [
        isSegStart ? radius : "0",
        isSegStart ? radius : "0",
        isSegEnd   ? radius : "0",
        isSegEnd   ? radius : "0",
      ].join(" "),
      position: "relative",
    };
  }

  // Render all speech-section control badges for a segment row.
  // All badges are placed in a single absolutely-positioned container so they
  // never overlap regardless of how many nesting layers are present.
  function renderDeleteBtns(layers: LayerData[]): React.ReactNode {
    if (!editingSpeech) return null;
    // Only show badges for layers whose box starts at this segment.
    const startLayers = layers.filter((l) => l.isSegStart);
    if (startLayers.length === 0) return null;
    return (
      <div
        className="absolute flex items-center gap-1 z-20"
        style={{ top: "4px", ...(isHebrew ? { left: "4px" } : { right: "4px" }) }}
      >
        {startLayers.map(({ segSpeaker, segSpeech }) => {
          const canReassign =
            onReassignSpeechSection &&
            _activeCharId !== null &&
            _activeCharId !== segSpeech.characterId;
          return (
            <React.Fragment key={segSpeech.id}>
              {/* Character badge — click to reassign */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (canReassign) onReassignSpeechSection!(segSpeech.id, _activeCharId!);
                }}
                className="flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold leading-none transition-opacity"
                style={{
                  backgroundColor: segSpeaker.color,
                  opacity: canReassign ? 1 : 0.55,
                  cursor: canReassign ? "pointer" : "default",
                }}
                title={
                  canReassign
                    ? `Reassign to active character`
                    : `${segSpeaker.name} — select a different character above to reassign`
                }
              >
                {segSpeaker.name[0]?.toUpperCase() ?? "?"}
              </button>
              {/* Delete button */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDeleteSpeechSection(segSpeech.id); }}
                className="flex items-center justify-center w-4 h-4 rounded-full text-white text-xs leading-none bg-stone-500 dark:bg-stone-400 hover:bg-red-500 dark:hover:bg-red-500 transition-colors"
                title={`Delete "${segSpeaker.name}" speech section`}
              >
                ×
              </button>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // Wrap content in nested speech-box divs (outermost → innermost).
  // The innermost div carries the grid/layout styles; outer divs are purely decorative borders.
  // innerProps is spread onto the innermost div — use for attributes like dir="rtl".
  function wrapInSpeechLayers(
    layers:       LayerData[],
    innerContent: React.ReactNode,
    innerStyle:   React.CSSProperties,
    innerClass:   string,
    innerProps?:  React.HTMLAttributes<HTMLDivElement>
  ): React.ReactNode {
    if (layers.length === 0) {
      return (
        <div className={innerClass} style={innerStyle} {...(innerProps ?? {})}>
          {innerContent}
        </div>
      );
    }

    // Single layer: one div carries both the grid styles and the speech box style.
    if (layers.length === 1) {
      const layer = layers[0];
      return (
        <div
          className={innerClass}
          style={{ ...innerStyle, ...segBoxStyle(layer.segSpeaker, layer.isSegStart, layer.isSegEnd, 0) }}
          {...(innerProps ?? {})}
        >
          {renderDeleteBtns(layers)}
          {innerContent}
        </div>
      );
    }

    // Multiple layers: build from innermost outward. The innermost div carries the
    // grid styles; outer divs are purely decorative borders.
    const innermostLayer = layers[layers.length - 1];
    let node: React.ReactNode = (
      <div
        className={innerClass}
        style={{ ...innerStyle, ...segBoxStyle(innermostLayer.segSpeaker, innermostLayer.isSegStart, innermostLayer.isSegEnd, layers.length - 1) }}
        {...(innerProps ?? {})}
      >
        {innerContent}
      </div>
    );

    // Wrap each intermediate layer (if any) — no grid styles, just box border/background.
    for (let i = layers.length - 2; i >= 1; i--) {
      const layer = layers[i];
      node = (
        <div style={segBoxStyle(layer.segSpeaker, layer.isSegStart, layer.isSegEnd, i)}>
          {node}
        </div>
      );
    }

    // Outermost layer: also carries all delete/reassign badge buttons.
    const outermostLayer = layers[0];
    node = (
      <div style={segBoxStyle(outermostLayer.segSpeaker, outermostLayer.isSegStart, outermostLayer.isSegEnd, 0)}>
        {renderDeleteBtns(layers)}
        {node}
      </div>
    );

    return node;
  }

  // ── Section break separator ──────────────────────────────────────────────
  // Renders stacked section break separators for all levels at a wordId position.
  // Levels 1–6: decreasing size and weight; level 1 is topmost (rendered first).
  function renderSceneSeparator(wordId: string): React.ReactNode {
    const breaks = sceneBreakMap?.get(wordId) ?? [];
    // Sort by level ascending (level 1 = highest priority, displayed first)
    const sorted = [...breaks].sort((a, b) => a.level - b.level);
    const existingLevels = new Set(sorted.map((b) => b.level));
    const missingLevels = ([1, 2, 3, 4, 5, 6] as const).filter((l) => !existingLevels.has(l));
    // Verse comes from the first break (all share the same wordId/verse)
    const verse = sorted[0]?.verse ?? 0;

    function lineClass(level: number): string {
      switch (level) {
        case 1: return "border-t-4";
        case 2: return "border-t-2";
        case 3: return "border-t";
        case 4: return "border-t border-dashed";
        case 5: return "border-t border-dotted";
        case 6: return "border-t border-dotted opacity-60";
        default: return "border-t";
      }
    }

    function headingClass(level: number): string {
      if (presentationMode) {
        switch (level) {
          case 1: return "text-[31px] font-bold uppercase tracking-widest text-stone-800 dark:text-stone-100";
          case 2: return "text-[26px] font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-200";
          case 3: return "text-[22px] font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300";
          case 4: return "text-[20px] font-normal uppercase tracking-wide text-stone-500 dark:text-stone-400";
          case 5: return "text-[18px] font-normal uppercase tracking-normal text-stone-500 dark:text-stone-400";
          case 6: return "text-[18px] font-normal text-stone-500 dark:text-stone-400";
          default: return "text-[20px] text-stone-500 dark:text-stone-400";
        }
      }
      switch (level) {
        case 1: return "text-[15px] font-bold uppercase tracking-widest text-stone-800 dark:text-stone-100";
        case 2: return "text-[13px] font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-200";
        case 3: return "text-[12px] font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300";
        case 4: return "text-[12px] font-normal uppercase tracking-wide text-stone-500 dark:text-stone-400";
        case 5: return "text-[11px] font-normal uppercase tracking-normal text-stone-500 dark:text-stone-400";
        case 6: return "text-[11px] font-normal text-stone-500 dark:text-stone-400";
        default: return "text-[13px] text-stone-500 dark:text-stone-400";
      }
    }

    function lineColorClass(level: number): string {
      if (editingScenes) return "border-amber-400";
      switch (level) {
        case 1: return "border-stone-700 dark:border-stone-200";
        case 2: return "border-stone-600 dark:border-stone-300";
        case 3: return "border-stone-500 dark:border-stone-400";
        default: return "border-stone-400 dark:border-stone-500";
      }
    }

    function rangeLabel(br: { level: number; verse: number }): string {
      const key = `${wordId}:${br.level}`;
      const range = sectionRanges?.get(key);
      const letter = breakLetterMap.get(wordId) ?? "";
      const startVerseStr = `${br.verse}${letter}`;
      if (!range) return `(${startVerseStr})`;
      // Single-chapter books have no useful chapter prefix; all others include it
      // so that whole-chapter ranges like "(4:1–24)" are unambiguous.
      const showCh = !SINGLE_CHAPTER_BOOKS.has(book);
      if (chapter === range.endChapter) {
        if (br.verse === range.endVerse && !letter) {
          return showCh ? `(${chapter}:${startVerseStr})` : `(${startVerseStr})`;
        }
        return showCh
          ? `(${chapter}:${startVerseStr}–${range.endVerse})`
          : `(${startVerseStr}–${range.endVerse})`;
      }
      return `(${chapter}:${startVerseStr} – ${range.endChapter}:${range.endVerse})`;
    }

    return (
      <div className="mt-5 mb-2" onClick={editingScenes ? (e) => e.stopPropagation() : undefined}>
        {/* Render each existing break stacked */}
        {sorted.map((br, i) => (
          <div key={`${wordId}-${br.level}-${i}`} className="mb-1">
            {editingScenes ? (
              <div className="flex flex-col gap-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0 w-10">L{br.level}:</span>
                  <input
                    id={`scene-heading-${wordId}-${br.level}`}
                    key={`${wordId}-${br.level}`}
                    className="flex-1 min-w-0 text-xs font-semibold tracking-widest text-stone-500 dark:text-stone-400 bg-transparent border-none outline-none focus:ring-0 px-0 placeholder:text-stone-300 dark:placeholder:text-stone-600"
                    defaultValue={br.heading ?? ""}
                    placeholder="Section label"
                    onChange={(e) => onChangeSceneHeading?.(wordId, br.level, e.target.value)}
                    onBlur={(e) => onUpdateSceneHeading?.(wordId, br.level, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); e.stopPropagation(); }}
                  />
                  <button
                    type="button"
                    title={`Remove level ${br.level} break`}
                    onClick={() => onToggleSceneBreak?.(wordId, br.level, br.verse)}
                    className="shrink-0 text-stone-400 hover:text-red-500 dark:hover:text-red-400 text-base leading-none transition-colors select-none"
                  >×</button>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none ml-10">
                  <input
                    type="checkbox"
                    checked={br.outOfSequence}
                    onChange={(e) => onUpdateSceneOutOfSequence?.(wordId, br.level, e.target.checked)}
                    className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-stone-400 dark:text-stone-500">Out of sequence</span>
                </label>
                <div className="flex items-center gap-1.5 ml-10">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={br.thematic}
                      onChange={(e) => onUpdateSceneThematic?.(wordId, br.level, e.target.checked, br.thematicLetter ?? "A")}
                      className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">Thematic</span>
                  </label>
                  {br.thematic && (
                    <select
                      value={br.thematicLetter ?? "A"}
                      onChange={(e) => onUpdateSceneThematic?.(wordId, br.level, true, e.target.value)}
                      className="text-[10px] text-stone-500 dark:text-stone-400 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none cursor-pointer"
                    >
                      {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  )}
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none ml-10">
                  <input
                    type="checkbox"
                    checked={br.transitional}
                    onChange={(e) => onUpdateSceneTransitional?.(wordId, br.level, e.target.checked)}
                    className="w-3 h-3 rounded accent-sky-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-stone-400 dark:text-stone-500">{t("outlinePane.transitionalJanus")}</span>
                </label>
                {book === "Ps" && (
                  <div className="flex items-center gap-1.5 ml-10">
                    <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0">Group through Ps:</span>
                    <input
                      type="number"
                      min={chapter}
                      max={150}
                      value={br.extendedThrough ?? chapter}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        const next = isNaN(val) || val <= chapter ? null : val;
                        onUpdateSceneExtendedThrough?.(wordId, br.level, next);
                      }}
                      className="w-12 text-[10px] text-stone-500 dark:text-stone-400 bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none text-center"
                      title="Extend range through this psalm number (e.g. enter 10 to group Ps 9+10)"
                    />
                  </div>
                )}
                {/* Change level buttons — move this break to a different level */}
                {([1, 2, 3, 4, 5, 6] as const).filter(l => l !== br.level && !existingLevels.has(l)).length > 0 && (
                  <div className="flex items-center gap-1 ml-10">
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">Change level:</span>
                    {([1, 2, 3, 4, 5, 6] as const)
                      .filter(l => l !== br.level && !existingLevels.has(l))
                      .map(l => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => onChangeSceneBreakLevel?.(wordId, br.level, l, br.verse)}
                          className="text-[10px] px-1.5 h-5 rounded font-semibold bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors"
                          title={`Change this break from level ${br.level} to level ${l}`}
                        >
                          {l}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : (br.heading || br.outOfSequence || br.transitional) ? (
              <div className="flex items-center gap-1.5 pb-0.5 select-none">
                {br.outOfSequence && (
                  <span className="text-[10px] font-bold text-amber-500 dark:text-amber-400 shrink-0" title="Out of chronological sequence">↩</span>
                )}
                {br.transitional && (
                  <span className="text-[10px] font-bold text-sky-500 dark:text-sky-400 shrink-0" title={t("outlinePane.transitionalJanus")}>⇔</span>
                )}
                {br.heading && (
                  <span className={headingClass(br.level)}>{br.heading}</span>
                )}
                <span className="text-[10px] text-stone-400 dark:text-stone-500 opacity-60 select-none shrink-0">
                  {rangeLabel(br)}
                </span>
              </div>
            ) : (
              <div className="pb-0.5 select-none">
                <span className="text-[10px] text-stone-400 dark:text-stone-500 opacity-60">
                  {rangeLabel(br)}
                </span>
              </div>
            )}
            <div className={`w-full ${lineClass(br.level)} ${lineColorClass(br.level)}`} />
          </div>
        ))}

        {/* Add level row — shown in editing mode when fewer than 6 levels present */}
        {editingScenes && missingLevels.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-[10px] text-stone-400 dark:text-stone-500">Add level:</span>
            {missingLevels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onToggleSceneBreak?.(wordId, l, verse)}
                className="text-[10px] px-1.5 h-5 rounded font-semibold bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors"
                title={`Add level ${l} section break here`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Annotation column renderer ───────────────────────────────────────────
  // Renders the right-hand annotation column for one paragraph segment.
  // Returns null when showAnnotationCol is false.
  function renderAnnotationColForSeg(segFirstWordId: string): React.ReactNode {
    if (!showAnnotationCol) return null;

    const entries = annotationsBySegment?.get(segFirstWordId) ?? [];
    const isRangeStart  = annotRangeStartWordId === segFirstWordId;
    const isRangeEnd    = annotRangeEndWordId   === segFirstWordId;
    const showHint      = editingAnnotations && isRangeStart && !annotRangeEndWordId;
    const showForm      = editingAnnotations && isRangeStart && !!annotRangeEndWordId;
    const isHighlighted = isRangeStart || isRangeEnd;

    return (
      <div
        className={[
          presentationMode ? "w-72" : "w-48",
          "flex-none pl-3 self-stretch flex flex-col",
          editingAnnotations
            ? "cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded transition-colors"
            : "",
          isHighlighted ? "ring-1 ring-inset ring-indigo-400/60 rounded" : "",
        ].filter(Boolean).join(" ")}
        onClick={
          editingAnnotations
            ? (e) => { e.stopPropagation(); onSelectAnnotationSegment?.(segFirstWordId, e.shiftKey); }
            : undefined
        }
      >
        {/* Existing annotations for this segment */}
        {entries.map(({ annotation, isStart, isEnd }) => (
          <AnnotBadge
            key={annotation.id}
            annotation={annotation}
            isStart={isStart}
            isEnd={isEnd}
            editingAnnotations={editingAnnotations}
            isEditing={editingAnnotationId === annotation.id}
            onSetEditing={(v) => onSetEditingAnnotationId?.(v ? annotation.id : null)}
            presentationMode={presentationMode}
            thematicSubscript={isStart ? thematicSubscripts.get(annotation.id) : undefined}
            themeColorsByLabel={themeColorsByLabel}
            onDelete={onDeleteAnnotation}
            onUpdate={onUpdateAnnotation}
            onAdjustRange={onExpandAnnotationRange}
          />
        ))}

        {/* Hint while waiting for the range end */}
        {showHint && (
          <div className="text-[10px] text-indigo-500 dark:text-indigo-400 italic leading-tight py-0.5">
            Click end segment →
          </div>
        )}

        {/* Inline creation form */}
        {showForm && (
          <AnnotCreationForm
            key={segFirstWordId}
            themeColorsByLabel={themeColorsByLabel}
            onSave={(data) => onSaveAnnotation?.(data) ?? Promise.resolve(false)}
            onCancel={() => onCancelAnnotation?.()}
          />
        )}
      </div>
    );
  }

  // ── Syllable/stress column renderer ──────────────────────────────────────
  // Renders a fixed-width column past the end of one poetic line's (paragraph
  // segment's) Hebrew text, showing "stresses / syllables" for that line.
  // Fixed width keeps the numbers aligned vertically across every line.
  function renderSyllableStressColForSeg(seg: Word[]): React.ReactNode {
    if (!showSyllableStress || !isHebrew) return null;
    const { stresses, syllables } = analyzeHebrewLine(seg);
    const labelPaddingTop = "var(--source-half-leading, calc(0.75 * var(--hebrew-font-size, 1.375rem)))";
    return (
      <div
        className="flex-none pr-2 self-stretch flex flex-col items-end"
        style={{ minWidth: "3.5rem" }}
      >
        <span
          className="text-sm font-mono tabular-nums whitespace-nowrap text-stone-400 dark:text-stone-600"
          style={{ paddingTop: labelPaddingTop }}
          title={`${stresses} stress${stresses === 1 ? "" : "es"} · ${syllables} syllable${syllables === 1 ? "" : "s"}`}
        >
          {stresses}<span className="opacity-50 mx-0.5">/</span>{syllables}
        </span>
      </div>
    );
  }

  // Returns the appropriate separator for a paragraph-starting word:
  // scene break → solid HR + heading; regular paragraph break → dashed line.
  function renderSegSeparator(wordId: string): React.ReactNode {
    if ((sceneBreakMap.get(wordId)?.length ?? 0) > 0) return renderSceneSeparator(wordId);
    if (editingParagraphs) {
      const breakWord = words.find((w) => w.wordId === wordId);
      return (
        <div className="relative flex items-center mb-2">
          <div className="flex-1 border-t border-dashed border-amber-400" />
          {breakWord && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelectWord(breakWord); }}
              title="Remove paragraph break"
              className="mx-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[11px] leading-none hover:bg-amber-500 shrink-0"
            >
              ×
            </button>
          )}
          <div className="flex-1 border-t border-dashed border-amber-400" />
        </div>
      );
    }
    return (
      <div
        className="w-full border-t border-dashed mb-2 border-stone-300 dark:border-stone-600"
        aria-hidden="true"
      />
    );
  }

  // ── Word runs ───────────────────────────────────────────────────────────
  type SegRun = { inlineSec: SpeechSection | null; words: Word[] };

  // For words that only partially fall inside a speech section (the section starts
  // or ends mid-segment), we render them with an inline background tint + a small
  // delete badge.  With nested sections the "inline" section is the innermost one
  // that is NOT already shown as a full-segment box layer.
  function computeRuns(seg: Word[], layers: LayerData[]): SegRun[] {
    const segSecIds = new Set(layers.map((l) => l.segSpeech.id));
    const runs: SegRun[] = [];
    seg.forEach((w) => {
      const secs = wordSpeechMap.get(w.wordId) ?? [];
      // Pick the innermost (last) section that isn't a segment-level layer
      const inlineSec = [...secs].reverse().find((s) => !segSecIds.has(s.id)) ?? null;
      const last = runs[runs.length - 1];
      if (last && last.inlineSec?.id === inlineSec?.id) last.words.push(w);
      else runs.push({ inlineSec, words: [w] });
    });
    return runs;
  }

  // ── Tag-group helpers ────────────────────────────────────────────────────
  // Group adjacent words that share the same character-ref AND word-tag so they
  // can be wrapped in a single styled span — producing a continuous highlight /
  // outline box instead of separate per-word rings.

  type WordGroup = {
    charRef: CharacterRef | null;
    wordTagRef: WordTagRef | null;
    wordTag: WordTag | null;
    words: Word[];
  };

  // Hebrew maqqef (־) glues two words together with no space; the following
  // word's <w> is adjacent in the source text, so suppress the inter-word gap.
  const MAQQEF = "־";
  function endsWithMaqqef(word: Word): boolean {
    return (word.surfaceText ?? "").replace(/\//g, "").endsWith(MAQQEF);
  }

  // Resolves a word-tag-ref's tag, but treats a "passage"-scoped tag as absent
  // once this verse (book/chapter/verseNum are constant for this whole
  // VerseDisplay render) falls outside the passage's actual start/end verse —
  // chapterFallsInPassage alone only clips at chapter granularity, so e.g. a
  // tag scoped to "Gen 1:1–2:3" would otherwise stay visible through all of
  // chapter 2 rather than just verse 3.
  function resolveTag(tagId: number): WordTag | null {
    const wt = wordTagMap.get(tagId) ?? null;
    if (!wt) return null;
    if (wt.corpusType === "passage" && wt.corpusPassageId != null) {
      const bounds = passageBoundsById?.get(wt.corpusPassageId);
      if (bounds && !wordFallsInPassageRange(bounds, book, chapter, verseNum)) return null;
    }
    return wt;
  }

  // Same clipping as resolveTag(), for "passage"-scoped characters.
  function resolveCharacter(characterId: number): Character | null {
    const c = characterMap.get(characterId) ?? null;
    if (!c) return null;
    if (c.corpusType === "passage" && c.corpusPassageId != null) {
      const bounds = passageBoundsById?.get(c.corpusPassageId);
      if (bounds && !wordFallsInPassageRange(bounds, book, chapter, verseNum)) return null;
    }
    return c;
  }

  function computeWordGroups(words: Word[]): WordGroup[] {
    const groups: WordGroup[] = [];
    for (const word of words) {
      const cr  = characterRefMap.get(word.wordId) ?? null;
      const wtr = wordTagRefMap.get(word.wordId)   ?? null;
      const wt  = wtr ? resolveTag(wtr.tagId) : null;
      const crKey  = cr  ? `${cr.character1Id}:${cr.character2Id ?? ""}` : "";
      const last   = groups[groups.length - 1];
      const lastCrKey = last?.charRef
        ? `${last.charRef.character1Id}:${last.charRef.character2Id ?? ""}`
        : "";
      const sameGroup =
        last &&
        crKey === lastCrKey &&
        (last.wordTagRef?.tagId ?? null) === (wtr?.tagId ?? null);
      if (sameGroup) {
        last.words.push(word);
      } else {
        groups.push({ charRef: cr, wordTagRef: wtr, wordTag: wt, words: [word] });
      }
    }
    return groups;
  }

  function renderWordGroups(words: Word[]): React.ReactNode {
    const groups = computeWordGroups(words);
    const elements: React.ReactNode[] = [];

    groups.forEach((group, gi) => {
      const { charRef, wordTagRef: groupWtr, wordTag, words: gWords } = group;

      const isCharHighlighted =
        charRef != null &&
        ((resolveCharacter(charRef.character1Id) != null && highlightCharIds.has(charRef.character1Id)) ||
          (charRef.character2Id != null &&
            resolveCharacter(charRef.character2Id) != null &&
            highlightCharIds.has(charRef.character2Id)));

      const isTagHighlighted =
        wordTag != null && highlightWordTagIds.has(wordTag.id);

      // Build the wrapper style for this group
      const wrapperStyle: React.CSSProperties = {};
      if (isCharHighlighted) {
        wrapperStyle.backgroundColor = "rgba(253, 224, 71, 0.45)";
        wrapperStyle.borderRadius = "3px";
      }
      if (wordTag && !isCharHighlighted) {
        wrapperStyle.backgroundColor = isTagHighlighted
          ? `${wordTag.color}55`
          : `${wordTag.color}28`;
        wrapperStyle.borderRadius = "3px";
      }

      const hasStyle = isCharHighlighted || wordTag != null;

      // Render words inside the group (spaces between them are INSIDE the
      // wrapper, so the background fills the inter-word gap).

      // Build underline style for inter-word spaces when a character tag is active.
      const char1 = charRef ? resolveCharacter(charRef.character1Id) : null;
      const char2 = charRef?.character2Id != null ? resolveCharacter(charRef.character2Id) : null;
      const spaceUnderlineStyle: React.CSSProperties | undefined = char1 && char2 ? {
        backgroundImage: `repeating-linear-gradient(to right, ${char1.color} 0px, ${char1.color} 4px, ${char2.color} 4px, ${char2.color} 8px)`,
        backgroundSize: "100% 2px",
        backgroundPosition: "center bottom",
        backgroundRepeat: "no-repeat",
        paddingBottom: isHebrew ? "6px" : "2px",
      } : char1 ? {
        backgroundImage: `linear-gradient(to right, ${char1.color}, ${char1.color})`,
        backgroundSize: "100% 2px",
        backgroundPosition: "center bottom",
        backgroundRepeat: "no-repeat",
        paddingBottom: isHebrew ? "6px" : "2px",
      } : undefined;

      const isInterlinear = displayMode === "interlinear";
      // Gated on isInterlinear too: interlinearSubMode stays set to a dataset
      // (or constituent) even after switching back to Clean/Color, so without
      // this the grouped label overlay (and its highlight) kept rendering
      // outside Interlinear mode until the component remounted (e.g.
      // navigating chapters).
      const isDatasetMode = isInterlinear && typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset";
      const isConstituentGroupMode = isInterlinear && interlinearSubMode === "constituent";
      // Word grouping (New/Edit/Save grouping) is shared by two features —
      // custom datasets and built-in constituent labeling — since only one
      // can be active at a time. Resolve to whichever is active so the rest
      // of the rendering below doesn't need to branch per-feature.
      const activeGroupMap = isDatasetMode ? datasetGroupMap : isConstituentGroupMode ? constituentGroupMap : undefined;
      const activeValueMap = isDatasetMode ? datasetEntryMap : isConstituentGroupMode ? constituentLabelMap : undefined;
      const activeLabelColors = isDatasetMode ? datasetLabelColors : new Map<string, string>();
      const isGroupingCapableMode = isDatasetMode || isConstituentGroupMode;

      function renderWord(word: Word, wi: number): React.ReactNode {
        const wordHasAtnach =
          showAtnachBreaks &&
          isHebrew &&
          (word.surfaceText ?? "").includes("\u0591");
        const isSearchHit  = searchHits?.has(word.wordId) ?? false;
        const isFindHit    = findHits?.has(word.wordId) ?? false;
        const isFindFocus  = findFocusId != null && findFocusId === word.wordId;
        const wrapperBg = isFindFocus
          ? "rgba(251, 146, 60, 0.65)"   // orange — current focus
          : isFindHit
            ? "rgba(251, 191, 36, 0.45)" // yellow — other hits
            : isSearchHit
              ? "rgba(251, 191, 36, 0.4)"
              : undefined;
        const isLastInGroup = wi === gWords.length - 1;
        const isPendingGroupMember = isGroupingCapableMode && pendingGroupWordIds.has(word.wordId);
        const savedGroupId = activeGroupMap?.get(word.wordId);
        const datasetHighlightBg = isPendingGroupMember
          ? "rgba(37, 99, 235, 0.35)"
          : savedGroupId
            ? resolvedDatasetColor(activeValueMap?.get(word.wordId) ?? savedGroupId, activeLabelColors)
            : undefined;
        // In interlinear mode, highlights must be scoped to the source-text span
        // inside WordToken (not the outer wrapper, which covers both rows).
        const wordHighlightBg = isInterlinear
          ? (wrapperBg ?? (hasStyle ? wrapperStyle.backgroundColor as string | undefined : undefined) ?? datasetHighlightBg)
          : wrapperBg;
        return (
          <span
            key={word.wordId}
            style={(!isInterlinear && wrapperBg) ? { backgroundColor: wrapperBg, borderRadius: "2px" } : undefined}
          >
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
              characterRef={charRef}
              characterMap={characterMap}
              editingRefs={editingRefs}
              editingSpeech={editingSpeech}
              isRangeStart={word.wordId === speechRangeStartWordId || word.wordId === tagRangeStartWordId || word.wordId === wordCompareRangeStartWordId}
              highlightCharIds={highlightCharIds}
              synopticMarkColor={synopticWordMarkColorMap?.get(word.wordId) ?? null}
              editingWordCompare={editingWordCompare}
              wordTagRef={groupWtr}
              wordTagMap={wordTagMap}
              editingWordTags={editingWordTags}
              highlightWordTagIds={highlightWordTagIds}
              wordFormatting={wordFormattingMap.get(word.wordId) ?? null}
              editingFormatting={editingFormatting}
              tcMark={tcMarkMap?.get(word.wordId) ?? null}
              interlinearSubMode={interlinearSubMode}
              constituentLabel={constituentLabelMap.get(word.wordId)}
              datasetValue={datasetEntryMap.get(word.wordId)}
              datasetDirection={datasetDirection}
              suppressDatasetValueDisplay={!!savedGroupId}
              transliterationFormat={transliterationFormatMap.get(word.wordId)}
              onSaveConstituentLabel={onSaveConstituentLabel}
              onSaveDatasetEntry={onSaveDatasetEntry}
              onSaveTransliterationFormat={onSaveTransliterationFormat}
              onLemmaClick={onLemmaClick}
              showVowels={showVowels}
              showCantillation={showCantillation}
              wordHighlightBg={wordHighlightBg}
              datasetGroupingActive={isGroupingCapableMode && datasetGroupingActive}
              isPendingGroupMember={isPendingGroupMember}
              onToggleDatasetGroupMember={onToggleDatasetGroupMember}
            />
            {wordHasAtnach && (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  width: "1px",
                  height: "1.1em",
                  backgroundColor: "#7c3aed",
                  opacity: 0.55,
                  margin: "0 0.35em",
                }}
              />
            )}
            {!isLastInGroup && !endsWithMaqqef(word) && (
              spaceUnderlineStyle
                ? <span style={spaceUnderlineStyle}>{" "}</span>
                : " "
            )}
          </span>
        );
      }

      const inner = gWords.map((word, wi) => {
        const savedGroupId = activeGroupMap?.get(word.wordId);
        if (!savedGroupId) return renderWord(word, wi);

        // Contiguous runs of words sharing a grouping render as one unit, with
        // a single centered label spanning the run instead of a per-word value.
        const prevGid = wi > 0 ? activeGroupMap?.get(gWords[wi - 1].wordId) : undefined;
        if (savedGroupId === prevGid) return null; // consumed by the run's start below

        const runWords = [word];
        let j = wi + 1;
        while (j < gWords.length && activeGroupMap?.get(gWords[j].wordId) === savedGroupId) {
          runWords.push(gWords[j]);
          j++;
        }
        const groupValue = activeValueMap?.get(word.wordId);

        return (
          <span key={`grp-${word.wordId}`} className="word-interlinear-group" style={{ position: "relative", display: "inline-flex" }}>
            {runWords.map((w, k) => renderWord(w, wi + k))}
            {/* Centered label spanning the whole run. Purely a visual/click
                proxy — clicking it forwards to the run's first word's own
                (blank, since its value display is suppressed) interlinear
                label span, which already has the real click behavior:
                toggling group membership in grouping mode, or opening the
                value-edit popover otherwise. */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                const wrapper = (e.currentTarget as HTMLElement).parentElement;
                wrapper?.querySelector<HTMLElement>(".word-parse")?.click();
              }}
              title={datasetGroupingActive ? "Click to add/remove from grouping" : "Click to edit"}
              className={[
                "absolute left-0 right-0 bottom-0 text-center cursor-pointer rounded px-0.5",
                datasetGroupingActive
                  ? "hover:bg-blue-100 dark:hover:bg-blue-900/40"
                  : "hover:bg-stone-100 dark:hover:bg-stone-700",
              ].join(" ")}
              style={{
                fontFamily: isHebrew ? '"Ezra SIL", "SBL Hebrew", serif' : '"Gentium Plus", "GFS Didot", serif',
                fontSize: "0.72em",
                lineHeight: 1.2,
                color: "var(--interlinear-color)",
              }}
            >
              {groupValue}
            </span>
          </span>
        );
      });

      // Wrap in a styled span (or plain span when unstyled); space between
      // groups goes OUTSIDE so it isn't coloured by the adjacent group.
      const groupWrapperStyle = hasStyle
        ? (displayMode === "interlinear"
            ? { borderRadius: wrapperStyle.borderRadius }  // keep shape, drop bg (bg goes to text span)
            : wrapperStyle)
        : undefined;
      elements.push(
        <span key={gi} style={groupWrapperStyle}>
          {inner}
        </span>
      );
      if (gi < groups.length - 1 && !endsWithMaqqef(gWords[gWords.length - 1])) elements.push(" ");
    });

    return elements;
  }

  function renderRuns(runs: SegRun[]): React.ReactNode {
    return runs.map((run, ri) => {
      const runChar = run.inlineSec ? characterMap.get(run.inlineSec.characterId) : null;
      const runStyle: React.CSSProperties = runChar
        ? { backgroundColor: `${runChar.color}0C` } : {};
      return (
        <span key={ri} style={runStyle}>
          {renderWordGroups(run.words)}
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
  // Skip this early-return when a translation IS active but just has no text
  // for this verse yet — fall through to the two-column layout instead so
  // the placeholder column stays visible.
  if (translationTexts.length === 0 && !hasActiveTranslations) {
    return (
      <div id={`verse-${verseNum}`} className={`${verseStartsNewParagraph ? "mt-5" : ""} ${(speechContinuesIntoNext || annotContinuesIntoNext) ? "" : "mb-4"}`}>
        {verseStartsNewParagraph && firstWordId && renderSegSeparator(firstWordId)}
        {sourceSegments.map((seg, si) => {
          const { layers, isSegStart } = getSegSpeech(seg, si);
          const runs = computeRuns(seg, layers);
          const paraStartId = wordToParaStart.get(seg[0].wordId) ?? seg[0].wordId;
          const indentLevel = lineIndentMap.get(paraStartId) ?? 0;
          // ── Hanging-indent label and source elements ──────────────
          // Half-leading of the source text — pushes the verse label down so its
          // text visually aligns with the first character of the source line.
          // Uses --source-half-leading (set by parent, scales with lineHeightMultiplier);
          // falls back to the static value: Hebrew (lh=2.5) → 0.75×fontSize,
          //                                 Greek  (lh=2.25) → 0.625×fontSize.
          const labelPaddingTop = isHebrew
            ? "var(--source-half-leading, calc(0.75 * var(--hebrew-font-size, 1.375rem)))"
            : "var(--source-half-leading, calc(0.625 * var(--greek-font-size, 1.25rem)))";
          // ~3 characters (fits a 2-3 digit verse number) plus a 1-2 character
          // gap before the text — vs. the spacious 5rem default reading-view gutter.
          const verseLabelMinWidth = compactVerseLabels ? "3ch" : "5rem";

          const segLabelEl = editingIndents ? (
            <div className="flex items-start gap-0.5" data-seg-label={seg[0].wordId} style={{ minWidth: verseLabelMinWidth }}>
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
              className={[
                "text-stone-400 dark:text-stone-600 text-sm font-mono",
                si === 0 && onVerseClick
                  ? "cursor-pointer hover:text-stone-600 dark:hover:text-stone-400 transition-colors"
                  : "",
              ].join(" ")}
              data-seg-label={seg[0].wordId}
              data-osis-ref={`${book}.${chapter}.${verseNum}`}
              style={{ minWidth: verseLabelMinWidth, textAlign: isHebrew ? "right" : "left", paddingTop: labelPaddingTop }}
              onClick={si === 0 && onVerseClick ? () => onVerseClick(verseNum) : undefined}
              title={si === 0 && onVerseClick ? "Scroll notes to this verse" : undefined}
            >
              {paraLabels[si]}
            </span>
          );
          const segSourceEl = (
            <span
              data-rst-text={seg[0].wordId}
              className={isHebrew ? "text-hebrew" : "text-greek"}
              lang={isHebrew ? "he" : "grc"}
              style={{
                // Grid items are blockified by CSS, so text-indent works here without display:block.
                // Hanging indent: "Xpx hanging" indents continuation lines without negative positioning,
                // so inline-flex interlinear chips on the first line are never displaced.
                paddingLeft:  !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                paddingRight: isHebrew  && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                // Synoptic View's narrow compact gutter has no room to spare
                // for a hanging indent, so wrapped lines start flush left there.
                textIndent:   compactVerseLabels ? undefined : (`${HANG_PX}px hanging` as React.CSSProperties["textIndent"]),
              }}
            >
              {renderRuns(runs)}
            </span>
          );

          // Suppress the dashed separator (and its margin) when this segment is a
          // continuation of the same speech box or annotation — no gap inside the box.
          // Use the outermost layer to decide: if it continues, no gap.
          const suppressSeparator = !editingParagraphs && (
            (layers.length > 0 && !isSegStart) ||
            (annotationsBySegment?.get(seg[0].wordId) ?? []).some(e => !e.isStart)
          );

          // Grid styles for the innermost box div (or the plain div when no layers).
          // Keep at least 1rem between the verse-label column and the text so Hebrew
          // text (where rstSourcePad stays 0) doesn't press flush against the label —
          // except in Synoptic View's compact gutter, which only needs a sliver.
          const gridStyle: React.CSSProperties = {
            gridTemplateColumns: "auto 1fr",
            columnGap: rstSourcePad || (compactVerseLabels ? "0.25rem" : "1rem"),
          };
          const gridClass = `grid items-start${editingSpeech ? " cursor-crosshair" : ""}${editingAnnotations ? " cursor-pointer" : ""}${si > 0 && !suppressSeparator ? " mt-1" : ""}`;

          return (
            // data-rst-seg is used by RstRelationOverlay to measure segment position
            <div key={si} data-rst-seg={seg[0].wordId}>
              {/* Separator (scene or regular paragraph break) on a within-verse segment */}
              {si > 0 && !suppressSeparator && renderSegSeparator(seg[0].wordId)}
              {/* Flex wrapper: syllable/stress column (past the end of the RTL text) on
                  the left, the annotation column on the right of the text grid */}
              <div className="flex items-stretch">
                {renderSyllableStressColForSeg(seg)}
                <div className="flex-1 min-w-0">
                  {/* 2-column grid: label first, source second. For Hebrew (RTL) dir="rtl"
                      reverses visual column order so label appears on the RIGHT.
                      Nested speech boxes are rendered as concentric wrappers around this grid. */}
                  {wrapInSpeechLayers(
                    layers,
                    <>{segLabelEl}{segSourceEl}</>,
                    gridStyle,
                    gridClass,
                    { dir: isHebrew ? "rtl" : "ltr" }
                  )}
                </div>
                {renderAnnotationColForSeg(seg[0].wordId)}
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
  // Render a token string that may contain  (bold-start) /  (bold-end) /
  //  (italic-start) /  (italic-end) private-use chars into an array of
  // React nodes with per-segment bold/italic <span>s and plain strings elsewhere.
  function renderInlineMarked(text: string): React.ReactNode {
    if (!text.includes("") && !text.includes("")) return text;
    type Seg = { text: string; bold: boolean; italic: boolean };
    const segs: Seg[] = [];
    let cur = "", bold = false, italic = false;
    for (const ch of text) {
      if      (ch === "") { if (cur) segs.push({ text: cur, bold, italic }); cur = ""; bold = true; }
      else if (ch === "") { if (cur) segs.push({ text: cur, bold, italic }); cur = ""; bold = false; }
      else if (ch === "") { if (cur) segs.push({ text: cur, bold, italic }); cur = ""; italic = true; }
      else if (ch === "") { if (cur) segs.push({ text: cur, bold, italic }); cur = ""; italic = false; }
      else cur += ch;
    }
    if (cur) segs.push({ text: cur, bold, italic });
    return segs.map(({ text: t, bold: b, italic: i }, idx) =>
      b || i
        ? <span key={idx} style={{ fontWeight: b ? "bold" : undefined, fontStyle: i ? "italic" : undefined }}>{t}</span>
        : t
    );
  }

  const allTvSegs = translationTexts.map(({ abbr, text, translationId, words: tvWords }) => {
    const encoded = encodeUsfmTokens(text);
    const embeddedFnCount = (encoded.match(/«fn»/g) ?? []).length;
    const tokens = tokenizeTranslationText(text);
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

    // Split LXX words into segments mirroring the tvSegs logic.
    type TvWordSeg = { startIdx: number; words: import("@/lib/db/source-schema").Word[] };
    const tvWordSegs: TvWordSeg[] = [];
    if (tvWords && tvWords.length > 0) {
      let wCur: typeof tvWords = [];
      let wStart = 0;
      tvWords.forEach((word, wi) => {
        if (wi > 0 && paragraphBreakIds.has(`tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`)) {
          tvWordSegs.push({ startIdx: wStart, words: wCur });
          wCur = [];
          wStart = wi;
        }
        wCur.push(word);
      });
      if (wCur.length > 0) tvWordSegs.push({ startIdx: wStart, words: wCur });
    }

    return { abbr, text, translationId, embeddedFnCount, tvSegs: segs, tvWords, tvWordSegs };
  });

  // Per-translation footnote letter counter (a, b, c…). Mutable during render.
  const fnCounters: Record<string, number> = {};

  // Interlinear datasets can attach a label under translation-text words too —
  // same wordId scheme (`tv:ABBR:Book.Ch.V.wi`) and same active dataset as
  // source words, just keyed by the translation's own token position instead
  // of a source Word. Gated on interlinear display mode + a dataset (not
  // constituent/lemma/strongs/morph/translit) being active, since those other
  // sub-modes describe properties only source words have.
  const isTvDatasetMode = displayMode === "interlinear"
    && typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset";

  return (
    <div
      id={`verse-${verseNum}`}
      className={`${
        (speechContinuesIntoNext || annotContinuesIntoNext) ? "" : "border-b border-[var(--border)]"
      } ${(speechContinuesFromPrev || annotContinuesFromPrev) ? "pt-0" : "pt-4"} ${
        (speechContinuesIntoNext || annotContinuesIntoNext) ? "pb-0" : "pb-4"
      } last:border-0${verseStartsNewParagraph && !(speechContinuesFromPrev || annotContinuesFromPrev) ? " mt-4" : ""}`}
    >
      {verseStartsNewParagraph && firstWordId && renderSegSeparator(firstWordId)}

      {/* Each source paragraph is its own 5-cell grid row so the speech-box
          background/border wraps the source, arc columns, label AND translation together. */}
      {sourceSegments.map((seg, si) => {
        const { layers, isSegStart } = getSegSpeech(seg, si);
        const runs = computeRuns(seg, layers);

        // Indent level needed both for source hanging-indent and translation padding
        const paraStartId = wordToParaStart.get(seg[0].wordId) ?? seg[0].wordId;
        const indentLevel = lineIndentMap.get(paraStartId) ?? 0;
        // When linked: T mirrors S via the fallback. When unlinked: T is independent;
        // fall back to 0 (not S) so T is never implicitly constrained by S.
        const tvIndentLevel = translationIndentMap?.get(paraStartId)
          ?? (indentsLinked ? indentLevel : 0);

        // Translation content for this row:
        //   • All rows except the last get only tvSegs[si] (if it exists).
        //   • The last source row gets tvSegs[si…end] (all remaining tv paragraphs).
        const tvRowContent = allTvSegs.map(({ abbr, text: tvFullText, translationId: tvTranslationId, embeddedFnCount, tvSegs, tvWords, tvWordSegs }) => {
          const isLastRow = si === sourceSegments.length - 1;
          const rowSegs: TvSeg[] = si < sourceSegments.length - 1
            ? (tvSegs[si] ? [tvSegs[si]] : [])
            : tvSegs.slice(si);
          // LXX word segments for this row: row si gets tvWordSegs[si]; last row gets overflow.
          const rowWordSegs = tvWordSegs.length > 0
            ? (isLastRow ? tvWordSegs.slice(si) : (tvWordSegs[si] ? [tvWordSegs[si]] : []))
            : [];
          // Only show footnote anchors when there are visible footnotes for this translation.
          // translationFootnotes is passed as [] by the parent when showFootnotes is false.
          const showFnAnchors = translationFootnotes.some((f) => f.translationId === tvTranslationId);

          // Verse-level translation paragraph separator (first row only)
          const tvStartsNewParagraph = si === 0
            && paragraphBreakIds.has(`tv:${abbr}:${book}.${chapter}.${verseNum}.0`);

          // ── Translation edit mode: show a plain textarea for direct text editing ──
          if (editingTranslation || editingTranslationSource) {
            if (!isLastRow) return null; // only show edit area in the last (or only) row
            return (
              <div key={abbr}>
                {translationTexts.length > 1 && (
                  <span className={[
                    "block text-[10px] font-mono font-semibold uppercase tracking-wider mb-0.5",
                    editingTranslationSource
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-stone-400 dark:text-stone-500",
                  ].join(" ")}>
                    {abbr}{editingTranslationSource ? " · USFM" : ""}
                  </span>
                )}
                {editingTranslationSource && translationTexts.length === 1 && (
                  <span className="block text-[10px] font-mono font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wider mb-0.5">
                    USFM source
                  </span>
                )}
                <TranslationTextarea
                  key={`${abbr}-${verseNum}-${editingTranslationSource ? "src" : "edit"}`}
                  initialText={tvFullText}
                  abbr={abbr}
                  verseNum={verseNum}
                  onSave={(a, v, t) => onUpdateTranslationVerse?.(a, v, t)}
                  onCancel={(a, v) => onCancelTranslationVerse?.(a, v)}
                  sourceMode={editingTranslationSource}
                />
              </div>
            );
          }

          const hasContent = rowSegs.length > 0;

          return (
            <div key={abbr}>
              {tvStartsNewParagraph && (
                editingParagraphs ? (
                  <div className="relative flex items-center mb-1">
                    <div className="flex-1 border-t border-dashed border-amber-400" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleTranslationParagraphBreak(`tv:${abbr}:${book}.${chapter}.${verseNum}.0`, abbr); }}
                      title="Remove paragraph break"
                      className="mx-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[11px] leading-none hover:bg-amber-500 shrink-0"
                    >
                      ×
                    </button>
                    <div className="flex-1 border-t border-dashed border-amber-400" />
                  </div>
                ) : (
                  <div className="w-full border-t border-dashed mb-1 border-stone-300 dark:border-stone-600" aria-hidden="true" />
                )
              )}
              {/* Abbreviation label: only on row 0, only when multiple translations */}
              {translationTexts.length > 1 && si === 0 && (
                <span className="block text-[10px] font-mono font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-0.5">
                  {abbr}
                </span>
              )}
              {/* LXX word-token rendering (when words are attached to the entry).
                  Uses a <div>, not <p> — ParseTooltip renders a <div> on hover, and
                  a <div> descendant of <p> is invalid HTML (hydration error). */}
              {rowWordSegs.length > 0 && (
                <div
                  className="text-greek"
                  style={{
                    color: "var(--foreground)",
                    lineHeight: "var(--translation-line-height, var(--source-row-height, 1.625))",
                    paddingLeft: tvIndentLevel > 0 ? `${tvIndentLevel * 2}rem` : undefined,
                    cursor: editingParagraphs ? "crosshair" : undefined,
                  }}
                >
                  {rowWordSegs.flatMap((wordSeg, segIdx) =>
                    wordSeg.words.map((lxxWord, localWi) => {
                      const globalWi = wordSeg.startIdx + localWi;
                      const tvWordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi}`;
                      const isInterSegBreak = segIdx > 0 && localWi === 0;
                      const isLastInSeg = localWi === wordSeg.words.length - 1;
                      const isLastOverall = segIdx === rowWordSegs.length - 1 && isLastInSeg;

                      // ── TC overline (uses raw LXX word ID) ──────────────────
                      const tcMark = tcMarkMap?.get(lxxWord.wordId) ?? null;
                      const TC_COLORS: Record<string, string> = {
                        lxx_unique: "#16a34a", mt_unique: "#dc2626", same_different: "#ca8a04",
                      };

                      // ── Character ref underline (uses tv: word ID) ───────────
                      const ref = characterRefMap.get(tvWordId);
                      const char1 = ref ? resolveCharacter(ref.character1Id) : null;
                      const char2 = ref?.character2Id != null ? resolveCharacter(ref.character2Id) : null;
                      const underlineStyle: React.CSSProperties = char1 && char2 ? {
                        backgroundImage: `repeating-linear-gradient(to right, ${char1.color} 0px, ${char1.color} 4px, ${char2.color} 4px, ${char2.color} 8px)`,
                        backgroundSize: "100% 2px",
                        backgroundPosition: "center bottom",
                        backgroundRepeat: "no-repeat",
                        paddingBottom: "2px",
                      } : char1 ? {
                        backgroundImage: `linear-gradient(to right, ${char1.color}, ${char1.color})`,
                        backgroundSize: "100% 2px",
                        backgroundPosition: "center bottom",
                        backgroundRepeat: "no-repeat",
                        paddingBottom: "2px",
                      } : {};

                      // ── Word/concept tag highlight (uses tv: word ID) ─────────
                      const tvTagRef = wordTagRefMap.get(tvWordId);
                      const tvTag = tvTagRef ? resolveTag(tvTagRef.tagId) : null;
                      const isTvTagHighlighted = !!tvTag && highlightWordTagIds.has(tvTag.id);
                      const isTokenHighlighted = findHits?.has(tvWordId) ?? false;

                      // ── Look-ahead for annotation continuity ──────────────────
                      // Used to style the inter-word space so underlines/highlights
                      // are unbroken across consecutive same-annotation words.
                      const nextTvWordId = isLastOverall ? null
                        : `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi + 1}`;
                      const prevTvWordId = globalWi === 0 ? null
                        : `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi - 1}`;

                      const nextRef  = nextTvWordId ? characterRefMap.get(nextTvWordId) : null;
                      const sameCharAsNext = ref != null && nextRef != null &&
                        ref.character1Id === nextRef.character1Id &&
                        (ref.character2Id ?? null) === (nextRef.character2Id ?? null);

                      const prevRef  = prevTvWordId ? characterRefMap.get(prevTvWordId) : null;
                      const sameCharAsPrev = ref != null && prevRef != null &&
                        ref.character1Id === prevRef.character1Id &&
                        (ref.character2Id ?? null) === (prevRef.character2Id ?? null);

                      const nextTagRef  = nextTvWordId ? wordTagRefMap.get(nextTvWordId) : null;
                      const nextTag = nextTagRef ? resolveTag(nextTagRef.tagId) : null;
                      const sameTagAsNext = tvTag != null && nextTag != null && tvTag.id === nextTag.id;

                      const prevTagRef  = prevTvWordId ? wordTagRefMap.get(prevTvWordId) : null;
                      const prevTag = prevTagRef ? resolveTag(prevTagRef.tagId) : null;
                      const sameTagAsPrev = tvTag != null && prevTag != null && tvTag.id === prevTag.id;

                      // ── Formatting (bold / italic) (uses tv: word ID) ─────────
                      const tvFormatting = wordFormattingMap.get(tvWordId);
                      const formattingStyle: React.CSSProperties = {
                        fontWeight: tvFormatting?.isBold ? "bold" : undefined,
                        fontStyle: tvFormatting?.isItalic ? "italic" : undefined,
                      };

                      // ── Combined background colour (with shaped border-radius) ─
                      const tagBgColor = tvTag
                        ? (isTvTagHighlighted ? `${tvTag.color}55` : `${tvTag.color}28`)
                        : null;
                      // Shape the border-radius so consecutive same-tag spans join seamlessly.
                      const tagBorderRadius = tagBgColor
                        ? (sameTagAsPrev && sameTagAsNext ? "0"
                          : sameTagAsPrev ? "0 3px 3px 0"
                          : sameTagAsNext ? "3px 0 0 3px"
                          : "3px")
                        : undefined;
                      const tvBgStyle: React.CSSProperties = isTokenHighlighted
                        ? { backgroundColor: "rgba(251, 191, 36, 0.45)", borderRadius: "3px" }
                        : tagBgColor && !isTokenHighlighted
                          ? { backgroundColor: tagBgColor, borderRadius: tagBorderRadius }
                          : {};

                      // ── Styled space for annotation continuity ────────────────
                      const spaceStyle: React.CSSProperties | undefined =
                        sameCharAsNext && char1
                          ? { ...underlineStyle, whiteSpace: "pre" }
                          : sameTagAsNext && tagBgColor
                          ? { backgroundColor: tagBgColor, whiteSpace: "pre" }
                          : undefined;

                      // ── Combined span style ───────────────────────────────────
                      const isLxxEditingMode = editingTc || editingParagraphs || editingFormatting ||
                        editingRefs || editingWordTags || editingArrows || editingScenes;
                      const isLxxSelected = !isLxxEditingMode && selectedWordId === lxxWord.wordId;

                      const spanStyle: React.CSSProperties = {
                        ...(tcMark ? {
                          textDecorationLine: "overline",
                          textDecorationStyle: "solid" as const,
                          textDecorationColor: TC_COLORS[tcMark] ?? "#888",
                          textDecorationThickness: "2.5px",
                        } : {}),
                        ...underlineStyle,
                        ...tvBgStyle,
                        ...formattingStyle,
                        cursor: editingTc || editingParagraphs || editingFormatting || editingRefs || editingWordTags || editingArrows
                          ? "crosshair" : "pointer",
                      };

                      const isTvRangeStart = tvWordId === tagRangeStartWordId;

                      // ── Click handler ─────────────────────────────────────────
                      const handleClick = editingTc
                        ? () => onTcMarkWord?.(lxxWord.wordId, lxxWord.textSource)
                        : editingParagraphs && globalWi > 0
                        ? () => onToggleTranslationParagraphBreak(tvWordId, abbr)
                        : editingArrows
                        ? () => onSelectArrowWordById?.(tvWordId)
                        : editingFormatting
                        ? () => onSelectTranslationWord(tvWordId, abbr)
                        : editingRefs
                        ? clusterPickingActive
                          ? (e: React.MouseEvent) => onSelectWord(lxxWord, e.shiftKey)
                          : (e: React.MouseEvent) => onSelectTranslationWord(tvWordId, abbr, e.shiftKey)
                        : editingWordTags
                        ? clusterPickingActive
                          ? (e: React.MouseEvent) => onSelectWord(lxxWord, e.shiftKey)
                          : (e: React.MouseEvent) => onSelectTranslationWord(tvWordId, abbr, e.shiftKey)
                        : editingScenes && firstWordId
                        ? (e: React.MouseEvent) => { e.stopPropagation(); if (!(sceneBreakMap.get(firstWordId)?.length)) onToggleSceneBreak?.(firstWordId, 1, verseNum); }
                        // Default (non-editing) mode: select the word so its morphology
                        // shows in the side panel, same as clicking a source-text word.
                        : (e: React.MouseEvent) => onSelectWord(lxxWord, e.shiftKey);

                      const lxxTokenClassName = [
                        "relative rounded px-0.5 -mx-0.5 transition-colors",
                        isLxxEditingMode
                          ? ""
                          : isLxxSelected
                            ? "bg-blue-100 dark:bg-blue-900 outline outline-2 outline-blue-400"
                            : "hover:bg-stone-100 dark:hover:bg-stone-800",
                      ].filter(Boolean).join(" ");

                      return (
                        <span key={lxxWord.wordId}>
                          {isInterSegBreak && (
                            <>
                              <br />
                              {editingParagraphs && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onToggleTranslationParagraphBreak(tvWordId, abbr); }}
                                  title="Remove paragraph break"
                                  className="mx-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[11px] leading-none hover:bg-amber-500 shrink-0 inline-flex"
                                >×</button>
                              )}
                            </>
                          )}
                          <LxxWordSpan
                            word={lxxWord}
                            wordId={tvWordId}
                            style={spanStyle}
                            className={lxxTokenClassName}
                            isRangeStart={isTvRangeStart}
                            onClick={handleClick as React.MouseEventHandler<HTMLSpanElement> | undefined}
                            showTooltip={showTooltips && !isLxxEditingMode}
                            useLinguisticTerms={useLinguisticTerms}
                          />
                          {!isLastOverall && (
                            spaceStyle
                              ? <span style={spaceStyle}>{" "}</span>
                              : " "
                          )}
                        </span>
                      );
                    })
                  )}
                </div>
              )}
              {!tvWords && hasContent && (
                <p
                  style={{
                    color: "var(--foreground)",
                    fontSize: "var(--translation-font-size, 0.875rem)",
                    lineHeight: "var(--translation-line-height, var(--source-row-height, 1.625))",
                    paddingLeft: tvIndentLevel > 0 ? `${tvIndentLevel * 2}rem` : undefined,
                    textIndent: compactVerseLabels ? undefined : (`${HANG_PX}px hanging` as React.CSSProperties["textIndent"]),
                  }}
                  onClick={editingScenes && firstWordId ? (e) => { e.stopPropagation(); if (!(sceneBreakMap.get(firstWordId)?.length)) onToggleSceneBreak?.(firstWordId, 1, verseNum); } : undefined}
                  title={editingScenes ? "Click to add a section heading above this verse" : undefined}
                >
                  {rowSegs.flatMap((tvSeg, segIdx) => {
                    // Renders one token's full <span key={globalWi}>...</span> —
                    // extracted (rather than inlined in a .map()) so a contiguous
                    // dataset-group run can call it per member below while still
                    // producing one centered overlay label for the whole run,
                    // instead of each member showing its own copy.
                    function renderTvToken(localWi: number, suppressLabel: boolean): { node: React.ReactNode; wordId: string } {
                      const token = tvSeg.tokens[localWi];
                      const globalWi = tvSeg.startIdx + localWi;
                      const wordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi}`;
                      const ref = characterRefMap.get(wordId);
                      const char1 = ref ? resolveCharacter(ref.character1Id) : null;
                      const char2 = ref?.character2Id != null
                        ? resolveCharacter(ref.character2Id)
                        : null;

                      const underlineStyle: React.CSSProperties = char1 && char2 ? {
                        backgroundImage: `repeating-linear-gradient(to right, ${char1.color} 0px, ${char1.color} 4px, ${char2.color} 4px, ${char2.color} 8px)`,
                        backgroundSize: "100% 2px",
                        backgroundPosition: "center bottom",
                        backgroundRepeat: "no-repeat",
                        paddingBottom: "2px",
                      } : char1 ? {
                        backgroundImage: `linear-gradient(to right, ${char1.color}, ${char1.color})`,
                        backgroundSize: "100% 2px",
                        backgroundPosition: "center bottom",
                        backgroundRepeat: "no-repeat",
                        paddingBottom: "2px",
                      } : {};

                      // Look ahead/behind for annotation continuity across spaces.
                      const nextWordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi + 1}`;
                      const prevWordId = `tv:${abbr}:${book}.${chapter}.${verseNum}.${globalWi - 1}`;

                      // Character ref continuity
                      const nextRef = characterRefMap.get(nextWordId) ?? null;
                      const sameCharAsNext =
                        ref != null && nextRef != null &&
                        ref.character1Id === nextRef.character1Id &&
                        (ref.character2Id ?? null) === (nextRef.character2Id ?? null);

                      const isTokenHighlighted = highlightCharIds.size > 0 && ref != null && (
                        (resolveCharacter(ref.character1Id) != null && highlightCharIds.has(ref.character1Id)) ||
                        (ref.character2Id != null && resolveCharacter(ref.character2Id) != null && highlightCharIds.has(ref.character2Id))
                      );

                      const tvTagRef = wordTagRefMap.get(wordId);
                      const tvTag = tvTagRef ? resolveTag(tvTagRef.tagId) : null;
                      const isTvTagHighlighted = !!tvTag && highlightWordTagIds.has(tvTag.id);

                      // Word tag continuity
                      const nextTagRef = wordTagRefMap.get(nextWordId);
                      const nextTag = nextTagRef ? resolveTag(nextTagRef.tagId) : null;
                      const sameTagAsNext = tvTag != null && nextTag != null && tvTag.id === nextTag.id;

                      const prevTagRef = wordTagRefMap.get(prevWordId);
                      const prevTag = prevTagRef ? resolveTag(prevTagRef.tagId) : null;
                      const sameTagAsPrev = tvTag != null && prevTag != null && tvTag.id === prevTag.id;

                      // Find-in-page highlight takes top priority
                      const isTvFindFocus = findFocusId != null && findFocusId === wordId;
                      const isTvFindHit   = !isTvFindFocus && (findHits?.has(wordId) ?? false);

                      // Tag background color and shaped border-radius for continuity
                      const tagBgColor = tvTag
                        ? (isTvTagHighlighted ? `${tvTag.color}55` : `${tvTag.color}28`)
                        : null;
                      const tagBorderRadius = tagBgColor
                        ? (sameTagAsPrev && sameTagAsNext ? "0"
                          : sameTagAsPrev ? "0 3px 3px 0"
                          : sameTagAsNext ? "3px 0 0 3px"
                          : "3px")
                        : undefined;

                      // ── Interlinear dataset grouping — same per-word highlight as
                      // source-word groups (WordToken/renderWordGroups): each grouped
                      // word gets its own flat-rounded highlight, with no highlight on
                      // the space between words — source doesn't highlight that gap
                      // either, relying on the shared centered label + proximity to
                      // read as one group (the caller renders that shared label; see
                      // the run-detection loop below, which passes suppressLabel).
                      const tvSavedGroupId = isTvDatasetMode ? datasetGroupMap.get(wordId) : undefined;
                      const tvGroupValue = tvSavedGroupId != null
                        ? (datasetEntryMap.get(wordId) ?? tvSavedGroupId)
                        : undefined;
                      const isTvPendingGroupMember = isTvDatasetMode && (pendingGroupWordIds?.has(wordId) ?? false);
                      const tvDatasetHighlightBg = isTvPendingGroupMember
                        ? "rgba(37, 99, 235, 0.35)"
                        : tvSavedGroupId
                          ? resolvedDatasetColor(tvGroupValue!, datasetLabelColors)
                          : undefined;

                      // Background-colour highlight (find > char ref > word tag > dataset group)
                      const tvBgStyle: React.CSSProperties = isTvFindFocus
                        ? { backgroundColor: "rgba(251, 146, 60, 0.65)", borderRadius: "3px" }
                        : isTvFindHit
                          ? { backgroundColor: "rgba(251, 191, 36, 0.45)", borderRadius: "3px" }
                          : isTokenHighlighted
                            ? { backgroundColor: "rgba(253, 224, 71, 0.45)", borderRadius: "3px" }
                            : tagBgColor && !isTokenHighlighted
                              ? { backgroundColor: tagBgColor, borderRadius: tagBorderRadius }
                              : tvDatasetHighlightBg
                                ? { backgroundColor: tvDatasetHighlightBg, borderRadius: "3px" }
                                : {};

                      // Styled space: char-ref underline takes priority, then word-tag bg.
                      // Dataset grouping does NOT highlight the space between words.
                      const tvSpaceStyle: React.CSSProperties | undefined =
                        sameCharAsNext && char1
                          ? { ...underlineStyle, whiteSpace: "pre" }
                          : sameTagAsNext && tagBgColor
                          ? { backgroundColor: tagBgColor, whiteSpace: "pre" }
                          : undefined;

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

                      const tokenClassName = editingArrows
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-slate-100 dark:hover:bg-slate-900/40 transition-colors"
                        : editingScenes
                        ? "cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                        : editingFormatting
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

                      const isTvRangeStart = wordId === tagRangeStartWordId;

                      const handleClick = editingArrows
                        ? () => onSelectArrowWordById?.(wordId)
                        : editingScenes
                        ? (e: React.MouseEvent) => { e.stopPropagation(); if (firstWordId && !(sceneBreakMap.get(firstWordId)?.length)) onToggleSceneBreak?.(firstWordId, 1, verseNum); }
                        : editingFormatting
                        ? () => onSelectTranslationWord(wordId, abbr)
                        : editingRefs
                        ? (e: React.MouseEvent) => onSelectTranslationWord(wordId, abbr, e.shiftKey)
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
                        ? (e: React.MouseEvent) => onSelectTranslationWord(wordId, abbr, e.shiftKey)
                        : undefined;

                      const isLastToken =
                        segIdx === rowSegs.length - 1 &&
                        localWi === tvSeg.tokens.length - 1;

                      // Strip outer punctuation BEFORE decoding the USFM marker prefix
                      // so that tokens like  'ND:LORD  (quote glued directly to the
                      // marker by the USFM source) are handled correctly.  Without this
                      // order, decodeUsfmToken("'ND:LORD") fails to recognise the ND:
                      // prefix and the small-caps Divine Name styling is lost.
                      const { leading: tokLeadOuter, core: rawCore, trailing: tokTrailOuter } = splitTokenPunctuation(token);
                      const { display: decodedDisplay, marker: usfmMarker } = decodeUsfmToken(rawCore);
                      // A second pass handles punctuation embedded in the decoded display
                      // (e.g. ND:"Lord" → leading ", core Lord, trailing ").
                      const { leading: tokLeadInner, core: tokCore, trailing: tokTrailInner } = splitTokenPunctuation(decodedDisplay);
                      const tokLead  = tokLeadOuter  + tokLeadInner;
                      const tokTrail = tokTrailInner + tokTrailOuter;

                      // USFM inline marker styling
                      const usfmStyle: React.CSSProperties =
                        usfmMarker === "nd"  ? { fontVariant: "small-caps" } :
                        usfmMarker === "add" ? { fontStyle: "italic" } : {};
                      const usfmClassName =
                        usfmMarker === "wj" ? "text-red-600 dark:text-red-400" : "";

                      // Footnote superscript letter
                      let fnLetter: string | null = null;
                      if (usfmMarker === "fn") {
                        if (fnCounters[abbr] === undefined) fnCounters[abbr] = 0;
                        fnLetter = String.fromCharCode(97 + (fnCounters[abbr]++ % 26));
                      }

                      // Anchor-placement mode: this translation word is a clickable target
                      const isAnchorMoveTarget =
                        !!anchorMoveFootnote && anchorMoveFootnote.translationId === tvTranslationId;

                      const node = (
                        <span key={globalWi}>
                          {(isMidVerseBreak || isInterSegBreak) && (
                            <>
                              <br />
                              {editingParagraphs ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onToggleTranslationParagraphBreak(wordId, abbr); }}
                                  title="Remove paragraph break"
                                  className="text-xs font-mono mr-1 text-amber-500 hover:text-amber-600 cursor-pointer"
                                >
                                  ¶×
                                </button>
                              ) : (
                                <span className={`text-xs select-none font-mono mr-1 ${pilcrowClass}`} aria-hidden="true">
                                  ¶
                                </span>
                              )}
                            </>
                          )}
                          {tokLead}
                          <span className={isTvDatasetMode ? "word-interlinear" : undefined}>
                            <span
                              data-word-id={wordId}
                              style={{ ...underlineStyle, ...tvBgStyle, ...tvFormattingStyle, ...usfmStyle }}
                              className={[
                                tokenClassName,
                                usfmClassName,
                                isTvRangeStart ? "outline outline-2 outline-violet-400 bg-violet-100 dark:bg-violet-900/40" : "",
                                isAnchorMoveTarget ? "cursor-crosshair hover:ring-1 hover:ring-sky-400 hover:rounded-sm" : "",
                              ].filter(Boolean).join(" ")}
                              onClick={isAnchorMoveTarget
                                ? (e) => { e.stopPropagation(); onMoveFootnoteAnchor?.(anchorMoveFootnote!.id, globalWi); }
                                : handleClick}
                              title={isAnchorMoveTarget ? "Click to place footnote anchor here" : undefined}
                            >
                              {renderInlineMarked(tokCore)}
                            </span>
                            {isTvDatasetMode && (
                              <TranslationDatasetLabel
                                wordId={wordId}
                                value={tvGroupValue ?? datasetEntryMap.get(wordId) ?? null}
                                suppressValueDisplay={suppressLabel}
                                direction={datasetDirection}
                                onSave={onSaveDatasetEntry}
                                groupingActive={datasetGroupingActive}
                                isPendingGroupMember={isTvPendingGroupMember}
                                onToggleGroupMember={onToggleDatasetGroupMember}
                              />
                            )}
                          </span>
                          {fnLetter && showFnAnchors && (
                            <sup className="text-[0.65em] font-normal leading-none text-stone-400 dark:text-stone-500 select-none">
                              {fnLetter}
                            </sup>
                          )}
                          {tokTrail}
                          {!isLastToken && (
                            tvSpaceStyle
                              ? (isTvDatasetMode ? (
                                  // In interlinear+dataset mode, sibling .word-interlinear
                                  // blocks are vertical-align:bottom (their baseline sits at
                                  // the bottom of the label row) — a bare highlighted space
                                  // would inherit that baseline and render its highlight down
                                  // on the label line instead of the text line. Wrap it in the
                                  // same word/label column structure (with a hidden label-row
                                  // placeholder) so it aligns like every other token and its
                                  // highlight stays confined to the text row.
                                  <span className="word-interlinear">
                                    <span style={tvSpaceStyle}>{" "}</span>
                                    <span className="word-parse" aria-hidden="true" style={{ visibility: "hidden" }}>·</span>
                                  </span>
                                ) : (
                                  <span style={tvSpaceStyle}>{" "}</span>
                                ))
                              : " "
                          )}
                        </span>
                      );
                      return { node, wordId };
                    }

                    // ── Run detection: render each token individually, except a
                    // contiguous run of words sharing a saved dataset grouping,
                    // which renders as one unit — member words wrapped together
                    // (each with its own value display suppressed) plus a single
                    // centered overlay label spanning the run, mirroring how
                    // source-word groups render (see renderWordGroups above).
                    const elements: React.ReactNode[] = [];
                    let li = 0;
                    while (li < tvSeg.tokens.length) {
                      const groupId = isTvDatasetMode
                        ? datasetGroupMap.get(`tv:${abbr}:${book}.${chapter}.${verseNum}.${tvSeg.startIdx + li}`)
                        : undefined;

                      if (groupId != null) {
                        let runEnd = li;
                        while (
                          runEnd + 1 < tvSeg.tokens.length &&
                          datasetGroupMap.get(`tv:${abbr}:${book}.${chapter}.${verseNum}.${tvSeg.startIdx + runEnd + 1}`) === groupId
                        ) runEnd++;

                        if (runEnd > li) {
                          const firstWordIdInRun = `tv:${abbr}:${book}.${chapter}.${verseNum}.${tvSeg.startIdx + li}`;
                          const runValue = datasetEntryMap.get(firstWordIdInRun) ?? groupId;
                          const members: React.ReactNode[] = [];
                          for (let k = li; k <= runEnd; k++) members.push(renderTvToken(k, true).node);
                          elements.push(
                            <span key={`grp-${firstWordIdInRun}`} className="word-interlinear-group" style={{ position: "relative", display: "inline-flex" }}>
                              {members}
                              {/* Centered label spanning the whole run. Purely a visual/click
                                  proxy — clicking it forwards to the run's first word's own
                                  (blank, since its value display is suppressed) interlinear
                                  label span, which already has the real click behavior:
                                  toggling group membership in grouping mode, or opening the
                                  value-edit popover otherwise. */}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const wrapper = (e.currentTarget as HTMLElement).parentElement;
                                  wrapper?.querySelector<HTMLElement>(".word-parse")?.click();
                                }}
                                title={datasetGroupingActive ? "Click to add/remove from grouping" : "Click to edit"}
                                className={[
                                  "absolute left-0 right-0 bottom-0 text-center cursor-pointer rounded px-0.5",
                                  datasetGroupingActive
                                    ? "hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                    : "hover:bg-stone-100 dark:hover:bg-stone-700",
                                ].join(" ")}
                                style={{ fontSize: "0.72em", lineHeight: 1.2, color: "var(--interlinear-color)" }}
                                dir={datasetDirection}
                              >
                                {runValue}
                              </span>
                            </span>
                          );
                          li = runEnd + 1;
                          continue;
                        }
                      }

                      elements.push(renderTvToken(li, false).node);
                      li++;
                    }
                    return elements;
                  })}
                  {/* Orphaned anchors: footnotes without an embedded \fn marker in the verse text */}
                  {isLastRow && showFnAnchors && (() => {
                    const tFns = translationFootnotes.filter((f) => f.translationId === tvTranslationId);
                    const orphans = tFns.slice(embeddedFnCount);
                    if (orphans.length === 0) return null;
                    return orphans.map((_, oi) => {
                      if (fnCounters[abbr] === undefined) fnCounters[abbr] = 0;
                      const letter = String.fromCharCode(97 + (fnCounters[abbr]++ % 26));
                      return (
                        <sup key={oi} className="text-[0.65em] font-normal leading-none text-stone-400 dark:text-stone-500 select-none ml-0.5">
                          {letter}
                        </sup>
                      );
                    });
                  })()}
                </p>
              )}
            </div>
          );
        });

        // Uses --source-half-leading (set by parent, scales with lineHeightMultiplier);

        // fallback replicates the 2.5× / 2.25× default line-height used when no parent sets it.
        const labelPaddingTop = isHebrew
          ? "var(--source-half-leading, calc(0.75 * var(--hebrew-font-size, 1.375rem)))"
          : "var(--source-half-leading, calc(0.625 * var(--greek-font-size, 1.25rem)))";
        const verseLabelMinWidth = compactVerseLabels ? "3ch" : "5rem";

        // Push the translation column's first line down so it visually aligns
        // with the verse-number label (which sits at labelPaddingTop).
        // Formula: source-half-leading − translation-half-leading
        // --translation-half-leading is set by ChapterDisplay / PassageView as
        //   calc((--translation-line-height − --translation-font-size) / 2).
        // Fallback assumes line-height ratio 1.625 → half-leading = 0.3125 × fontSize.
        const tvPaddingTop = isHebrew
          ? "calc(var(--source-half-leading, calc(0.75 * var(--hebrew-font-size, 1.375rem))) - var(--translation-half-leading, calc(0.3125 * var(--translation-font-size, 0.875rem))))"
          : "calc(var(--source-half-leading, calc(0.625 * var(--greek-font-size, 1.25rem))) - var(--translation-half-leading, calc(0.3125 * var(--translation-font-size, 0.875rem))))";

        // Suppress the dashed separator when this segment continues the same speech box or annotation.
        // Use the outermost layer to decide — if it continues from the previous segment, no gap.
        const suppressSeparator = !editingParagraphs && (
          (layers.length > 0 && !isSegStart) ||
          (annotationsBySegment?.get(seg[0].wordId) ?? []).some(e => !e.isStart)
        );

        // Build the grid inner content (source column + label column + translation column).
        const gridContent = (
          <>
            {/* Source words (hidden in translation-only mode) */}
            {!hideSourceText && (
              <div
                dir={isHebrew ? "rtl" : "ltr"}
                data-rst-src-block={seg[0].wordId}
                style={{
                  paddingLeft:  !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                  paddingRight: isHebrew  && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                  textIndent:   compactVerseLabels ? undefined : (`${HANG_PX}px hanging` as React.CSSProperties["textIndent"]),
                  marginRight:  isHebrew && rstSourcePad ? rstSourcePad : undefined,
                }}
              >
                <span
                  data-rst-text={seg[0].wordId}
                  className={isHebrew ? "text-hebrew" : "text-greek"}
                  lang={isHebrew ? "he" : "grc"}
                >
                  {renderRuns(runs)}
                </span>
              </div>
            )}

            {/* Paragraph label / indent controls (centre column) */}
            <div className="flex items-start justify-center">
              {editingIndents ? (
                <div className="flex flex-col gap-0.5" data-seg-label={seg[0].wordId}>
                  {/* Source indent row — always shown */}
                  <div className="flex items-center gap-0.5">
                    {!indentsLinked && (
                      <span className="text-[9px] font-bold text-stone-400 dark:text-stone-500 w-3 shrink-0 select-none">S</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.max(0, indentLevel - 1)); }}
                      disabled={indentLevel === 0}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Decrease source indent"
                    >−</button>
                    <span className="text-teal-600 dark:text-teal-400 text-[10px] font-mono w-4 text-center select-none">
                      {indentLevel > 0 ? indentLevel : "·"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSetSegmentIndent(paraStartId, Math.min(6, indentLevel + 1)); }}
                      disabled={indentLevel >= 6}
                      className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                      title="Increase source indent"
                    >+</button>
                  </div>
                  {/* Translation indent row — only when decoupled */}
                  {!indentsLinked && (
                    <div className="flex items-center gap-0.5">
                      <span className="text-[9px] font-bold text-stone-400 dark:text-stone-500 w-3 shrink-0 select-none">T</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSetSegmentTvIndent?.(paraStartId, Math.max(0, tvIndentLevel - 1)); }}
                        disabled={tvIndentLevel === 0}
                        className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                        title="Decrease translation indent"
                      >−</button>
                      <span className="text-teal-600 dark:text-teal-400 text-[10px] font-mono w-4 text-center select-none">
                        {tvIndentLevel > 0 ? tvIndentLevel : "·"}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSetSegmentTvIndent?.(paraStartId, Math.min(6, tvIndentLevel + 1)); }}
                        disabled={tvIndentLevel >= 6}
                        className="w-5 h-5 flex items-center justify-center text-xs rounded text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-25 transition-colors"
                        title="Increase translation indent"
                      >+</button>
                    </div>
                  )}
                </div>
              ) : (
                <span
                  className="text-stone-400 dark:text-stone-600 text-sm font-mono select-none"
                  data-seg-label={seg[0].wordId}
                  data-osis-ref={`${book}.${chapter}.${verseNum}`}
                  style={{ minWidth: verseLabelMinWidth, textAlign: "center", paddingTop: labelPaddingTop }}
                >
                  {paraLabels[si]}
                  {si === 0 && translationTexts.length > 0 && (() => {
                    // Cross-chapter remap label (e.g. "[1:17]" for MT Jonah 2:1)
                    const crossLabel = translationVerseLabelFn?.(verseNum);
                    if (crossLabel) {
                      return (
                        <span
                          className="block text-[0.7em] leading-tight mt-0.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          [{crossLabel}]
                        </span>
                      );
                    }
                    // Same-chapter offset label (e.g. "[1]" for MT Ps 22:2 in ULT)
                    if (translationVerseOffset > 0 && verseNum > translationVerseOffset) {
                      return (
                        <span
                          className="block text-[0.7em] leading-tight mt-0.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          [{verseNum - translationVerseOffset}]
                        </span>
                      );
                    }
                    return null;
                  })()}
                </span>
              )}
            </div>

            {/* Translation content. Hanging indent lives on each <p> element. */}
            <div
              className="flex flex-col gap-1"
              data-seg-translation={seg[0].wordId}
              style={{
                paddingTop: tvPaddingTop,
                marginLeft: rstSourcePad || undefined,
              }}
            >
              {tvRowContent}
              {/* Placeholder shown on the first row when a translation is active but
                  this chapter has no text yet — prompts the user to start translating. */}
              {allTvSegs.length === 0 && si === 0 && !editingTranslation && !editingTranslationSource &&
               /* Suppress for superscription-only verses — no translation text is expected
                  when the active translation uses KJV numbering and this verse is covered
                  by the offset (e.g. MT Ps 3:1 when ULT starts at MT verse 2). */
               !(translationVerseOffset > 0 && verseNum <= translationVerseOffset) && (
                <p className="text-xs italic select-none" style={{ color: "var(--text-muted)" }}>
                  Enable editing to translate
                </p>
              )}
              {/* Footnotes appear under the translation text, in the last source row only */}
              {si === sourceSegments.length - 1 && translationFootnotes.length > 0 && (
                <div className="mt-0.5 space-y-0.5">
                  {translationFootnotes.map((fn, idx) => {
                    const label = String.fromCharCode(97 + (idx % 26));
                    return (
                      <div key={fn.id} className="flex items-start gap-1">
                        <p className="flex-1 text-xs italic text-stone-500 dark:text-stone-400 leading-snug">
                          <sup className="font-normal not-italic mr-0.5 text-stone-400">{label}</sup>
                          {renderFootnoteContent(fn.content)}
                        </p>
                        {onEditFootnote && (
                          <button
                            type="button"
                            onClick={() => onEditFootnote(fn)}
                            className="text-stone-300 hover:text-sky-500 dark:text-stone-500 dark:hover:text-sky-400 text-xs leading-none mt-0.5 shrink-0"
                            title="Edit footnote"
                          >✎</button>
                        )}
                        {editingFootnotes && onDeleteFootnote && (
                          <button
                            type="button"
                            onClick={() => onDeleteFootnote(fn.translationId, fn.id)}
                            className="text-amber-400 hover:text-red-500 dark:text-amber-500 dark:hover:text-red-400 text-xs leading-none mt-0.5 shrink-0"
                            title="Delete footnote (removes anchor from text)"
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        );

        const gridStyle: React.CSSProperties = {
          gridTemplateColumns: hideSourceText ? "auto 1fr" : "1fr auto 1fr",
        };
        const gridClass = `grid items-start${editingSpeech ? " cursor-crosshair" : ""}${editingAnnotations ? " cursor-pointer" : ""}`;

        return (
          // data-rst-seg is used by RstRelationOverlay to measure segment position
          <div key={si} data-rst-seg={seg[0].wordId}>
            {/* Separator (scene or regular paragraph break) on a within-verse segment */}
            {si > 0 && !suppressSeparator && renderSegSeparator(seg[0].wordId)}
            {/* Flex wrapper: syllable/stress column on the left, the annotation
                column on the right of the text grid */}
            <div className="flex items-stretch">
              {renderSyllableStressColForSeg(seg)}
              <div className="flex-1 min-w-0">
                {/* Grid layout: nested speech-box divs wrap from the outside in.
                    The innermost div carries the grid styles; outer divs are borders only. */}
                {wrapInSpeechLayers(layers, gridContent, gridStyle, gridClass)}
              </div>
              {renderAnnotationColForSeg(seg[0].wordId)}
            </div>
          </div>
        );
      })}

    </div>
  );
}
