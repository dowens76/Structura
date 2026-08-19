"use client";

import { useRef, useState } from "react";
import type { Word, CharacterRef, Character, WordTag, WordTagRef } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, InterlinearSubMode } from "@/lib/morphology/types";
import { POS_COLORS, CONSTITUENT_LABELS } from "@/lib/morphology/types";
import { getPosKey, matchesColorRule, type ColorRule } from "@/lib/morphology/colorRules";
import ParseTooltip from "./ParseTooltip";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import type { PoetryNotation } from "@/lib/db/schema";
import { POETRY_COLORS, POETRY_UNDERLINE_THICKNESS_PX } from "@/lib/poetry/constants";
import { renderClickableGraphemes, renderGraphemesWithSimilarityHighlight } from "@/lib/poetry/graphemeRender";
import PoetryNotePopover from "./PoetryNotePopover";
import SimilarityNotePopover from "./SimilarityNotePopover";
import PoetryArrowIcon from "./PoetryArrowIcon";

interface WordTokenProps {
  word: Word;
  displayMode: DisplayMode;
  grammarFilter: GrammarFilterState;
  colorRules: ColorRule[];
  onSelect: (word: Word, shiftHeld?: boolean) => void;
  selectedWordId: string | null;
  showTooltip: boolean;
  useLinguisticTerms: boolean;
  editingParagraphs: boolean;
  // Character tagging
  characterRef: CharacterRef | null;
  characterMap: Map<number, Character>;
  editingRefs: boolean;
  editingSpeech: boolean;
  isRangeStart: boolean;
  highlightCharIds: Set<number>;
  // Synoptic word-level comparison marking — inline background tint,
  // independent of paragraph segments (see ChapterDisplay.tsx).
  synopticMarkColor?: string | null;
  editingWordCompare?: boolean;
  // Word / concept tag highlighting
  wordTagRef?: WordTagRef | null;
  wordTagMap?: Map<number, WordTag>;
  editingWordTags?: boolean;
  highlightWordTagIds?: Set<number>;
  // Bold / italic / underline / color formatting
  wordFormatting?: { isBold: boolean; isItalic: boolean; isUnderline: boolean; textColor: string | null } | null;
  editingFormatting?: boolean;
  // Text critical markup overline
  tcMark?: string | null;
  // Interlinear sub-mode
  interlinearSubMode?: InterlinearSubMode;
  constituentLabel?: string | null;
  datasetValue?: string | null;
  // Text direction for the active dataset's label/input — explicit so it
  // doesn't silently inherit dir="rtl" from a Hebrew source-text ancestor.
  datasetDirection?: "ltr" | "rtl";
  transliterationFormat?: string | null;
  onSaveConstituentLabel?: (wordId: string, label: string | null) => void;
  onSaveDatasetEntry?: (wordId: string, value: string | null) => void;
  onSaveTransliterationFormat?: (wordId: string, format: string | null) => void;
  onLemmaClick?: (word: Word) => void;
  showVowels?: boolean;
  showCantillation?: boolean;
  // In interlinear mode, background highlight to apply only to the source-text span
  wordHighlightBg?: string;
  // Dataset word-grouping mode: while active, clicking the interlinear label
  // toggles group membership instead of opening the value-edit popover.
  datasetGroupingActive?: boolean;
  isPendingGroupMember?: boolean;
  onToggleDatasetGroupMember?: (wordId: string) => void;
  // True when this word belongs to a saved grouping — its own value is
  // hidden since VerseDisplay renders one centered label over the whole group.
  suppressDatasetValueDisplay?: boolean;

