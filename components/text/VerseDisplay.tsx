"use client";

import { useState, useEffect } from "react";
import type { Word, CharacterRef, Character, SpeechSection, WordTag, WordTagRef, LineAnnotation } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry } from "@/lib/morphology/types";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { PLOT_ELEMENTS, ANNOTATION_PALETTE, getPlotElement, getAnnotationColor } from "@/lib/utils/annotations";

/** Width of the hanging-indent space (px). RST lines are drawn inside this space. */
const HANG_PX = 32;

/** Split a translation token into leading punctuation, core word text, and trailing
 *  punctuation so that only the core is wrapped in the styled/clickable span. */
const LEADING_PUNCT = /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7]+/;
const TRAILING_PUNCT = /["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7]+$/;
function splitTokenPunctuation(token: string): { leading: string; core: string; trailing: string } {
  const leading = token.match(LEADING_PUNCT)?.[0] ?? "";
  const rest = token.slice(leading.length);
  const trailing = rest.match(TRAILING_PUNCT)?.[0] ?? "";
  return { leading, core: rest.slice(0, rest.length - trailing.length), trailing };
}

const SPEECH_ACTS = [
  "Acceptance", "Advice", "Apology", "Command", "Declaration",
  "Evaluation", "Expression of feeling", "Farewell", "Greeting",
  "Offer", "Permission", "Prohibition", "Promise", "Question",
  "Refusal", "Request", "Statement/assertion", "Suggestion",
  "Thanks", "Warning", "Wish",
] as const;
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
  // Speech section delete (via × button) and reassign (via character badge)
  onDeleteSpeechSection: (sectionId: number) => void;
  onReassignSpeechSection?: (sectionId: number, newCharId: number) => void;
  // Word / concept tag highlighting
  wordTagRefMap: Map<string, WordTagRef>;
  wordTagMap: Map<number, WordTag>;
  editingWordTags: boolean;
  highlightWordTagIds: Set<number>;
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
  // Source text visibility
  hideSourceText?: boolean;
  // Translation text editing
  editingTranslation?: boolean;
  onUpdateTranslationVerse?: (abbr: string, verse: number, newText: string) => void;
  // Free-form arrows (applies to both source and translation words)
  editingArrows?: boolean;
  onSelectArrowWordById?: (wordId: string) => void;
  // Section breaks — multiple breaks per wordId (one per level), stacked in display
  sceneBreakMap?: Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }>>;
  editingScenes?: boolean;
  onToggleSceneBreak?: (wordId: string, level: number, verse: number) => void;
  onUpdateSceneHeading?: (wordId: string, level: number, heading: string) => void;
  onUpdateSceneOutOfSequence?: (wordId: string, level: number, outOfSequence: boolean) => void;
  onUpdateSceneExtendedThrough?: (wordId: string, level: number, extendedThrough: number | null) => void;
  // Precomputed verse ranges: key = `${wordId}:${level}` → { endChapter, endVerse }
  sectionRanges?: Map<string, { endChapter: number; endVerse: number }>;
  // Line annotations
  annotationsBySegment?: Map<string, { annotation: LineAnnotation; isStart: boolean; isEnd: boolean }[]>;
  themeColorsByLabel?: Map<string, string>;
  editingAnnotations?: boolean;
  annotRangeStartWordId?: string | null;
  annotRangeEndWordId?: string | null;
  onSelectAnnotationSegment?: (wordId: string, shiftHeld?: boolean) => void;
  onSaveAnnotation?: (data: { annotType: string; label: string; color: string; description: string | null; outOfSequence: boolean }) => void;
  onCancelAnnotation?: () => void;
  onDeleteAnnotation?: (id: number) => void;
  onUpdateAnnotation?: (id: number, updates: { label?: string; color?: string; description?: string | null; outOfSequence?: boolean }) => void;
  onExpandAnnotationRange?: (id: number, direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end") => void;
  showAnnotationCol?: boolean;
  /** Called when the user clicks a verse-number label; used to scroll the notes pane */
  onVerseClick?: (verseNum: number) => void;
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
function AnnotBadge({
  annotation,
  isStart,
  isEnd,
  editingAnnotations,
  onDelete,
  onUpdate,
  onAdjustRange,
}: {
  annotation: LineAnnotation;
  isStart: boolean;
  isEnd: boolean;
  editingAnnotations: boolean;
  onDelete?: (id: number) => void;
  onUpdate?: (id: number, updates: { label?: string; description?: string | null; color?: string; outOfSequence?: boolean }) => void;
  onAdjustRange?: (id: number, direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end") => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftDesc, setDraftDesc] = useState(annotation.description ?? "");
  const [draftColor, setDraftColor] = useState(annotation.color);
  const [draftOos, setDraftOos] = useState(annotation.outOfSequence ?? false);
  // Speech act label (desc annotations only)
  const [draftSpeechAct, setDraftSpeechAct] = useState(
    annotation.annotType === "desc" ? (annotation.label ?? "") : ""
  );

  // Keep drafts in sync if annotation is updated externally
  useEffect(() => { setDraftDesc(annotation.description ?? ""); }, [annotation.description]);
  useEffect(() => { setDraftColor(annotation.color); }, [annotation.color]);
  useEffect(() => { setDraftOos(annotation.outOfSequence ?? false); }, [annotation.outOfSequence]);
  useEffect(() => {
    if (annotation.annotType === "desc") setDraftSpeechAct(annotation.label ?? "");
  }, [annotation.label, annotation.annotType]);

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

  function commitEdit() {
    const newDesc = draftDesc.trim() || null;
    const updates: { label?: string; description?: string | null; color?: string; outOfSequence?: boolean } = {};
    if (newDesc !== annotation.description) updates.description = newDesc;
    if (draftColor !== annotation.color) updates.color = draftColor;
    if (draftOos !== (annotation.outOfSequence ?? false)) updates.outOfSequence = draftOos;
    if (annotation.annotType === "desc" && draftSpeechAct !== (annotation.label ?? "")) updates.label = draftSpeechAct;
    if (Object.keys(updates).length > 0) onUpdate?.(annotation.id, updates);
    setIsEditing(false);
  }

  const hasLabel = annotation.label !== "";

  // ── Editing state: description + range controls ──────────────────────────
  if (isEditing) {
    return (
      <div
        className={[isEnd ? "rounded" : "rounded-t", "flex-1 overflow-hidden"].join(" ")}
        style={{ borderLeft: `3px solid ${color}`, backgroundColor: `${color}18` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row */}
        <div className="flex items-center gap-1 px-1.5 pt-1 pb-0.5">
          {hasLabel && (
            <span
              className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none"
              style={{ backgroundColor: color }}
            >
              {annotation.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => { setDraftDesc(annotation.description ?? ""); setDraftOos(annotation.outOfSequence ?? false); setIsEditing(false); }}
            className="shrink-0 ml-auto text-stone-400 hover:text-stone-600 text-xs leading-none"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Description input */}
        <div className="px-1.5 pb-1">
          <input
            autoFocus
            type="text"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { setDraftDesc(annotation.description ?? ""); setIsEditing(false); }
              e.stopPropagation();
            }}
            placeholder="Description (optional)"
            className="w-full px-1 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-white dark:bg-stone-900 text-[10px] placeholder:text-stone-400 dark:placeholder:text-stone-600"
          />
        </div>

        {/* Colour palette — theme and desc annotations only */}
        {annotation.annotType !== "plot" && (
          <div className="px-1.5 pb-1">
            <ColorPalette value={draftColor} onChange={setDraftColor} />
          </div>
        )}

        {/* Speech act — desc annotations only */}
        {annotation.annotType === "desc" && (
          <div className="px-1.5 pb-1">
            <select
              value={draftSpeechAct}
              onChange={(e) => setDraftSpeechAct(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full px-1 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-white dark:bg-stone-900 text-[10px] text-stone-700 dark:text-stone-300"
            >
              <option value="">— Speech act —</option>
              {SPEECH_ACTS.map((act) => (
                <option key={act} value={act}>{act}</option>
              ))}
            </select>
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
  return (
    <div
      className={[
        isEnd ? "rounded" : "rounded-t",
        "flex-1 flex flex-col overflow-hidden",
        editingAnnotations ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : "",
      ].join(" ")}
      style={{ borderLeft: `3px solid ${color}`, backgroundColor: `${color}18` }}
      onClick={editingAnnotations ? (e) => { e.stopPropagation(); setIsEditing(true); } : undefined}
      title={editingAnnotations ? "Click to edit" : undefined}
    >
      <div className="flex items-start gap-1 px-1.5 py-1">
        {annotation.outOfSequence && (
          <span className="shrink-0 text-[10px] font-bold text-amber-500 dark:text-amber-400 leading-none mt-0.5" title="Out of chronological sequence">↩</span>
        )}
        {hasLabel && (
          <span
            className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded text-white leading-none mt-0.5"
            style={{ backgroundColor: color }}
          >
            {annotation.label}
          </span>
        )}
        {annotation.description && (
          <span className="text-[10px] text-stone-600 dark:text-stone-400 leading-tight min-w-0 break-words">
            {annotation.description}
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
  onSave: (data: { annotType: string; label: string; color: string; description: string | null; outOfSequence: boolean }) => void;
  onCancel: () => void;
}) {
  const [annotType, setAnnotType] = useState<"plot" | "theme" | "desc">("plot");
  const [plotLabel, setPlotLabel] = useState<string>(PLOT_ELEMENTS[0].label);
  const [themeLabel, setThemeLabel] = useState("A");
  const [color, setColor] = useState<string>(PLOT_ELEMENTS[0].color);
  const [description, setDescription] = useState("");
  const [outOfSequence, setOutOfSequence] = useState(false);
  const [speechAct, setSpeechAct] = useState("");

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

  function handleSave() {
    let label: string;
    let finalColor: string;
    if (annotType === "plot") {
      label = plotLabel;
      finalColor = getPlotElement(plotLabel)?.color ?? "#6B7280";
    } else if (annotType === "theme") {
      label = themeLabel.trim() || "A";
      finalColor = color;
    } else {
      label = speechAct;   // Speech act (may be empty if none selected)
      finalColor = color;
    }
    onSave({ annotType, label, color: finalColor, description: description.trim() || null, outOfSequence });
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
        <div className="flex items-start gap-1.5 mb-2">
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
      )}

      {annotType === "desc" && (
        <div className="mb-2 flex flex-col gap-1.5">
          <ColorPalette value={color} onChange={setColor} />
          <select
            value={speechAct}
            onChange={(e) => setSpeechAct(e.target.value)}
            className="w-full px-1.5 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-transparent text-[10px] text-stone-700 dark:text-stone-300"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <option value="">— Speech act (optional) —</option>
            {SPEECH_ACTS.map((act) => (
              <option key={act} value={act}>{act}</option>
            ))}
          </select>
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
      <label className="flex items-center gap-1.5 mb-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={outOfSequence}
          onChange={(e) => setOutOfSequence(e.target.checked)}
          className="w-3 h-3 rounded accent-amber-500 cursor-pointer"
        />
        <span className="text-[10px] text-stone-500 dark:text-stone-400">↩ Out of chronological sequence</span>
      </label>

      {/* Buttons */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-medium hover:bg-indigo-700 transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-[10px] hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
        >
          ✕
        </button>
      </div>
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
  onReassignSpeechSection,
  wordTagRefMap,
  wordTagMap,
  editingWordTags,
  highlightWordTagIds,
  lineIndentMap,
  translationIndentMap,
  indentsLinked = true,
  wordToParaStart,
  editingIndents,
  onSetSegmentIndent,
  onSetSegmentTvIndent,
  wordFormattingMap = new Map() as Map<string, { isBold: boolean; isItalic: boolean }>,
  editingFormatting = false,
  hideSourceText = false,
  editingTranslation = false,
  onUpdateTranslationVerse,
  editingArrows = false,
  onSelectArrowWordById,
  sceneBreakMap = new Map() as Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }>>,
  editingScenes = false,
  onToggleSceneBreak,
  onUpdateSceneHeading,
  onUpdateSceneOutOfSequence,
  onUpdateSceneExtendedThrough,
  sectionRanges,
  annotationsBySegment,
  themeColorsByLabel,
  editingAnnotations = false,
  annotRangeStartWordId = null,
  annotRangeEndWordId = null,
  onSelectAnnotationSegment,
  onSaveAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onExpandAnnotationRange,
  showAnnotationCol = false,
  onVerseClick,
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

  // Controls shown on the first row of a speech section when editingSpeech is active:
  //  • Character badge (click → reassign section to the currently active character)
  //  • × delete button
  function renderDeleteBtn(
    segSpeaker: Character | null,
    segSpeech: SpeechSection | null,
    isSegStart: boolean
  ): React.ReactNode {
    if (!segSpeaker || !segSpeech || !editingSpeech || !isSegStart) return null;
    const canReassign = onReassignSpeechSection && _activeCharId !== null && _activeCharId !== segSpeech.characterId;
    return (
      <div
        className="absolute flex items-center gap-0.5 z-10"
        style={{ top: "4px", ...(isHebrew ? { left: "4px" } : { right: "4px" }) }}
      >
        {/* Character badge — click to reassign to the active character */}
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
          title={canReassign
            ? `Reassign to active character`
            : `${segSpeaker.name} — select a different character above to reassign`}
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
      </div>
    );
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
      switch (level) {
        case 1: return "text-sm font-bold uppercase tracking-widest text-stone-800 dark:text-stone-200";
        case 2: return "text-xs font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-300";
        case 3: return "text-[11px] font-medium uppercase tracking-wide text-stone-600 dark:text-stone-400";
        case 4: return "text-[11px] font-normal uppercase tracking-wide text-stone-500 dark:text-stone-500";
        case 5: return "text-[10px] font-normal uppercase tracking-normal text-stone-500 dark:text-stone-500";
        case 6: return "text-[10px] font-normal text-stone-500 dark:text-stone-500";
        default: return "text-xs text-stone-500";
      }
    }

    function lineColorClass(level: number): string {
      if (editingScenes) return "border-amber-400";
      switch (level) {
        case 1: return "border-stone-700 dark:border-stone-300";
        case 2: return "border-stone-600 dark:border-stone-400";
        case 3: return "border-stone-500 dark:border-stone-500";
        default: return "border-stone-400 dark:border-stone-600";
      }
    }

    function rangeLabel(br: { level: number; verse: number }): string {
      const key = `${wordId}:${br.level}`;
      const range = sectionRanges?.get(key);
      if (!range) return `(${br.verse})`;
      if (chapter === range.endChapter) {
        if (br.verse === range.endVerse) return `(${br.verse})`;
        return `(${br.verse}–${range.endVerse})`;
      }
      return `(${chapter}:${br.verse} – ${range.endChapter}:${range.endVerse})`;
    }

    return (
      <div className="mt-5 mb-2" onClick={editingScenes ? (e) => e.stopPropagation() : undefined}>
        {/* Render each existing break stacked */}
        {sorted.map((br) => (
          <div key={br.level} className="mb-1">
            {editingScenes ? (
              <div className="flex flex-col gap-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0 w-10">L{br.level}:</span>
                  <input
                    key={`${wordId}-${br.level}`}
                    className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400 bg-transparent border-none outline-none focus:ring-0 px-0 placeholder:text-stone-300 dark:placeholder:text-stone-600"
                    defaultValue={br.heading ?? ""}
                    placeholder="Section label"
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
              </div>
            ) : (br.heading || br.outOfSequence) ? (
              <div className="flex items-center gap-1.5 pb-0.5 select-none">
                {br.outOfSequence && (
                  <span className="text-[10px] font-bold text-amber-500 dark:text-amber-400 shrink-0" title="Out of chronological sequence">↩</span>
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

        {/* Add new level UI — only shown in editing mode, only if fewer than 6 levels present */}
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
          "w-48 flex-none pl-3 self-stretch flex flex-col",
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
            onSave={(data) => onSaveAnnotation?.(data)}
            onCancel={() => onCancelAnnotation?.()}
          />
        )}
      </div>
    );
  }

  // Returns the appropriate separator for a paragraph-starting word:
  // scene break → solid HR + heading; regular paragraph break → dashed line.
  function renderSegSeparator(wordId: string): React.ReactNode {
    if ((sceneBreakMap.get(wordId)?.length ?? 0) > 0) return renderSceneSeparator(wordId);
    return (
      <div
        className={`w-full border-t border-dashed mb-2 ${
          editingParagraphs
            ? "border-amber-400"
            : "border-stone-300 dark:border-stone-600"
        }`}
        aria-hidden="true"
      />
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

  function computeWordGroups(words: Word[]): WordGroup[] {
    const groups: WordGroup[] = [];
    for (const word of words) {
      const cr  = characterRefMap.get(word.wordId) ?? null;
      const wtr = wordTagRefMap.get(word.wordId)   ?? null;
      const wt  = wtr ? (wordTagMap.get(wtr.tagId) ?? null) : null;
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
        (highlightCharIds.has(charRef.character1Id) ||
          (charRef.character2Id != null &&
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
      const inner = gWords.map((word, wi) => (
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
            characterRef={charRef}
            characterMap={characterMap}
            editingRefs={editingRefs}
            editingSpeech={editingSpeech}
            isRangeStart={word.wordId === speechRangeStartWordId}
            highlightCharIds={highlightCharIds}
            wordTagRef={groupWtr}
            wordTagMap={wordTagMap}
            editingWordTags={editingWordTags}
            highlightWordTagIds={highlightWordTagIds}
            wordFormatting={wordFormattingMap.get(word.wordId) ?? null}
            editingFormatting={editingFormatting}
          />
          {wi < gWords.length - 1 && " "}
        </span>
      ));

      // Wrap in a styled span (or plain span when unstyled); space between
      // groups goes OUTSIDE so it isn't coloured by the adjacent group.
      elements.push(
        <span key={gi} style={hasStyle ? wrapperStyle : undefined}>
          {inner}
        </span>
      );
      if (gi < groups.length - 1) elements.push(" ");
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
  if (translationTexts.length === 0) {
    return (
      <div className={`${verseStartsNewParagraph ? "mt-5" : ""} ${speechContinuesIntoNext ? "" : "mb-4"}`}>
        {verseStartsNewParagraph && firstWordId && renderSegSeparator(firstWordId)}
        {sourceSegments.map((seg, si) => {
          const { segSpeech, segSpeaker, isSegStart, isSegEnd } = getSegSpeech(seg, si);
          const runs = computeRuns(seg, segSpeech);
          const paraStartId = wordToParaStart.get(seg[0].wordId) ?? seg[0].wordId;
          const indentLevel = lineIndentMap.get(paraStartId) ?? 0;
          // ── Hanging-indent label and source elements ──────────────
          // Half-leading of the source text — pushes the verse label down so its
          // text visually aligns with the first character of the source line.
          // Hebrew line-height:2.5 → half-leading = 0.75×fontSize;
          // Greek  line-height:2.25 → half-leading = 0.625×fontSize.
          const labelPaddingTop = isHebrew
            ? "calc(0.75 * var(--hebrew-font-size, 1.375rem))"
            : "calc(0.625 * var(--greek-font-size, 1.25rem))";

          const segLabelEl = editingIndents ? (
            <div className="flex items-start gap-0.5" data-seg-label={seg[0].wordId} style={{ minWidth: "5rem" }}>
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
              style={{ minWidth: "5rem", textAlign: isHebrew ? "right" : "left", paddingTop: labelPaddingTop }}
              onClick={si === 0 && onVerseClick ? () => onVerseClick(verseNum) : undefined}
              title={si === 0 && onVerseClick ? "Scroll notes to this verse" : undefined}
            >
              {paraLabels[si]}
            </span>
          );
          const segSourceEl = (
            <span
              data-rst-text={seg[0].wordId}
              className={`${isHebrew ? "text-hebrew" : "text-greek"} leading-loose`}
              lang={isHebrew ? "he" : "grc"}
              style={{
                // Grid items are blockified by CSS, so text-indent works here without display:block.
                // Hanging indent: "Xpx hanging" indents continuation lines without negative positioning,
                // so inline-flex interlinear chips on the first line are never displaced.
                paddingLeft:  !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                paddingRight: isHebrew  && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                textIndent:   `${HANG_PX}px hanging` as React.CSSProperties["textIndent"],
              }}
            >
              {renderRuns(runs)}
            </span>
          );

          return (
            // data-rst-seg is used by RstRelationOverlay to measure segment position
            <div key={si} data-rst-seg={seg[0].wordId}>
              {/* Scene break on a within-verse paragraph segment */}
              {si > 0 && (sceneBreakMap.get(seg[0].wordId)?.length ?? 0) > 0 && renderSceneSeparator(seg[0].wordId)}
              {/* Flex wrapper so the annotation column can sit to the right of the text grid */}
              <div className="flex items-stretch">
                <div className="flex-1 min-w-0">
                  {/* 2-column grid. Hebrew (RTL): source first → rightmost; label second → leftmost.
                      Greek (LTR): label first → leftmost; source second → rightmost. */}
                  <div
                    style={{ gridTemplateColumns: isHebrew ? "1fr auto" : "auto 1fr", ...segBoxStyle(segSpeaker, isSegStart, isSegEnd) }}
                    className={`grid items-start${editingSpeech ? " cursor-crosshair" : ""}${editingAnnotations ? " cursor-pointer" : ""}${si > 0 ? " mt-1" : ""}`}
                    dir={isHebrew ? "rtl" : "ltr"}
                  >
                    {renderDeleteBtn(segSpeaker, segSpeech, isSegStart)}
                    {isHebrew ? segSourceEl : segLabelEl}
                    {isHebrew ? segLabelEl  : segSourceEl}
                  </div>
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
      {verseStartsNewParagraph && firstWordId && renderSegSeparator(firstWordId)}

      {/* Each source paragraph is its own 5-cell grid row so the speech-box
          background/border wraps the source, arc columns, label AND translation together. */}
      {sourceSegments.map((seg, si) => {
        const { segSpeech, segSpeaker, isSegStart, isSegEnd } = getSegSpeech(seg, si);
        const runs = computeRuns(seg, segSpeech);

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
                    paddingLeft: tvIndentLevel > 0 ? `${tvIndentLevel * 2}rem` : undefined,
                    textIndent: `${HANG_PX}px hanging` as React.CSSProperties["textIndent"],
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

                      // Background-colour highlight (matches source word group approach)
                      const tvBgStyle: React.CSSProperties = isTokenHighlighted
                        ? { backgroundColor: "rgba(253, 224, 71, 0.45)", borderRadius: "3px" }
                        : tvTag && !isTokenHighlighted
                          ? {
                              backgroundColor: isTvTagHighlighted
                                ? `${tvTag.color}55`
                                : `${tvTag.color}28`,
                              borderRadius: "3px",
                            }
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

                      const tokenClassName = editingArrows
                        ? "cursor-crosshair rounded px-0.5 -mx-0.5 hover:bg-slate-100 dark:hover:bg-slate-900/40 transition-colors"
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

                      const handleClick = editingArrows
                        ? () => onSelectArrowWordById?.(wordId)
                        : editingFormatting
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

                      const { leading: tokLead, core: tokCore, trailing: tokTrail } = splitTokenPunctuation(token);

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
                          {tokLead}
                          <span
                            data-word-id={wordId}
                            style={{ ...underlineStyle, ...tvBgStyle, ...tvFormattingStyle }}
                            className={tokenClassName}
                            onClick={handleClick}
                          >
                            {tokCore}
                          </span>
                          {tokTrail}
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

        const labelPaddingTop = isHebrew
          ? "calc(0.75 * var(--hebrew-font-size, 1.375rem))"
          : "calc(0.625 * var(--greek-font-size, 1.25rem))";

        return (
          // data-rst-seg is used by RstRelationOverlay to measure segment position
          <div key={si} data-rst-seg={seg[0].wordId}>
            {/* Scene break on a within-verse paragraph segment */}
            {si > 0 && (sceneBreakMap.get(seg[0].wordId)?.length ?? 0) > 0 && renderSceneSeparator(seg[0].wordId)}
            {/* Flex wrapper so the annotation column can sit to the right of the text grid */}
            <div className="flex items-stretch">
              <div className="flex-1 min-w-0">
                {/* Grid layout (arc columns removed; hanging indent handles the visual depth):
                    Hebrew 5-col: source | verse-label | translation     → "1fr auto 1fr" + dir=rtl on source
                    Greek  5-col: source | verse-label | translation     → "1fr auto 1fr"
                    3-col (hideSourceText): verse-label | translation    → "auto 1fr" */}
                <div
                  className={`grid items-start${editingSpeech ? " cursor-crosshair" : ""}${editingAnnotations ? " cursor-pointer" : ""}`}
                  style={{
                    gridTemplateColumns: hideSourceText
                      ? "auto 1fr"
                      : "1fr auto 1fr",
                    ...segBoxStyle(segSpeaker, isSegStart, isSegEnd),
                  }}
                >
                  {renderDeleteBtn(segSpeaker, segSpeech, isSegStart)}

                  {/* Source words (hidden in translation-only mode) */}
                  {!hideSourceText && (
                    <div
                      dir={isHebrew ? "rtl" : "ltr"}
                      style={{
                        // "Xpx hanging" indents continuation lines without negative positioning,
                        // so inline-flex interlinear chips on the first line are never displaced.
                        paddingLeft:  !isHebrew && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                        paddingRight: isHebrew  && indentLevel > 0 ? `${indentLevel * 2}rem` : undefined,
                        textIndent:   `${HANG_PX}px hanging` as React.CSSProperties["textIndent"],
                      }}
                    >
                      <span
                        data-rst-text={seg[0].wordId}
                        className={`${isHebrew ? "text-hebrew" : "text-greek"} leading-loose`}
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
                        style={{ minWidth: "5rem", textAlign: "center", paddingTop: labelPaddingTop }}
                      >
                        {paraLabels[si]}
                      </span>
                    )}
                  </div>

                  {/* Translation content. Hanging indent lives on each <p> element. */}
                  <div
                    className="flex flex-col gap-1"
                    data-seg-translation={seg[0].wordId}
                    style={{ paddingTop: "4px" }}
                  >
                    {tvRowContent}
                  </div>
                </div>
              </div>
              {renderAnnotationColForSeg(seg[0].wordId)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
