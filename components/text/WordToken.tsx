"use client";

import { useRef, useState } from "react";
import type { Word, CharacterRef, Character, WordTag, WordTagRef } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState } from "@/lib/morphology/types";
import { POS_COLORS } from "@/lib/morphology/types";
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
}

function getInterlinearLabel(word: Word): string {
  if (word.language === "hebrew") {
    // Look up the actual Hebrew word form from the Strong's number
    const lemma = word.strongNumber
      ? (hebrewLemmas as Record<string, string>)[word.strongNumber]
      : null;
    return lemma ?? word.lemma ?? "—";
  }
  // Greek (SBLGNT/MorphGNT): word.lemma already contains the Greek lemma text
  return word.lemma ?? word.partOfSpeech?.slice(0, 4) ?? "—";
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

  // ── Yellow halo for highlighted characters ──────────────────────────────────
  const isHighlighted = highlightCharIds.size > 0 && characterRef != null && (
    highlightCharIds.has(characterRef.character1Id) ||
    (characterRef.character2Id != null && highlightCharIds.has(characterRef.character2Id))
  );

  // ── Word / concept tag ring ────────────────────────────────────────────────
  // box-shadow is used instead of backgroundColor so the indicator is independent
  // of any parent background tint (e.g. speech-section boxes).
  const wordTag = wordTagRef && wordTagMap ? wordTagMap.get(wordTagRef.tagId) : null;
  const isWordTagHighlighted = !!wordTag && !!(highlightWordTagIds?.has(wordTag.id));

  // Combine character halo + word-tag ring into one box-shadow value
  const shadows: string[] = [];
  if (isHighlighted) shadows.push("0 0 0 3px rgba(253, 224, 71, 0.85)");
  if (wordTag) {
    shadows.push(
      isWordTagHighlighted
        // Highlighted: solid ring + outer glow for emphasis
        ? `0 0 0 2px ${wordTag.color}, 0 0 6px 1px ${wordTag.color}88`
        // Always-on: full-opacity ring so tags are visible while reading
        : `0 0 0 1.5px ${wordTag.color}`,
    );
  }
  const shadowStyle: React.CSSProperties = shadows.length > 0
    ? { boxShadow: shadows.join(", "), borderRadius: "2px" }
    : {};

  // ── Bold / italic formatting ────────────────────────────────────────────────
  const formattingStyle: React.CSSProperties = {
    fontWeight: wordFormatting?.isBold ? "bold" : undefined,
    fontStyle:  wordFormatting?.isItalic ? "italic" : undefined,
  };

  const style: React.CSSProperties = { ...colorStyle, ...underlineStyle, ...shadowStyle, ...formattingStyle };

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

  const content = (
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
      {(word.surfaceText ?? "").replace(/\//g, "")}
      {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
    </span>
  );

  if (isInterlinear) {
    return (
      <span className="word-interlinear" style={colorStyle}>
        <span
          ref={wordRef}
          className={baseClasses}
          style={{ ...underlineStyle, ...shadowStyle }}
          data-word-id={word.wordId}
          onClick={(e) => onSelect(word, e.shiftKey)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setHovering(false)}
        >
          <span className="word-surface">{(word.surfaceText ?? "").replace(/\//g, "")}</span>
          {showTooltip && !isEditing && <ParseTooltip word={word} flipped={tooltipBelow} useLinguisticTerms={useLinguisticTerms} />}
        </span>
        <span className="word-parse">{getInterlinearLabel(word)}</span>
      </span>
    );
  }

  return content;
}