  // ── Poetry notation (Gestalt) ────────────────────────────────────────────
  /** Continuation mark anchored to this exact word, if any (orange ↓ below). */
  poetryMarkContinuation?: PoetryNotation | null;
  /** Requiredness mark anchored to this exact word, if any (gray → above). */
  poetryMarkRequiredness?: PoetryNotation | null;
  /** True when this word falls inside a "requiredness — underline" range (gray underline). */
  poetryRequirednessUnderline?: boolean;
  /** True when this word falls inside a "closure — weak" range (purple underline). */
  poetryClosureWeak?: boolean;
  /** True when this word is the LAST word of a line marked "closure — complete"
   *  (purple vertical bar at the line's trailing edge). */
  poetryClosureComplete?: boolean;
  /** True when the "show poetry notes" toggle is on AND a mark anchored to
   *  this word has a note — renders a small note-indicator badge. */
  showPoetryNote?: boolean;
  /** The note text itself, shown as the badge's hover tooltip. */
  poetryNoteText?: string | null;
  /** id of the poetry-notation mark whose note popover is currently open, if it anchors to this word. */
  openPoetryNoteMark?: PoetryNotation | null;
  onSavePoetryNote?: (id: number, note: string | null) => void;
  onDeletePoetryMark?: (id: number) => void;
  onClosePoetryNote?: () => void;
  /** Requiredness ("arrow") only — starts/cancels picking the mark's
   *  resolved word/phrase, from the note popover's button. */
  onSelectRequirednessResolving?: (mark: PoetryNotation) => void;
  /** Similarity only — openPoetryNoteMark's full current group (or just
   *  itself, ungrouped). Presence of this alongside a similarity
   *  openPoetryNoteMark selects SimilarityNotePopover over PoetryNotePopover. */
  openPoetryNoteGroupMembers?: PoetryNotation[] | null;
  /** Similarity only — true when the open mark's group is missing a
   *  connecting arrow somewhere along its chain. */
  openPoetryNoteHasMissingArrow?: boolean;
  onAddWordToSimilarityGroup?: (mark: PoetryNotation) => void;
  onSaveSimilarityGroup?: (mark: PoetryNotation, note: string | null) => void;
  onDeleteSimilarityWord?: (mark: PoetryNotation) => void;
  onRestoreSimilarityArrows?: (mark: PoetryNotation) => void;
  /** True only while editing mode is active AND the "similarity" sub-tool is selected —
   *  switches this word's text to individually-clickable grapheme spans. */
  editingPoetrySimilarity?: boolean;
  /** The pending (not-yet-committed) similarity selection anchor, if it's in this word. */
  pendingSimilarityAnchor?: { wordId: string; graphemeIndex: number } | null;
  onGraphemeClick?: (wordId: string, graphemeIndex: number, shiftHeld: boolean) => void;
  /** A saved Similarity mark that touches this word (read mode), with the local
   *  grapheme index range (within this word's core text) it covers here. */
  similarityMark?: { mark: PoetryNotation; startIdx: number; endIdx: number } | null;
  onClickSimilarityMark?: (markId: number) => void;
}

/** Split surface text into leading punctuation, core word, and trailing punctuation.
 *  Punctuation placed outside the styled/clickable span so it is never visually
 *  included in character or word-tag selection indicators. */
