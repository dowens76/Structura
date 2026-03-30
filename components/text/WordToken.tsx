"use client";

import { useRef, useState } from "react";
import type { Word, CharacterRef, Character, WordTag, WordTagRef } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, InterlinearSubMode } from "@/lib/morphology/types";
import { POS_COLORS, CONSTITUENT_LABELS } from "@/lib/morphology/types";
import { getPosKey, matchesColorRule, type ColorRule } from "@/lib/morphology/colorRules";
import ParseTooltip from "./ParseTooltip";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";

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
  // Word / concept tag highlighting
  wordTagRef?: WordTagRef | null;
  wordTagMap?: Map<number, WordTag>;
  editingWordTags?: boolean;
  highlightWordTagIds?: Set<number>;
  // Bold / italic formatting
  wordFormatting?: { isBold: boolean; isItalic: boolean } | null;
  editingFormatting?: boolean;
  // Interlinear sub-mode
  interlinearSubMode?: InterlinearSubMode;
  constituentLabel?: string | null;
  datasetValue?: string | null;
  onSaveConstituentLabel?: (wordId: string, label: string | null) => void;
  onSaveDatasetEntry?: (wordId: string, value: string | null) => void;
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
  onSaveConstituentLabel?: (wordId: string, label: string | null) => void;
  onSaveDatasetEntry?: (wordId: string, value: string | null) => void;
}

function InterlinearLabel({
  word,
  isHebrew,
  subMode,
  constituentLabel,
  datasetValue,
  onSaveConstituentLabel,
  onSaveDatasetEntry,
}: InterlinearLabelProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draftValue,  setDraftValue]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const labelStyle: React.CSSProperties = {
    fontFamily: isHebrew
      ? '"Ezra SIL", "SBL Hebrew", serif'
      : '"Gentium Plus", "GFS Didot", serif',
    fontSize: "0.72em",
    color: "var(--interlinear-color)",
  };

  function getText(): string {
    if (subMode === "lemma")       return getInterlinearLabel(word);
    if (subMode === "strongs")     return word.strongNumber ?? "—";
    if (subMode === "morph")       return word.morphCode ?? "—";
    if (subMode === "constituent") return constituentLabel ?? "·";
    // dataset
    return datasetValue ?? "·";
  }

  const isEditable = subMode === "constituent" || (typeof subMode === "object" && subMode.type === "dataset");

  function handleLabelClick(e: React.MouseEvent) {
    if (!isEditable) return;
    e.stopPropagation();
    if (subMode === "constituent") {
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

  return (
    <span className="relative">
      <span
        className={[
          "word-parse",
          isEditable ? "cursor-pointer rounded px-0.5 hover:bg-stone-100 dark:hover:bg-stone-700" : "",
        ].join(" ")}
        style={labelStyle}
        onClick={handleLabelClick}
        title={isEditable ? "Click to edit" : undefined}
      >
        {getText()}
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
  wordTagRef,
  wordTagMap,
  editingWordTags,
  highlightWordTagIds,
  wordFormatting,
  editingFormatting,
  interlinearSubMode = "lemma",
  constituentLabel,
  datasetValue,
  onSaveConstituentLabel,
  onSaveDatasetEntry,
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
    textDecoration: "underline",
    textDecorationColor: char1.color,
    textDecorationThickness: "2px",
    textUnderlineOffset: isHebrew ? "6px" : "2px",
  } : {};

  // (Character highlight and word-tag ring are rendered by VerseDisplay's
  // group-wrapper approach so adjacent same-tagged words form a continuous box.)

  // ── Bold / italic formatting ────────────────────────────────────────────────
  const formattingStyle: React.CSSProperties = {
    fontWeight: wordFormatting?.isBold ? "bold" : undefined,
    fontStyle:  wordFormatting?.isItalic ? "italic" : undefined,
  };

  const style: React.CSSProperties = { ...colorStyle, ...underlineStyle, ...formattingStyle };

  const isInterlinear = displayMode === "interlinear";

  function handleMouseEnter() {
    if (wordRef.current) {
      const rect = wordRef.current.getBoundingClientRect();
      setTooltipBelow(rect.top < 350);
    }
    setHovering(true);
  }

  const isEditing = editingParagraphs || editingRefs || editingSpeech || !!editingWordTags || !!editingFormatting;

  const baseClasses = [
    "relative transition-all duration-100",
    "rounded px-0.5 -mx-0.5",
    editingParagraphs
      ? "cursor-crosshair hover:bg-amber-100 dark:hover:bg-amber-900/40"
      : editingFormatting
        ? "cursor-crosshair hover:bg-amber-50 dark:hover:bg-amber-950/40"
      : editingWordTags
        ? "cursor-crosshair hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
      : (editingRefs || editingSpeech)
        ? [
            "cursor-crosshair hover:bg-violet-100 dark:hover:bg-violet-900/40",
            isRangeStart ? "outline outline-2 outline-violet-400 bg-violet-100 dark:bg-violet-900/40" : "",
          ].join(" ")
        : isSelected
          ? "cursor-pointer bg-blue-100 dark:bg-blue-900 outline outline-2 outline-blue-400"
          : "cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800",
  ].join(" ");

  const displayText = (word.surfaceText ?? "").replace(/\//g, "");
  const { leading, core, trailing } = splitPunctuation(displayText);

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
        {core}
        {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
      </span>
      {trailing}
    </>
  );

  if (isInterlinear) {
    return (
      <span className="word-interlinear" style={colorStyle}>
        <span
          ref={wordRef}
          className={baseClasses}
          style={underlineStyle}
          data-word-id={word.wordId}
          onClick={(e) => onSelect(word, e.shiftKey)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setHovering(false)}
        >
          <span className="word-surface">{core}</span>
          {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
        </span>
        <InterlinearLabel
          word={word}
          isHebrew={isHebrew}
          subMode={interlinearSubMode}
          constituentLabel={constituentLabel ?? null}
          datasetValue={datasetValue ?? null}
          onSaveConstituentLabel={onSaveConstituentLabel}
          onSaveDatasetEntry={onSaveDatasetEntry}
        />
      </span>
    );
  }

  return content;
}