// \u05C3 = Hebrew sof pasuq ׃  \u05C0 = Hebrew paseq ׀
// \u0387 = Greek ano teleia ·   \u037E = Greek question mark ;
const PUNCT_RE = /["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u0387\u037E\u2014\u05C3\u05C0]/;
const LEADING_PUNCT = /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u0387\u037E\u2014\u05C3\u05C0]+/;
const TRAILING_PUNCT = /["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u0387\u037E\u2014\u05C3\u05C0]+$/;

function splitPunctuation(text: string): { leading: string; core: string; trailing: string } {
  const leading = text.match(LEADING_PUNCT)?.[0] ?? "";
  const rest = text.slice(leading.length);
  const trailing = rest.match(TRAILING_PUNCT)?.[0] ?? "";
  const core = rest.slice(0, rest.length - trailing.length);
  return { leading, core, trailing };
}

/** Strip Hebrew diacritics (vowel points + cantillation) leaving only base consonants. */
const HEBREW_DIACRITICS = /[֑-ׇ]/g;

/**
 * Render Hebrew word text with Masoretic large letters displayed at 1.5× size.
 * Uses Intl.Segmenter to split into grapheme clusters so vowel points attached
 * to the large consonant are scaled together with it.
 */
function renderWithLargeLetters(text: string, largeLetters: string): React.ReactNode {
  const largeBase = largeLetters.replace(HEBREW_DIACRITICS, "");
  const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
  const clusters = [...segmenter.segment(text)].map((s) => s.segment);
  return clusters.map((cluster, i) =>
    cluster.replace(HEBREW_DIACRITICS, "") === largeBase
      ? <span key={i} style={{ fontSize: "1.5em", lineHeight: "1" }}>{cluster}</span>
      : cluster
  );
}

function getInterlinearLabel(word: Word): string {
  if (word.language === "hebrew") {
    // Look up the actual Hebrew word form from the Strong's number
    const lemma = word.strongNumber
      ? (hebrewLemmas as Record<string, string>)[word.strongNumber]
      : null;
    return lemma ?? word.lemma ?? "—";
  }
  // Greek (SBLGNT/MorphGNT): word.lemma already contains the Greek lemma text.
  // Lower-case to normalise sentence-start capitalisation (e.g. "Ἐν" → "ἐν").
  const label = word.lemma ?? word.partOfSpeech?.slice(0, 4) ?? "—";
  return label.toLowerCase();
}

// ── InterlinearLabel ─────────────────────────────────────────────────────────

interface InterlinearLabelProps {
  word: Word;
  isHebrew: boolean;
  subMode: InterlinearSubMode;
  constituentLabel: string | null;
  datasetValue: string | null;
  datasetDirection?: "ltr" | "rtl";
  transliterationFormat: string | null;
  onSaveConstituentLabel?: (wordId: string, label: string | null) => void;
  onSaveDatasetEntry?: (wordId: string, value: string | null) => void;
  onSaveTransliterationFormat?: (wordId: string, format: string | null) => void;
  onLemmaClick?: () => void;
  datasetGroupingActive?: boolean;
  isPendingGroupMember?: boolean;
  onToggleDatasetGroupMember?: (wordId: string) => void;
  suppressDatasetValueDisplay?: boolean;
}

function InterlinearLabel({
  word,
  isHebrew,
  subMode,
  constituentLabel,
  datasetValue,
  datasetDirection = "ltr",
  transliterationFormat,
  onSaveConstituentLabel,
  onSaveDatasetEntry,
  onSaveTransliterationFormat,
  onLemmaClick,
  datasetGroupingActive,
  isPendingGroupMember,
  onToggleDatasetGroupMember,
  suppressDatasetValueDisplay,
}: InterlinearLabelProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draftValue,  setDraftValue]  = useState("");
  const editableRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelStyle: React.CSSProperties = {
    fontFamily: subMode === "transliteration"
      ? '"Gentium Book Basic", "Gentium Basic", "Gentium Plus", serif'
      : isHebrew
        ? '"Ezra SIL", "SBL Hebrew", serif'
        : '"Gentium Plus", "GFS Didot", serif',
    fontSize: "0.72em",
    color: "var(--interlinear-color)",
  };

  function getText(): string {
    if (subMode === "lemma")           return getInterlinearLabel(word);
    if (subMode === "strongs")         return word.strongNumber ?? "—";
    if (subMode === "morph")           return word.morphCode ?? "—";
    if (subMode === "transliteration") return word.transliteration ?? "—";
    if (subMode === "constituent") {
      if (suppressDatasetValueDisplay) return "";
      return constituentLabel ?? "·";
    }
    // dataset
    if (suppressDatasetValueDisplay) return "";
    return datasetValue ?? "·";
  }

  const isTransliteration = subMode === "transliteration";
  const isDatasetMode = typeof subMode === "object" && subMode.type === "dataset";
  const isEditable = subMode === "constituent" || isTransliteration || isDatasetMode;
  const isLemmaSearchable = subMode === "lemma" && !!onLemmaClick;

  function applyTranslitFormat(command: "bold" | "italic") {
    const el = editableRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    if (command === "bold") document.execCommand("bold", false);
    else document.execCommand("italic", false);

    // Sanitize: keep only <b> and <i> tags
    const raw = el.innerHTML;
    const safe = raw.replace(/<(?!\/?[bi]>)[^>]+>/gi, "");
    el.innerHTML = safe;

    // Restore caret at end
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function saveTranslitFormat() {
    const el = editableRef.current;
    if (!el) return;
    const html = el.innerHTML.replace(/<(?!\/?[bi]>)[^>]+>/gi, "").trim();
    onSaveTransliterationFormat?.(word.wordId, html || null);
    setPopoverOpen(false);
  }

  function handleLabelClick(e: React.MouseEvent) {
    if (isLemmaSearchable) {
      e.stopPropagation();
      onLemmaClick!();
      return;
    }
    if (((typeof subMode === "object" && subMode.type === "dataset") || subMode === "constituent") && datasetGroupingActive) {
      e.stopPropagation();
      onToggleDatasetGroupMember?.(word.wordId);
      return;
    }
    if (!isEditable) return;
    e.stopPropagation();
    if (subMode === "constituent") {
      setPopoverOpen((v) => !v);
    } else if (isTransliteration) {
      setPopoverOpen((v) => !v);
    } else {
      // dataset — open text input popover
      setDraftValue(datasetValue ?? "");
      setPopoverOpen((v) => !v);
    }
  }

  function handleConstituentSelect(key: string | null) {
    onSaveConstituentLabel?.(word.wordId, key);
    setPopoverOpen(false);
  }

  function handleDatasetSave() {
    const val = draftValue.trim();
    onSaveDatasetEntry?.(word.wordId, val || null);
    setPopoverOpen(false);
  }

  // For transliteration: render with bold/italic HTML if format exists, else plain text
  const translitContent = isTransliteration
    ? (transliterationFormat
        ? <span dangerouslySetInnerHTML={{ __html: transliterationFormat }} />
        : getText())
    : null;

  return (
    <span className="relative">
      <span
        className={[
          "word-parse",
          isEditable
            ? datasetGroupingActive
              ? "cursor-pointer rounded px-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/40"
              : "cursor-pointer rounded px-0.5 hover:bg-stone-100 dark:hover:bg-stone-700"
            : "",
          isLemmaSearchable ? "cursor-pointer rounded px-0.5 hover:underline" : "",
        ].join(" ")}
        style={
          isPendingGroupMember
            ? { ...labelStyle, backgroundColor: "rgba(37, 99, 235, 0.35)", outline: "1px solid rgba(37, 99, 235, 0.6)" }
            : labelStyle
        }
        dir={isDatasetMode ? datasetDirection : undefined}
        onClick={handleLabelClick}
        title={
          isLemmaSearchable
            ? "Search this lemma"
            : datasetGroupingActive
              ? "Click to add/remove from grouping"
              : isEditable
                ? "Click to edit"
                : undefined
        }
      >
        {isTransliteration ? translitContent : getText()}
      </span>

      {/* ── Constituent label picker popover ──────────────────────────────── */}
      {popoverOpen && subMode === "constituent" && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 rounded-lg border shadow-lg py-1.5 px-1.5 flex flex-wrap gap-1"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            minWidth: "160px",
            maxWidth: "220px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {CONSTITUENT_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleConstituentSelect(constituentLabel === key ? null : key)}
              className={[
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                constituentLabel === key
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700",
              ].join(" ")}
              style={{ color: constituentLabel === key ? undefined : "var(--foreground)" }}
              title={label}
            >
              {key}
            </button>
          ))}
          {constituentLabel && (
            <button
              onClick={() => handleConstituentSelect(null)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors w-full mt-0.5"
            >
              Clear
            </button>
          )}
        </span>
      )}

      {/* ── Transliteration format editor popover ────────────────────────── */}
      {popoverOpen && isTransliteration && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 rounded-lg border shadow-lg p-2 flex flex-col gap-1.5"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            minWidth: "180px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>Format letters</span>
          {/* Toolbar */}
          <span className="flex gap-1">
            <button
              onMouseDown={(e) => { e.preventDefault(); applyTranslitFormat("bold"); }}
              className="font-bold text-xs px-2 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
              style={{ color: "var(--foreground)" }}
              title="Bold selected letters"
            >B</button>
            <button
              onMouseDown={(e) => { e.preventDefault(); applyTranslitFormat("italic"); }}
              className="italic text-xs px-2 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
              style={{ color: "var(--foreground)" }}
              title="Italic selected letters"
            >I</button>
          </span>
          {/* Contenteditable field showing transliteration */}
          <span
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: transliterationFormat ?? getText() }}
            onKeyDown={(e) => { if (e.key === "Escape") setPopoverOpen(false); }}
            className="rounded border px-1.5 py-0.5 text-xs outline-none min-w-[120px] block"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--foreground)",
              fontFamily: "monospace",
            }}
          />
          <span className="flex gap-1 justify-end">
            <button
              onClick={() => { onSaveTransliterationFormat?.(word.wordId, null); setPopoverOpen(false); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
              style={{ color: "var(--text-muted)" }}
            >Clear</button>
            <button
              onClick={saveTranslitFormat}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white"
            >Save</button>
          </span>
        </span>
      )}

      {/* ── Dataset value input popover ───────────────────────────────────── */}
      {popoverOpen && typeof subMode === "object" && subMode.type === "dataset" && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 rounded-lg border shadow-lg p-2 flex flex-col gap-1.5"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            minWidth: "150px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>{word.wordId}</span>
          <input
            ref={inputRef}
            autoFocus
            dir={datasetDirection}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDatasetSave();
              if (e.key === "Escape") setPopoverOpen(false);
            }}
            placeholder="Enter value…"
            className="rounded border px-1.5 py-0.5 text-xs outline-none w-full"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--foreground)",
            }}
          />
          <span className="flex gap-1 justify-end">
            <button
              onClick={() => { onSaveDatasetEntry?.(word.wordId, null); setPopoverOpen(false); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
              style={{ color: "var(--text-muted)" }}
            >
              Clear
            </button>
            <button
              onClick={handleDatasetSave}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white"
            >
              Save
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

export default function WordToken({
  word,
  displayMode,
  grammarFilter,
  colorRules,
  onSelect,
  selectedWordId,
  showTooltip: tooltipsEnabled,
  useLinguisticTerms,
  editingParagraphs,
  characterRef,
  characterMap,
  editingRefs,
  editingSpeech,
  isRangeStart,
  highlightCharIds,
  synopticMarkColor,
  editingWordCompare,
  wordTagRef,
  wordTagMap,
  editingWordTags,
  highlightWordTagIds,
  wordFormatting,
  editingFormatting,
  tcMark,
  interlinearSubMode = "lemma",
  constituentLabel,
  datasetValue,
  datasetDirection = "ltr",
  transliterationFormat,
  onSaveConstituentLabel,
  onSaveDatasetEntry,
  onSaveTransliterationFormat,
  onLemmaClick,
  showVowels = true,
  showCantillation = true,
  wordHighlightBg,
  datasetGroupingActive,
  isPendingGroupMember,
  onToggleDatasetGroupMember,
  suppressDatasetValueDisplay,
  poetryMarkContinuation,
  poetryMarkRequiredness,
  poetryRequirednessUnderline,
  poetryClosureWeak,
  poetryClosureComplete,
  showPoetryNote,
  poetryNoteText,
  openPoetryNoteMark,
  onSavePoetryNote,
  onDeletePoetryMark,
  onClosePoetryNote,
  onSelectRequirednessResolving,
  openPoetryNoteGroupMembers,
  openPoetryNoteHasMissingArrow,
  onAddWordToSimilarityGroup,
  onSaveSimilarityGroup,
  onDeleteSimilarityWord,
  onRestoreSimilarityArrows,
  editingPoetrySimilarity,
  pendingSimilarityAnchor,
  onGraphemeClick,
  similarityMark,
  onClickSimilarityMark,
}: WordTokenProps) {
  const [hovering, setHovering] = useState(false);
  const [tooltipBelow, setTooltipBelow] = useState(false);
  const wordRef = useRef<HTMLSpanElement>(null);
  const showTooltip = tooltipsEnabled && hovering;
  const isSelected = selectedWordId === word.wordId;

  const posKey = getPosKey(word.partOfSpeech);
  const posColor = posKey ? POS_COLORS[posKey] : null;
  const posEnabled = posKey ? grammarFilter[posKey as keyof GrammarFilterState] : true;

  // Custom rules take priority; fall back to POS color
  const matchedRule =
    displayMode === "color"
      ? colorRules.find((r) => matchesColorRule(word, r))
      : undefined;

  const colorStyle: React.CSSProperties = {};
  if (displayMode === "color") {
    if (matchedRule) {
      colorStyle.color = matchedRule.color;
    } else if (posColor && posEnabled) {
      colorStyle.color = posColor;
    }
  }

  // ── Character underline style ───────────────────────────────────────────────
  const char1 = characterRef ? characterMap.get(characterRef.character1Id) : null;
  const char2 = characterRef?.character2Id != null
    ? characterMap.get(characterRef.character2Id)
    : null;

  const isHebrew = word.language === "hebrew";
  const underlineStyle: React.CSSProperties = char1 && char2 ? {
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
  } : {};

  // (Character highlight and word-tag ring are rendered by VerseDisplay's
  // group-wrapper approach so adjacent same-tagged words form a continuous box.)

  // ── Bold / italic / underline / color formatting ────────────────────────────
  const formattingStyle: React.CSSProperties = {
    fontWeight: wordFormatting?.isBold ? "bold" : undefined,
    fontStyle:  wordFormatting?.isItalic ? "italic" : undefined,
    textDecoration: wordFormatting?.isUnderline ? "underline" : undefined,
    color:      wordFormatting?.textColor ?? undefined,
  };

  // ── Text critical markup overline ───────────────────────────────────────────
  const TC_COLORS: Record<string, string> = {
    lxx_unique:     "#16a34a",  // green-600
    mt_unique:      "#dc2626",  // red-600
    same_different: "#ca8a04",  // yellow-600
  };
  const tcStyle: React.CSSProperties = tcMark ? {
    textDecorationLine:      "overline",
    textDecorationStyle:     "solid",
    textDecorationColor:     TC_COLORS[tcMark] ?? "#888",
    textDecorationThickness: "2.5px",
  } : {};

  // ── Synoptic word-level comparison mark ─────────────────────────────────────
  const synopticMarkStyle: React.CSSProperties = synopticMarkColor ? {
    backgroundColor: `${synopticMarkColor}33`,
    borderRadius: "3px",
  } : {};

  // ── Poetry notation: Closure (weak) / Requiredness (underline) — same
  // mechanism as tcStyle's overline. Thickness is 200% thicker than the
  // tcStyle/underline baseline (2.5px -> 7.5px), per request.
  // textUnderlineOffset pushes the line below Hebrew vowel points (niqqud render below the
  // consonant, lower than the browser's default underline position) so the two don't collide.
  // text-decoration can only draw ONE line per element, so when a word carries BOTH marks at
  // once, that combination switches to two stacked background stripes instead — see
  // poetryDualUnderlineStyle below, which reserves its own room via paddingBottom (rather than
  // relying on the word's natural line-height, which for short/small tokens — e.g. a two-line
  // translation word — isn't tall enough to fit two lines below the text without one colliding
  // with the glyphs) and renders both flush against each other with no gap, thinner than the
  // single-line baseline so the pair stays compact (Requiredness stacked directly above Closure). ──
  const bothPoetryUnderlinesActive = !!poetryClosureWeak && !!poetryRequirednessUnderline;
  const POETRY_UNDERLINE_BASE_OFFSET = "0.35em";
  const POETRY_DUAL_UNDERLINE_THICKNESS_PX = 4;
  const POETRY_DUAL_UNDERLINE_CLEARANCE_PX = isHebrew ? 4 : 2;

  const poetryClosureStyle: React.CSSProperties = (poetryClosureWeak && !bothPoetryUnderlinesActive) ? {
    textDecorationLine:      "underline",
    textDecorationStyle:     "solid",
    textDecorationColor:     POETRY_COLORS.closure,
    textDecorationThickness: `${POETRY_UNDERLINE_THICKNESS_PX}px`,
    textUnderlineOffset:     POETRY_UNDERLINE_BASE_OFFSET,
  } : {};

  // Same mechanism, gray, for Requiredness — underline.
  const poetryRequirednessStyle: React.CSSProperties = (poetryRequirednessUnderline && !bothPoetryUnderlinesActive) ? {
    textDecorationLine:      "underline",
    textDecorationStyle:     "solid",
    textDecorationColor:     POETRY_COLORS.requiredness,
    textDecorationThickness: `${POETRY_UNDERLINE_THICKNESS_PX}px`,
    textUnderlineOffset:     POETRY_UNDERLINE_BASE_OFFSET,
  } : {};

  // Both at once: two background stripes stacked flush (no gap) in a dedicated
  // padding-bottom strip below the text, Requiredness directly above Closure.
  const poetryDualUnderlineStyle: React.CSSProperties = bothPoetryUnderlinesActive ? {
    backgroundImage: `linear-gradient(to right, ${POETRY_COLORS.requiredness}, ${POETRY_COLORS.requiredness}), linear-gradient(to right, ${POETRY_COLORS.closure}, ${POETRY_COLORS.closure})`,
    backgroundSize: `100% ${POETRY_DUAL_UNDERLINE_THICKNESS_PX}px, 100% ${POETRY_DUAL_UNDERLINE_THICKNESS_PX}px`,
    backgroundPosition: `center bottom ${POETRY_DUAL_UNDERLINE_THICKNESS_PX}px, center bottom 0px`,
    backgroundRepeat: "no-repeat, no-repeat",
    paddingBottom: `${POETRY_DUAL_UNDERLINE_CLEARANCE_PX + POETRY_DUAL_UNDERLINE_THICKNESS_PX * 2}px`,
  } : {};

  const style: React.CSSProperties = { ...colorStyle, ...underlineStyle, ...formattingStyle, ...tcStyle, ...synopticMarkStyle, ...poetryRequirednessStyle, ...poetryClosureStyle, ...poetryDualUnderlineStyle };

  const isInterlinear = displayMode === "interlinear";

  function handleMouseEnter() {
    if (wordRef.current) {
      const rect = wordRef.current.getBoundingClientRect();
      setTooltipBelow(rect.top < 350);
    }
    setHovering(true);
  }

  const isEditing = editingParagraphs || editingRefs || editingSpeech || !!editingWordTags || !!editingFormatting || !!editingWordCompare;

  const baseClasses = [
    "relative transition-all duration-100",
    "rounded px-0.5 -mx-0.5",
    editingParagraphs
      ? "cursor-crosshair hover:bg-amber-100 dark:hover:bg-amber-900/40"
      : editingFormatting
        ? "cursor-crosshair hover:bg-amber-50 dark:hover:bg-amber-950/40"
      : editingWordTags
        ? "cursor-crosshair hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
      : editingWordCompare
        ? "cursor-crosshair hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
      : (editingRefs || editingSpeech)
        ? [
            "cursor-crosshair hover:bg-violet-100 dark:hover:bg-violet-900/40",
            isRangeStart ? "outline outline-2 outline-violet-400 bg-violet-100 dark:bg-violet-900/40" : "",
          ].join(" ")
        : isSelected
          ? "cursor-pointer bg-blue-100 dark:bg-blue-900 outline outline-2 outline-blue-400"
          : "cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800",
  ].join(" ");

  let displayText = (word.surfaceText ?? "").replace(/\//g, "");
  if (isHebrew) {
    if (!showCantillation) displayText = displayText.replace(/[֑-֯]/g, "");
    if (!showVowels)       displayText = displayText.replace(/[ְ-ׇֽֿׁׂׅׄ]/g, "");
  }
  const { leading, core, trailing } = splitPunctuation(displayText);
  // A saved mark takes priority over the clickable-graphemes editing UI —
  // otherwise a word that already carries a Similarity mark goes invisible
  // (renders as plain hover-only letters) the moment Similarity edit mode is
  // active, including right after the mark you just created.
  const coreContent = similarityMark
    ? renderGraphemesWithSimilarityHighlight(
        core,
        word.language,
        similarityMark.startIdx,
        similarityMark.endIdx,
        () => onClickSimilarityMark?.(similarityMark.mark.id),
        editingPoetrySimilarity
      )
    : editingPoetrySimilarity
      ? renderClickableGraphemes(
          core,
          word.wordId,
          word.language,
          pendingSimilarityAnchor?.wordId === word.wordId ? pendingSimilarityAnchor.graphemeIndex : null,
          onGraphemeClick ?? (() => {})
        )
    : word.largeLetters
      ? renderWithLargeLetters(core, word.largeLetters)
      : core;

  // Requiredness renders BELOW the line, same as Continuation. When both
  // marks land on the same word they'd otherwise overlap (both centered),
  // so they sit side by side instead, vertically aligned (same top-full
  // offset): Requiredness toward the "inside"/forward-reading direction —
  // right of Continuation in LTR, left of Continuation in RTL — with the
  // arrow itself tagged data-requiredness-arrow so
  // RequirednessConnectorOverlay can anchor its dashed leader line to this
  // exact glyph regardless of which layout branch rendered it.
  const poetryGlyphs = (
    <>
      {poetryMarkContinuation && poetryMarkRequiredness ? (
        <span
          className="absolute left-1/2 -translate-x-1/2 top-full flex items-start gap-0.5 pointer-events-none select-none"
          aria-hidden
        >
          {isHebrew ? (
            <>
              <span data-requiredness-arrow>
                <PoetryArrowIcon direction="left" color={POETRY_COLORS.requiredness} />
              </span>
              <PoetryArrowIcon direction="down" color={POETRY_COLORS.continuation} />
            </>
          ) : (
            <>
              <PoetryArrowIcon direction="down" color={POETRY_COLORS.continuation} />
              <span data-requiredness-arrow>
                <PoetryArrowIcon direction="right" color={POETRY_COLORS.requiredness} />
              </span>
            </>
          )}
        </span>
      ) : (
        <>
          {poetryMarkContinuation && (
            <span
              className="absolute left-1/2 -translate-x-1/2 top-full pointer-events-none select-none"
              aria-hidden
            >
              <PoetryArrowIcon direction="down" color={POETRY_COLORS.continuation} />
            </span>
          )}
          {poetryMarkRequiredness && (
            <span
              className="absolute left-1/2 -translate-x-1/2 top-full pointer-events-none select-none"
              aria-hidden
              data-requiredness-arrow
            >
              <PoetryArrowIcon direction={isHebrew ? "left" : "right"} color={POETRY_COLORS.requiredness} />
            </span>
          )}
        </>
      )}
      {openPoetryNoteMark && openPoetryNoteMark.principle === "similarity" && onClosePoetryNote
        && onAddWordToSimilarityGroup && onSaveSimilarityGroup && onDeleteSimilarityWord ? (
        <SimilarityNotePopover
          mark={openPoetryNoteMark}
          groupMembers={openPoetryNoteGroupMembers ?? [openPoetryNoteMark]}
          hasMissingArrow={openPoetryNoteHasMissingArrow ?? false}
          onAddWord={() => onAddWordToSimilarityGroup(openPoetryNoteMark)}
          onSave={(note) => onSaveSimilarityGroup(openPoetryNoteMark, note)}
          onDeleteWord={() => onDeleteSimilarityWord(openPoetryNoteMark)}
          onRestoreArrows={() => onRestoreSimilarityArrows?.(openPoetryNoteMark)}
          onClose={onClosePoetryNote}
        />
      ) : openPoetryNoteMark && onSavePoetryNote && onDeletePoetryMark && onClosePoetryNote && (
        <PoetryNotePopover
          mark={openPoetryNoteMark}
          color={POETRY_COLORS[(openPoetryNoteMark.principle as keyof typeof POETRY_COLORS)] ?? "#888"}
          onSave={onSavePoetryNote}
          onDelete={onDeletePoetryMark}
          onClose={onClosePoetryNote}
          onSelectResolvingPhrase={onSelectRequirednessResolving ? () => onSelectRequirednessResolving(openPoetryNoteMark) : undefined}
        />
      )}
    </>
  );

  const content = (
    <>
      {leading}
      <span
        ref={wordRef}
        className={baseClasses}
        style={style}
        data-word-id={word.wordId}
        onClick={(e) => onSelect(word, e.shiftKey)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovering(false)}
        title={isEditing ? undefined : `${word.lemma ?? word.surfaceText} — ${word.partOfSpeech ?? "unknown"}`}
      >
        {coreContent}
        {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
        {poetryGlyphs}
      </span>
      {trailing}
      {showPoetryNote && poetryNoteText && (
        // Rendered in normal inline flow, right after the word (and any
        // trailing punctuation), so the note is readable without hovering —
        // same placement rationale as poetryClosureComplete's bar below.
        <span className="inline align-middle select-none whitespace-normal text-[10px] italic leading-tight px-1 py-0.5 rounded mx-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
          {poetryNoteText}
        </span>
      )}
      {poetryClosureComplete && (
        // Rendered in normal inline flow AFTER the trailing punctuation (e.g. sof
        // pasuq ׃) rather than absolutely positioned against the core word span,
        // so the bar sits outside the punctuation instead of behind/under it.
        // Width is 200% thicker than the original 2px baseline (2px -> 6px).
        <span
          aria-hidden
          className="inline-block align-middle pointer-events-none select-none"
          style={{ width: "6px", height: "1.265em", backgroundColor: POETRY_COLORS.closure, marginInlineStart: "3px" }}
        />
      )}
    </>
  );

  if (isInterlinear) {
    return (
      <span className="word-interlinear" style={colorStyle}>
        <span
          ref={wordRef}
          className={baseClasses}
          style={{
            ...underlineStyle,
            ...synopticMarkStyle,
            ...(wordHighlightBg ? { backgroundColor: wordHighlightBg, borderRadius: "3px" } : {}),
          }}
          data-word-id={word.wordId}
          onClick={(e) => onSelect(word, e.shiftKey)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setHovering(false)}
        >
          <span className="word-surface">{coreContent}</span>
          {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
        </span>
        <InterlinearLabel
          word={word}
          isHebrew={isHebrew}
          subMode={interlinearSubMode}
          constituentLabel={constituentLabel ?? null}
          datasetValue={datasetValue ?? null}
          datasetDirection={datasetDirection}
          transliterationFormat={transliterationFormat ?? null}
          onSaveConstituentLabel={onSaveConstituentLabel}
          onSaveDatasetEntry={onSaveDatasetEntry}
          onSaveTransliterationFormat={onSaveTransliterationFormat}
          onLemmaClick={onLemmaClick ? () => onLemmaClick(word) : undefined}
          datasetGroupingActive={datasetGroupingActive}
          isPendingGroupMember={isPendingGroupMember}
          suppressDatasetValueDisplay={suppressDatasetValueDisplay}
          onToggleDatasetGroupMember={onToggleDatasetGroupMember}
        />
      </span>
    );
  }

  return content;
}
