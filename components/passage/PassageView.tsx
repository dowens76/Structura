"use client";

import { useState, useTransition, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Passage, Word,
  Character, CharacterRef, SpeechSection, WordTag, WordTagRef,
  Translation, TranslationVerse, RstRelation, WordArrow, LineAnnotation,
} from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry } from "@/lib/morphology/types";
import type { ColorRule } from "@/lib/morphology/colorRules";
import VerseDisplay from "@/components/text/VerseDisplay";
import MorphologyPanel from "@/components/text/MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel from "@/components/controls/WordTagPanel";
import RstRelationOverlay from "@/components/text/RstRelationOverlay";
import WordArrowOverlay from "@/components/text/WordArrowOverlay";
import ClearAnnotationsDialog, { type ClearCategory } from "@/components/controls/ClearAnnotationsDialog";
import { RELATIONSHIP_TYPES, RELATIONSHIP_MAP } from "@/lib/morphology/clauseRelationships";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import { computeSectionRanges } from "@/lib/utils/sectionRanges";
import { generateOutline, downloadOutline } from "@/lib/utils/outlineExport";

/** Returns true if the word's surface text is entirely punctuation and should
 *  be skipped during character / word-tag selection. */
function isPunctuationWord(word: Word): boolean {
  const text = (word.surfaceText ?? "").replace(/\//g, "").trim();
  return text.length > 0 && /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7]+$/.test(text);
}

// ── Persistent settings helpers ───────────────────────────────────────────
function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded */ }
}

const DEFAULT_FILTER: GrammarFilterState = {
  noun: true, verb: true, adjective: true, adverb: true,
  preposition: true, conjunction: true, pronoun: true,
  particle: true, article: true, interjection: true,
};

interface Props {
  passage: Passage;
  words: Word[];
  bookName: string;
  isHebrew: boolean;
  chapterCount: number;
  /** Max verse of passage.startChapter (for shrink-start cross-chapter) */
  maxVerseOfStartChapter: number;
  /** Max verse of passage.endChapter (for extend-end cross-chapter) */
  maxVerseOfEndChapter: number;
  /** Max verse of (startChapter − 1), 0 if startChapter === 1 */
  maxVerseOfPrevStartChapter: number;
  /** Max verse of (endChapter − 1), 0 if endChapter === 1 */
  maxVerseOfPrevEndChapter: number;
  osisBook: string;
  textSource: string;
  // Editing data
  initialParagraphBreakIds: string[];
  initialCharacters: Character[];
  initialCharacterRefs: CharacterRef[];
  initialSpeechSections: SpeechSection[];
  initialWordTags: WordTag[];
  initialWordTagRefs: WordTagRef[];
  initialLineIndents: { wordId: string; indentLevel: number }[];
  // Translation data
  availableTranslations: Translation[];
  translationVerseData: Record<number, TranslationVerse[]>;
  // RST relations + word arrows
  initialRstRelations: RstRelation[];
  initialWordArrows: WordArrow[];
  // Word formatting (bold / italic)
  initialWordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[];
  // Scene / episode breaks
  initialSceneBreaks: { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }[];
  // Line annotations (plot / theme / desc)
  initialLineAnnotations: LineAnnotation[];
  // Book-wide breaks + max verses for cross-chapter range computation
  bookSceneBreaks: { wordId: string; level: number; chapter: number; verse: number; extendedThrough: number | null }[];
  bookMaxVerses: Map<number, number>;
}

export default function PassageView({
  passage: initialPassage,
  words,
  bookName,
  isHebrew,
  chapterCount,
  maxVerseOfStartChapter,
  maxVerseOfEndChapter,
  maxVerseOfPrevStartChapter,
  maxVerseOfPrevEndChapter,
  osisBook,
  textSource,
  initialParagraphBreakIds,
  initialCharacters,
  initialCharacterRefs,
  initialSpeechSections,
  initialWordTags,
  initialWordTagRefs,
  initialLineIndents,
  availableTranslations,
  translationVerseData,
  initialRstRelations,
  initialWordArrows,
  initialWordFormatting,
  initialSceneBreaks,
  initialLineAnnotations,
  bookSceneBreaks,
  bookMaxVerses,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Passage state ─────────────────────────────────────────────────────────
  const [passage, setPassage] = useState(initialPassage);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setPassage(initialPassage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPassage.id]);

  // ── Display / reading settings ────────────────────────────────────────────
  // Use hardcoded defaults for initial render so server and client HTML match,
  // then hydrate from localStorage in the mount useEffect to avoid hydration mismatch.
  const [displayMode, setDisplayMode] = useState<DisplayMode>("clean");
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showTooltips, setShowTooltips] = useState(false);
  const [activeTranslationAbbrs, setActiveTranslationAbbrs] = useState<Set<string>>(new Set());
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [useLinguisticTerms, setUseLinguisticTerms] = useState(false);
  const [hebrewFontSize, setHebrewFontSize] = useState(1.375);
  const [greekFontSize, setGreekFontSize] = useState(1.25);
  const [translationFontSize, setTranslationFontSize] = useState(0.875);
  const [hideSourceText, setHideSourceText] = useState(false);

  // Persist sticky settings
  useEffect(() => { writeLocal("structura:displayMode", displayMode); }, [displayMode]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);

  // Restore all persisted settings after hydration — avoids SSR/client HTML mismatch.
  // Font sizes are included here (not in lazy initializers) for the same reason.
  // Write effects for font sizes were removed; adjustFontSize writes directly instead.
  useEffect(() => {
    setDisplayMode(readLocal<DisplayMode>("structura:displayMode", "clean"));
    setActiveTranslationAbbrs(new Set(readLocal<string[]>("structura:activeTranslations", [])));
    setUseLinguisticTerms(readLocal<boolean>("structura:useLinguisticTerms", false));
    setHebrewFontSize(readLocal<number>("structura:hebrewFontSize", 1.375));
    setGreekFontSize(readLocal<number>("structura:greekFontSize", 1.25));
    setTranslationFontSize(readLocal<number>("structura:translationFontSize", 0.875));
    setHideSourceText(readLocal<boolean>("structura:hideSourceText", false));
  }, []);

  // ── Editing mode toggles ──────────────────────────────────────────────────
  const [editingParagraphs, setEditingParagraphs] = useState(false);
  const [paragraphBreakIds, setParagraphBreakIds] = useState<Set<string>>(
    () => new Set(initialParagraphBreakIds)
  );

  // ── Character tagging state ───────────────────────────────────────────────
  const [highlightCharIds, setHighlightCharIds] = useState<Set<number>>(new Set());
  const [editingRefs, setEditingRefs] = useState(false);
  const [editingSpeech, setEditingSpeech] = useState(false);
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [activeCharId, setActiveCharId] = useState<number | null>(
    initialCharacters[0]?.id ?? null
  );
  const [characterRefMap, setCharacterRefMap] = useState<Map<string, CharacterRef>>(
    () => new Map(initialCharacterRefs.map((r) => [r.wordId, r]))
  );
  const [speechSections, setSpeechSections] = useState<SpeechSection[]>(initialSpeechSections);
  const [speechRangeStart, setSpeechRangeStart] = useState<Word | null>(null);

  // ── Word / concept tag state ──────────────────────────────────────────────
  const [wordTags, setWordTags] = useState<WordTag[]>(initialWordTags);
  const [wordTagRefMap, setWordTagRefMap] = useState<Map<string, WordTagRef>>(
    () => new Map(initialWordTagRefs.map((r) => [r.wordId, r]))
  );
  const [editingWordTags, setEditingWordTags] = useState(false);
  const [activeWordTagId, setActiveWordTagId] = useState<number | null>(
    initialWordTags[0]?.id ?? null
  );
  const [highlightWordTagIds, setHighlightWordTagIds] = useState<Set<number>>(new Set());
  const [pendingWordTag, setPendingWordTag] = useState(false);
  const [pendingWordTagColor, setPendingWordTagColor] = useState<string | null>(null);

  const wordTagMap = useMemo(
    () => new Map(wordTags.map((t) => [t.id, t])),
    [wordTags]
  );

  // ── Paragraph indentation state ───────────────────────────────────────────
  const [lineIndentMap, setLineIndentMap] = useState<Map<string, number>>(
    () => new Map(initialLineIndents.filter(li => !li.wordId.startsWith("tv:")).map((li) => [li.wordId, li.indentLevel]))
  );
  const [tvLineIndentMap, setTvLineIndentMap] = useState<Map<string, number>>(
    () => new Map(initialLineIndents.filter(li => li.wordId.startsWith("tv:")).map((li) => [li.wordId.slice(3), li.indentLevel]))
  );
  const [indentsLinked, setIndentsLinked] = useState(true);
  const [editingIndents, setEditingIndents] = useState(false);

  // ── RST relation state ────────────────────────────────────────────────────
  const [rstRelations, setRstRelations]       = useState<RstRelation[]>(initialRstRelations);
  const [editingRst, setEditingRst]           = useState(false);
  const [rstSegA, setRstSegA]                 = useState<string | null>(null);
  const [rstSegB, setRstSegB]                 = useState<string | null>(null);
  const [rstRolesSwapped, setRstRolesSwapped] = useState(false);
  const [showRstPicker, setShowRstPicker]     = useState(false);

  // ── Word arrows state ──────────────────────────────────────────────────────
  const [wordArrowsState, setWordArrowsState] = useState<WordArrow[]>(initialWordArrows);
  const [editingArrows, setEditingArrows]     = useState(false);
  const [arrowFromWordId, setArrowFromWordId] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  // ── Section break state ──────────────────────────────────────────────────────
  const [sceneBreakMap, setSceneBreakMap] = useState<Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }>>>(
    () => {
      const m = new Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }>>();
      for (const sb of initialSceneBreaks) {
        const arr = m.get(sb.wordId) ?? [];
        arr.push({ heading: sb.heading, level: sb.level, verse: sb.verse, outOfSequence: sb.outOfSequence, extendedThrough: sb.extendedThrough });
        m.set(sb.wordId, arr);
      }
      return m;
    }
  );
  const [editingScenes, setEditingScenes] = useState(false);
  // newPassage prompt state
  const searchParams = useSearchParams();
  const [showNewPassagePrompt, setShowNewPassagePrompt] = useState(() => searchParams.get("newPassage") === "true");
  const [newPassageLevel, setNewPassageLevel] = useState(1);
  const [newPassageHeading, setNewPassageHeading] = useState("");

  // ── Line annotation state ──────────────────────────────────────────────────
  const [lineAnnotationsState, setLineAnnotationsState] = useState<LineAnnotation[]>(initialLineAnnotations);
  const [editingAnnotations, setEditingAnnotations] = useState(false);
  const [annotRangeStart, setAnnotRangeStart] = useState<string | null>(null);
  const [annotRangeEnd, setAnnotRangeEnd]     = useState<string | null>(null);

  // ── Word formatting (bold / italic) state ──────────────────────────────────
  const [wordFormattingMap, setWordFormattingMap] = useState<Map<string, { isBold: boolean; isItalic: boolean }>>(
    () => new Map(initialWordFormatting.map((f) => [f.wordId, { isBold: f.isBold, isItalic: f.isItalic }]))
  );
  const [editingBold, setEditingBold]     = useState(false);
  const [editingItalic, setEditingItalic] = useState(false);

  // ── Translation editing state ──────────────────────────────────────────────
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [localTranslationVerseData, setLocalTranslationVerseData] = useState<Record<number, TranslationVerse[]>>(
    () => translationVerseData
  );

  // ── Overlay ref ────────────────────────────────────────────────────────────
  const overlayContainerRef = useRef<HTMLDivElement>(null);

  // ── Undo stack ────────────────────────────────────────────────────────────
  type UndoEntry = { label: string; undo: () => void | Promise<void> };
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  function pushUndo(entry: UndoEntry) {
    setUndoStack((prev) => [...prev.slice(-49), entry]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        setUndoStack((prev) => {
          if (prev.length === 0) return prev;
          const entry = prev[prev.length - 1];
          entry.undo();
          return prev.slice(0, -1);
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Word → chapter lookup (for API calls that require chapter) ────────────
  const wordToChapter = useMemo(
    () => new Map(words.map((w) => [w.wordId, w.chapter])),
    [words]
  );

  // Precomputed section ranges: key = `${wordId}:${level}` → { endChapter, endVerse }
  // Uses book-wide breaks (from bookSceneBreaks prop) plus live passage breaks from sceneBreakMap.
  // Chapters covered by the passage come from live state; other chapters from the static prop.
  const passageChapterSet = useMemo(() => {
    const s = new Set<number>();
    for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) s.add(ch);
    return s;
  }, [passage.startChapter, passage.endChapter]);

  const sectionRanges = useMemo(() => {
    // Start with book-wide breaks, excluding chapters covered by the passage (live state overrides)
    const allBreaks: { wordId: string; level: number; chapter: number; verse: number; extendedThrough: number | null }[] =
      bookSceneBreaks
        .filter((b) => !passageChapterSet.has(b.chapter))
        .map((b) => ({ ...b }));

    // Add passage breaks from live sceneBreakMap state
    for (const [wordId, arr] of sceneBreakMap) {
      const ch = wordToChapter.get(wordId) ?? passage.startChapter;
      for (const br of arr) {
        allBreaks.push({ wordId, level: br.level, chapter: ch, verse: br.verse, extendedThrough: null });
      }
    }

    return computeSectionRanges(allBreaks, bookMaxVerses, osisBook);
  }, [sceneBreakMap, bookSceneBreaks, bookMaxVerses, wordToChapter, passage.startChapter, passage.endChapter, osisBook, passageChapterSet]);

  // ── Verse groups keyed by "chapter:verse" (for speech section handler) ────
  const chapterVerseGroups = useMemo(() => {
    const map = new Map<string, Word[]>();
    for (const w of words) {
      const key = `${w.chapter}:${w.verse}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return map;
  }, [words]);

  // ── Ordered verse list for rendering & prev/next lookups ─────────────────
  const orderedVerses = useMemo(() => {
    const byChapter = new Map<number, Map<number, Word[]>>();
    for (const w of words) {
      if (!byChapter.has(w.chapter)) byChapter.set(w.chapter, new Map());
      const byVerse = byChapter.get(w.chapter)!;
      if (!byVerse.has(w.verse)) byVerse.set(w.verse, []);
      byVerse.get(w.verse)!.push(w);
    }
    const result: { ch: number; v: number; words: Word[] }[] = [];
    for (const [ch, byVerse] of [...byChapter.entries()].sort(([a], [b]) => a - b))
      for (const [v, vWords] of [...byVerse.entries()].sort(([a], [b]) => a - b))
        result.push({ ch, v, words: vWords });
    return result;
  }, [words]);

  // Whether this passage actually spans multiple chapters
  const isMultiChapter = orderedVerses.length > 0 &&
    orderedVerses[orderedVerses.length - 1].ch !== orderedVerses[0].ch;

  // ── Character map ─────────────────────────────────────────────────────────
  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  // ── wordId → SpeechSection ────────────────────────────────────────────────
  const wordSpeechMap = useMemo<Map<string, SpeechSection>>(() => {
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));
    const result = new Map<string, SpeechSection>();
    for (const section of speechSections) {
      const si = posMap.get(section.startWordId) ?? -1;
      const ei = posMap.get(section.endWordId)   ?? -1;
      if (si < 0 || ei < 0) continue;
      for (let i = si; i <= ei; i++) result.set(words[i].wordId, section);
    }
    return result;
  }, [words, speechSections]);

  // ── wordToParaStart ───────────────────────────────────────────────────────
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

  // First word ID of every paragraph segment (for clause relationship selectors).
  // Includes: passage start (i=0), explicit ¶ breaks, and the first word of every verse
  // so that the implicit "first paragraph" within each verse always has a selector dot.
  const paragraphFirstWordIds = useMemo(() => {
    if (!words.length) return [];
    const breakSet = new Set(paragraphBreakIds);
    return words
      .filter((w, i) =>
        i === 0 ||
        breakSet.has(w.wordId) ||
        words[i - 1].verse !== w.verse
      )
      .map((w) => w.wordId);
  }, [words, paragraphBreakIds]);

  // ── Annotation segment map ────────────────────────────────────────────────
  type SegAnnotationEntry = { annotation: LineAnnotation; isStart: boolean; isEnd: boolean };
  const annotationsBySegment = useMemo<Map<string, SegAnnotationEntry[]>>(() => {
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const map = new Map<string, SegAnnotationEntry[]>();
    for (const ann of lineAnnotationsState) {
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
  }, [lineAnnotationsState, paragraphFirstWordIds]);

  const themeColorsByLabel = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const ann of lineAnnotationsState) {
      if (ann.annotType === "theme" && !map.has(ann.label)) {
        map.set(ann.label, ann.color);
      }
    }
    return map;
  }, [lineAnnotationsState]);

  // ── Translation verse data ────────────────────────────────────────────────
  const activeTranslationIds = useMemo(
    () => new Set(
      availableTranslations
        .filter((t) => activeTranslationAbbrs.has(t.abbreviation))
        .map((t) => t.id)
    ),
    [activeTranslationAbbrs, availableTranslations]
  );

  // keyed by "chapter:verse" to avoid collisions in multi-chapter passages
  const activeTranslationVerseMap = useMemo(() => {
    const map = new Map<string, TranslationTextEntry[]>();
    for (const t of availableTranslations) {
      if (!activeTranslationIds.has(t.id)) continue;
      for (const tv of localTranslationVerseData[t.id] ?? []) {
        const key = `${tv.chapter}:${tv.verse}`;
        const existing = map.get(key) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text });
        map.set(key, existing);
      }
    }
    return map;
  }, [activeTranslationIds, availableTranslations, localTranslationVerseData]);

  const hasActiveTranslations = activeTranslationIds.size > 0;

  function toggleTranslation(id: number) {
    const abbr = availableTranslations.find((t) => t.id === id)?.abbreviation;
    if (!abbr) return;
    setActiveTranslationAbbrs((prev) => {
      const next = new Set(prev);
      if (next.has(abbr)) next.delete(abbr);
      else next.add(abbr);
      writeLocal("structura:activeTranslations", [...next]);
      return next;
    });
  }

  function adjustFontSize(target: "source" | "translation", delta: number) {
    if (target === "source") {
      const key = isHebrew ? "structura:hebrewFontSize" : "structura:greekFontSize";
      const setter = isHebrew ? setHebrewFontSize : setGreekFontSize;
      setter((prev) => {
        const next = Math.min(2.5, Math.max(0.875, Math.round((prev + delta) * 1000) / 1000));
        writeLocal(key, next);
        return next;
      });
    } else {
      setTranslationFontSize((prev) => {
        const next = Math.min(1.5, Math.max(0.625, Math.round((prev + delta) * 1000) / 1000));
        writeLocal("structura:translationFontSize", next);
        return next;
      });
    }
  }

  // ── Range control logic ───────────────────────────────────────────────────
  const { startChapter, startVerse, endChapter, endVerse } = passage;

  const canExtendStart  = !(startChapter === 1 && startVerse === 1);
  const canShrinkStart  = startChapter < endChapter || startVerse < endVerse;
  const canShrinkEnd    = startChapter < endChapter || startVerse < endVerse;
  const canExtendEnd    = !(endChapter === chapterCount && endVerse >= maxVerseOfEndChapter);

  async function applyRange(
    updates: Partial<Pick<Passage, "startChapter" | "startVerse" | "endChapter" | "endVerse">>
  ) {
    const next = { ...passage, ...updates };
    setPassage(next);
    try {
      await fetch(`/api/passages/${passage.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      startTransition(() => router.refresh());
    } catch {
      setPassage(passage);
    }
  }

  function handleExtendStart() {
    if (!canExtendStart || isPending) return;
    if (startVerse > 1) {
      applyRange({ startVerse: startVerse - 1 });
    } else {
      applyRange({ startChapter: startChapter - 1, startVerse: maxVerseOfPrevStartChapter || 1 });
    }
  }

  function handleShrinkStart() {
    if (!canShrinkStart || isPending) return;
    if (startVerse < maxVerseOfStartChapter) {
      applyRange({ startVerse: startVerse + 1 });
    } else {
      applyRange({ startChapter: startChapter + 1, startVerse: 1 });
    }
  }

  function handleShrinkEnd() {
    if (!canShrinkEnd || isPending) return;
    if (endVerse > 1) {
      applyRange({ endVerse: endVerse - 1 });
    } else {
      applyRange({ endChapter: endChapter - 1, endVerse: maxVerseOfPrevEndChapter || 1 });
    }
  }

  function handleExtendEnd() {
    if (!canExtendEnd || isPending) return;
    if (endVerse < maxVerseOfEndChapter) {
      applyRange({ endVerse: endVerse + 1 });
    } else {
      applyRange({ endChapter: endChapter + 1, endVerse: 1 });
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    await fetch(`/api/passages/${passage.id}`, { method: "DELETE" });
    router.push(`/${encodeURIComponent(osisBook)}/${textSource}/${passage.startChapter}`);
  }

  // ── Reference formatting ──────────────────────────────────────────────────
  const rangeLabel =
    startChapter === endChapter
      ? `${bookName} ${startChapter}:${startVerse}–${endVerse}`
      : `${bookName} ${startChapter}:${startVerse} – ${endChapter}:${endVerse}`;

  // ── Word selection dispatcher ─────────────────────────────────────────────
  function handleSelectWord(word: Word, shiftHeld = false) {
    if (editingArrows) { handleSelectArrowWord(word); return; }
    if (editingParagraphs) { handleToggleParagraphBreak(word.wordId); return; }
    if (editingBold || editingItalic) { handleToggleWordFormatting(word); return; }
    if (editingRefs) { if (activeCharId === null) return; handleToggleCharacterRef(word); return; }
    if (editingSpeech) { if (activeCharId === null) return; handleToggleSpeechSection(word, shiftHeld); return; }
    if (editingWordTags) { handleToggleWordTagRef(word); return; }
    if (editingScenes) {
      const existing = sceneBreakMap.get(word.wordId) ?? [];
      if (existing.length === 0) {
        handleToggleSceneBreak(word.wordId, 1, word.verse);
      } else {
        const existingLevels = new Set(existing.map((b) => b.level));
        let nextLevel = existingLevels.has(1) ? 2 : 1;
        while (existingLevels.has(nextLevel) && nextLevel <= 6) nextLevel++;
        if (nextLevel <= 6) handleToggleSceneBreak(word.wordId, nextLevel, word.verse);
      }
      return;
    }
    setSelectedWord(word);
    setPanelOpen(true);
  }

  // ── Paragraph break handlers ──────────────────────────────────────────────
  async function handleToggleParagraphBreakById(wordId: string, source: string, record = true) {
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;
    if (record) {
      const wasSet = paragraphBreakIds.has(wordId);
      pushUndo({
        label: wasSet ? "Remove ¶" : "Add ¶",
        undo: () => handleToggleParagraphBreakById(wordId, source, false),
      });
    }
    setParagraphBreakIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
    try {
      await fetch("/api/paragraph-breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book: osisBook, chapter: wordChapter, source }),
      });
    } catch {
      setParagraphBreakIds((prev) => {
        const next = new Set(prev);
        if (next.has(wordId)) next.delete(wordId);
        else next.add(wordId);
        return next;
      });
    }
  }

  function handleToggleParagraphBreak(wordId: string) {
    return handleToggleParagraphBreakById(wordId, textSource);
  }

  function handleToggleTranslationParagraphBreak(wordId: string, abbr: string) {
    return handleToggleParagraphBreakById(wordId, abbr);
  }

  // ── Character ref handlers ────────────────────────────────────────────────
  async function handleToggleCharacterRefById(wordId: string, source: string) {
    if (activeCharId === null) return;
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;

    const beforeRef = characterRefMap.get(wordId) ?? null;
    pushUndo({
      label: "Character ref",
      undo: async () => {
        setCharacterRefMap((prev) => {
          const next = new Map(prev);
          if (beforeRef === null) next.delete(wordId);
          else next.set(wordId, beforeRef);
          return next;
        });
        try {
          if (beforeRef === null) {
            await fetch("/api/character-refs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ wordId, character1Id: null, book: osisBook, chapter: wordChapter, source }),
            });
          } else {
            await fetch("/api/character-refs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                wordId,
                character1Id: beforeRef.character1Id,
                character2Id: beforeRef.character2Id ?? null,
                book: osisBook, chapter: wordChapter, source,
              }),
            });
          }
        } catch { /* best effort */ }
      },
    });

    const existing = characterRefMap.get(wordId);
    let nextRef: CharacterRef | null = null;
    let shouldRemove = false;

    if (!existing) {
      nextRef = { id: -1, wordId, character1Id: activeCharId, character2Id: null, textSource: source, book: osisBook, chapter: wordChapter };
    } else if (existing.character1Id === activeCharId) {
      if (existing.character2Id !== null) {
        nextRef = { ...existing, character1Id: existing.character2Id, character2Id: null };
      } else {
        shouldRemove = true;
      }
    } else if (existing.character2Id === activeCharId) {
      nextRef = { ...existing, character2Id: null };
    } else if (existing.character2Id === null) {
      nextRef = { ...existing, character2Id: activeCharId };
    } else {
      nextRef = { ...existing, character1Id: activeCharId };
    }

    setCharacterRefMap((prev) => {
      const next = new Map(prev);
      if (shouldRemove) next.delete(wordId);
      else if (nextRef) next.set(wordId, nextRef);
      return next;
    });

    const prevRefMap = new Map(characterRefMap);
    try {
      if (shouldRemove) {
        await fetch("/api/character-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, character1Id: null, book: osisBook, chapter: wordChapter, source }),
        });
      } else if (nextRef) {
        await fetch("/api/character-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wordId,
            character1Id: nextRef.character1Id,
            character2Id: nextRef.character2Id,
            book: osisBook, chapter: wordChapter, source,
          }),
        });
      }
    } catch {
      setCharacterRefMap(prevRefMap);
    }
  }

  function handleToggleCharacterRef(word: Word) {
    if (isPunctuationWord(word)) return;
    return handleToggleCharacterRefById(word.wordId, textSource);
  }

  function handleSelectTranslationWord(wordId: string, abbr: string) {
    if (editingBold || editingItalic) {
      handleToggleFormattingById(wordId, abbr);
      return;
    }
    if (editingRefs && activeCharId !== null) {
      handleToggleCharacterRefById(wordId, abbr);
    } else if (editingWordTags && activeWordTagId !== null && !pendingWordTag) {
      handleToggleWordTagRefById(wordId, abbr);
    }
  }

  // ── Word tag handlers ─────────────────────────────────────────────────────
  async function handleToggleWordTagRefById(wordId: string, source: string) {
    if (activeWordTagId === null) return;
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;
    const existing = wordTagRefMap.get(wordId);
    const isRemove = existing?.tagId === activeWordTagId;

    setWordTagRefMap((prev) => {
      const next = new Map(prev);
      if (isRemove) next.delete(wordId);
      else next.set(wordId, { id: -1, wordId, tagId: activeWordTagId!, textSource: source, book: osisBook, chapter: wordChapter });
      return next;
    });

    try {
      await fetch("/api/word-tag-refs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, tagId: isRemove ? null : activeWordTagId, book: osisBook, chapter: wordChapter, source }),
      });
    } catch {
      setWordTagRefMap((prev) => {
        const next = new Map(prev);
        if (existing) next.set(wordId, existing);
        else next.delete(wordId);
        return next;
      });
    }
  }

  async function handleToggleWordTagRef(word: Word) {
    if (isPunctuationWord(word)) return;
    const wordChapter = wordToChapter.get(word.wordId) ?? passage.startChapter;
    if (pendingWordTag && pendingWordTagColor !== null) {
      const lemma = word.language === "hebrew"
        ? ((hebrewLemmas as Record<string, string>)[word.strongNumber ?? ""]
            ?? word.surfaceText?.replace(/\//g, "")
            ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      await handleCreateTag("word", lemma, pendingWordTagColor, word.wordId, textSource, wordChapter);
      setPendingWordTag(false);
      setPendingWordTagColor(null);
      return;
    }
    if (activeWordTagId === null) return;
    await handleToggleWordTagRefById(word.wordId, textSource);
  }

  async function handleCreateTag(
    type: "word" | "concept",
    name: string,
    color: string,
    firstWordId?: string,
    firstWordSource?: string,
    firstWordChapter?: number
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book: osisBook, name, color, type,
      createdAt: new Date().toISOString(),
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, type, book: osisBook }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

      if (firstWordId && firstWordSource) {
        const chap = firstWordChapter ?? passage.startChapter;
        const ref: WordTagRef = {
          id: -1, wordId: firstWordId, tagId: realTag.id,
          textSource: firstWordSource, book: osisBook, chapter: chap,
        };
        setWordTagRefMap((prev) => new Map(prev).set(firstWordId, ref));
        await fetch("/api/word-tag-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: firstWordId, tagId: realTag.id, book: osisBook, chapter: chap, source: firstWordSource }),
        });
      }
    } catch {
      setWordTags((prev) => prev.filter((t) => t.id !== tempTag.id));
      setActiveWordTagId(wordTags[0]?.id ?? null);
    }
  }

  function handleCreateConceptTag(name: string, color: string) {
    return handleCreateTag("concept", name, color);
  }

  function handleCreatePendingWordTag(color: string) {
    setPendingWordTag(true);
    setPendingWordTagColor(color);
  }

  async function handleDeleteWordTag(id: number) {
    const prevTags = wordTags;
    setWordTags((prev) => prev.filter((t) => t.id !== id));
    setWordTagRefMap((prev) => {
      const next = new Map(prev);
      for (const [wid, ref] of next) {
        if (ref.tagId === id) next.delete(wid);
      }
      return next;
    });
    if (activeWordTagId === id) {
      setActiveWordTagId(wordTags.find((t) => t.id !== id)?.id ?? null);
    }
    try {
      await fetch(`/api/word-tags/${id}`, { method: "DELETE" });
    } catch {
      setWordTags(prevTags);
    }
  }

  async function handleUpdateWordTag(id: number, name: string, color: string) {
    const prev = wordTags.find((t) => t.id === id);
    setWordTags((ts) => ts.map((t) => t.id === id ? { ...t, name, color } : t));
    try {
      await fetch(`/api/word-tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
    } catch {
      if (prev) setWordTags((ts) => ts.map((t) => t.id === id ? prev : t));
    }
  }

  function handleToggleWordTagHighlight(id: number) {
    setHighlightWordTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Speech section handlers ───────────────────────────────────────────────
  async function handleReassignSpeechSection(sectionId: number, newCharId: number) {
    const section = speechSections.find((s) => s.id === sectionId);
    if (!section || section.characterId === newCharId) return;

    const beforeSections = [...speechSections];
    pushUndo({
      label: "Reassign speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: osisBook, chapter: section.chapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    setSpeechSections((prev) =>
      prev.map((s) => s.id === sectionId ? { ...s, characterId: newCharId } : s)
    );
    try {
      const res = await fetch("/api/speech-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, characterId: newCharId, book: osisBook, chapter: section.chapter, source: textSource }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  async function handleDeleteSpeechSection(sectionId: number) {
    const section = speechSections.find((s) => s.id === sectionId);
    if (!section) return;
    const beforeSections = [...speechSections];
    pushUndo({
      label: "Delete speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: osisBook, chapter: section.chapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });
    setSpeechSections((prev) => prev.filter((s) => s.id !== sectionId));
    try {
      const res = await fetch("/api/speech-sections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: section.startWordId, book: osisBook, chapter: section.chapter, source: textSource }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  async function handleToggleSpeechSection(word: Word, _shiftHeld = false) {
    if (activeCharId === null) return;

    const cvKey = `${word.chapter}:${word.verse}`;
    const splitIntoSegments = (vWords: Word[]): Word[][] => {
      const segs: Word[][] = [];
      let cur: Word[] = [];
      vWords.forEach((w, i) => {
        if (i > 0 && paragraphBreakIds.has(w.wordId)) { segs.push(cur); cur = []; }
        cur.push(w);
      });
      if (cur.length > 0) segs.push(cur);
      return segs;
    };
    const findSeg = (wId: string, vWords: Word[]): Word[] =>
      splitIntoSegments(vWords).find(s => s.some(w => w.wordId === wId)) ?? vWords.slice(0, 1);

    const clickedVerseWords = chapterVerseGroups.get(cvKey) ?? [word];
    const clickedSeg = findSeg(word.wordId, clickedVerseWords);

    if (!speechRangeStart) {
      setSpeechRangeStart(clickedSeg[0]);
      return;
    }

    const startCvKey = `${speechRangeStart.chapter}:${speechRangeStart.verse}`;
    const startVerseWords = chapterVerseGroups.get(startCvKey) ?? [speechRangeStart];
    const startSeg = findSeg(speechRangeStart.wordId, startVerseWords);
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));
    const sp = posMap.get(startSeg[0].wordId) ?? 0;
    const ep = posMap.get(clickedSeg[0].wordId) ?? 0;

    let orderedStart: string;
    let orderedEnd: string;
    if (sp <= ep) {
      orderedStart = startSeg[0].wordId;
      orderedEnd   = clickedSeg[clickedSeg.length - 1].wordId;
    } else {
      orderedStart = clickedSeg[0].wordId;
      orderedEnd   = startSeg[startSeg.length - 1].wordId;
    }
    setSpeechRangeStart(null);

    // Use the chapter of the start word for the API call
    const sectionChapter = wordToChapter.get(orderedStart) ?? passage.startChapter;

    const beforeSections = [...speechSections];
    pushUndo({
      label: "Add speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: osisBook, chapter: sectionChapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    const tempSection: SpeechSection = {
      id: Date.now(), characterId: activeCharId,
      startWordId: orderedStart, endWordId: orderedEnd,
      textSource, book: osisBook, chapter: sectionChapter,
    };
    setSpeechSections((prev) => [...prev, tempSection]);

    try {
      const res = await fetch("/api/speech-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: activeCharId,
          startWordId: orderedStart,
          endWordId: orderedEnd,
          book: osisBook, chapter: sectionChapter, source: textSource,
        }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  // ── Character management ──────────────────────────────────────────────────
  async function handleCreateCharacter(name: string, color: string) {
    const tempChar: Character = {
      id: -(Date.now()), book: osisBook, name, color,
      createdAt: new Date().toISOString(),
    };
    setCharacters((prev) => [...prev, tempChar]);
    setActiveCharId(tempChar.id);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, book: osisBook }),
      });
      const data = await res.json();
      setCharacters((prev) => prev.map((c) => c.id === tempChar.id ? data.character : c));
      setActiveCharId(data.character.id);
    } catch {
      setCharacters((prev) => prev.filter((c) => c.id !== tempChar.id));
      setActiveCharId(characters[0]?.id ?? null);
    }
  }

  async function handleDeleteCharacter(id: number) {
    const prevChars = characters;
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setCharacterRefMap((prev) => {
      const next = new Map(prev);
      for (const [wid, ref] of next) {
        if (ref.character1Id === id) {
          if (ref.character2Id !== null) {
            next.set(wid, { ...ref, character1Id: ref.character2Id, character2Id: null });
          } else {
            next.delete(wid);
          }
        } else if (ref.character2Id === id) {
          next.set(wid, { ...ref, character2Id: null });
        }
      }
      return next;
    });
    setSpeechSections((prev) => prev.filter((s) => s.characterId !== id));
    if (activeCharId === id) {
      setActiveCharId(characters.find((c) => c.id !== id)?.id ?? null);
    }
    try {
      await fetch(`/api/characters/${id}`, { method: "DELETE" });
    } catch {
      setCharacters(prevChars);
    }
  }

  function handleToggleHighlight(id: number) {
    setHighlightCharIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleUpdateCharacter(id: number, name: string, color: string) {
    const prev = characters.find((c) => c.id === id);
    if (prev) {
      const prevName = prev.name;
      const prevColor = prev.color;
      pushUndo({
        label: `Rename "${prev.name}"`,
        undo: async () => {
          setCharacters((cs) => cs.map((c) => c.id === id ? { ...c, name: prevName, color: prevColor } : c));
          try {
            await fetch(`/api/characters/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: prevName, color: prevColor }),
            });
          } catch { /* best effort */ }
        },
      });
    }
    setCharacters((cs) => cs.map((c) => c.id === id ? { ...c, name, color } : c));
    try {
      await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
    } catch {
      if (prev) setCharacters((cs) => cs.map((c) => c.id === id ? prev : c));
    }
  }

  // ── Indent handlers ────────────────────────────────────────────────────────
  async function handleSetIndent(paraStartWordId: string, level: number) {
    const wordChapter = wordToChapter.get(paraStartWordId) ?? passage.startChapter;
    const prevLevel = lineIndentMap.get(paraStartWordId) ?? 0;
    const prevTvLevel = tvLineIndentMap.get(paraStartWordId) ?? 0;
    setLineIndentMap((prev) => {
      const next = new Map(prev);
      if (level <= 0) next.delete(paraStartWordId);
      else next.set(paraStartWordId, level);
      return next;
    });
    if (indentsLinked) {
      setTvLineIndentMap((prev) => {
        const next = new Map(prev);
        if (level <= 0) next.delete(paraStartWordId);
        else next.set(paraStartWordId, level);
        return next;
      });
    }
    try {
      await fetch("/api/line-indents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: paraStartWordId, indentLevel: level, textSource, book: osisBook, chapter: wordChapter }),
      });
      if (indentsLinked) {
        await fetch("/api/line-indents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book: osisBook, chapter: wordChapter }),
        });
      }
    } catch {
      setLineIndentMap((prev) => {
        const next = new Map(prev);
        if (prevLevel <= 0) next.delete(paraStartWordId);
        else next.set(paraStartWordId, prevLevel);
        return next;
      });
      if (indentsLinked) {
        setTvLineIndentMap((prev) => {
          const next = new Map(prev);
          if (prevTvLevel <= 0) next.delete(paraStartWordId);
          else next.set(paraStartWordId, prevTvLevel);
          return next;
        });
      }
    }
  }

  async function handleSetTvIndent(paraStartWordId: string, level: number) {
    const wordChapter = wordToChapter.get(paraStartWordId) ?? passage.startChapter;
    const prevLevel = tvLineIndentMap.get(paraStartWordId) ?? 0;
    setTvLineIndentMap((prev) => {
      const next = new Map(prev);
      if (level <= 0) next.delete(paraStartWordId);
      else next.set(paraStartWordId, level);
      return next;
    });
    try {
      await fetch("/api/line-indents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book: osisBook, chapter: wordChapter }),
      });
    } catch {
      setTvLineIndentMap((prev) => {
        const next = new Map(prev);
        if (prevLevel <= 0) next.delete(paraStartWordId);
        else next.set(paraStartWordId, prevLevel);
        return next;
      });
    }
  }

  // ── RST relation handlers ─────────────────────────────────────────────────
  function handleSelectRstSegment(wordId: string) {
    if (!rstSegA) {
      setRstSegA(wordId);
    } else if (wordId === rstSegA) {
      setRstSegA(null);
    } else {
      setRstSegB(wordId);
      setShowRstPicker(true);
    }
  }

  async function handleCreateRstRelation(relType: string) {
    if (!rstSegA || !rstSegB) return;
    const relMeta  = RELATIONSHIP_MAP[relType];
    const category = relMeta?.category ?? "subordinate";
    const isCoord  = category === "coordinate";

    let members: { segWordId: string; role: "nucleus" | "satellite"; sortOrder: number }[];
    if (isCoord) {
      const existingGroup = rstRelations.find(
        (r) => r.segWordId === rstSegA && r.relType === relType && r.role === "nucleus"
      );
      if (existingGroup) {
        const groupId = existingGroup.groupId;
        const maxOrder = rstRelations
          .filter((r) => r.groupId === groupId)
          .reduce((m, r) => Math.max(m, r.sortOrder), 0);
        const ch = wordToChapter.get(rstSegA) ?? passage.startChapter;
        const resp = await fetch("/api/rst-relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupId,
            members: [{ segWordId: rstSegB, role: "nucleus", sortOrder: maxOrder + 1 }],
            relType,
            book: osisBook,
            chapter: ch,
            source: textSource,
          }),
        });
        const { relations: newRels } = await resp.json();
        setRstRelations((prev) => [...prev, ...newRels]);
        setRstSegB(null);
        setShowRstPicker(false);
        return;
      }
      members = [
        { segWordId: rstSegA, role: "nucleus", sortOrder: 0 },
        { segWordId: rstSegB, role: "nucleus", sortOrder: 1 },
      ];
    } else {
      const nucleusId   = rstRolesSwapped ? rstSegB : rstSegA;
      const satelliteId = rstRolesSwapped ? rstSegA : rstSegB;
      members = [
        { segWordId: nucleusId,   role: "nucleus",   sortOrder: 0 },
        { segWordId: satelliteId, role: "satellite",  sortOrder: 1 },
      ];
    }

    const ch = wordToChapter.get(rstSegA) ?? passage.startChapter;
    const groupId = crypto.randomUUID();
    const resp = await fetch("/api/rst-relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, members, relType, book: osisBook, chapter: ch, source: textSource }),
    });
    const { relations: newRels } = await resp.json();
    setRstRelations((prev) => [...prev, ...newRels]);
    setRstSegB(null);
    setShowRstPicker(false);
  }

  function handleCancelRstPicker() {
    setShowRstPicker(false);
    setRstSegB(null);
  }

  async function handleDeleteRstGroup(groupId: string) {
    await fetch("/api/rst-relations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    setRstRelations((prev) => prev.filter((r) => r.groupId !== groupId));
  }

  // ── Word arrow handlers ────────────────────────────────────────────────────
  // Works with any wordId — source words or translation tokens ("tv:ESV:Gen.1.1.0").
  // For translation tokens, chapter is parsed from the ID; for source words, look up
  // wordToChapter. Falls back to passage.startChapter if neither resolves.
  async function handleSelectArrowWordById(wordId: string) {
    if (!arrowFromWordId) {
      setArrowFromWordId(wordId);
      return;
    }
    if (arrowFromWordId === wordId) {
      setArrowFromWordId(null);
      return;
    }
    // Resolve chapter for the "from" word. Translation token IDs have the form
    // "tv:<abbr>:<book>.<chapter>.<verse>.<wi>", so parse chapter from there.
    let ch = wordToChapter.get(arrowFromWordId);
    if (ch === undefined && arrowFromWordId.startsWith("tv:")) {
      const dotParts = arrowFromWordId.split(":")[2]?.split(".");
      const parsed = dotParts ? parseInt(dotParts[1]) : NaN;
      ch = isNaN(parsed) ? passage.startChapter : parsed;
    }
    ch = ch ?? passage.startChapter;

    const resp = await fetch("/api/word-arrows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWordId: arrowFromWordId,
        toWordId:   wordId,
        book: osisBook,
        chapter: ch,
        source: textSource,
      }),
    });
    const { arrow } = await resp.json();
    setWordArrowsState((prev) => [...prev, arrow]);
    setArrowFromWordId(null);
  }

  function handleSelectArrowWord(word: Word) {
    handleSelectArrowWordById(word.wordId);
  }

  async function handleDeleteWordArrow(id: number) {
    await fetch("/api/word-arrows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setWordArrowsState((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Clear annotations handler ─────────────────────────────────────────────

  function handleAnnotationsCleared(cleared: ClearCategory[]) {
    for (const cat of cleared) {
      switch (cat) {
        case "paragraphBreaks":    setParagraphBreakIds(new Set()); break;
        case "characterRefs":      setCharacterRefMap(new Map()); break;
        case "speechSections":     setSpeechSections([]); break;
        case "wordTagRefs":        setWordTagRefMap(new Map()); break;
        case "lineIndents":        setLineIndentMap(new Map()); break;
        case "wordArrows":         setWordArrowsState([]); break;
        case "rstRelations":        setRstRelations([]); break;
        case "wordFormatting":     setWordFormattingMap(new Map()); break;
      }
    }
  }

  // ── Section break handlers ───────────────────────────────────────────────────

  async function handleToggleSceneBreak(wordId: string, level: number, verse: number, record = true) {
    const existingArr = sceneBreakMap.get(wordId) ?? [];
    const wasSet = existingArr.some((b) => b.level === level);
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;
    if (record) {
      pushUndo({
        label: wasSet ? "Remove section break" : "Add section break",
        undo: () => handleToggleSceneBreak(wordId, level, verse, false),
      });
    }
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = [...(prev.get(wordId) ?? [])];
      if (wasSet) {
        const filtered = arr.filter((b) => b.level !== level);
        if (filtered.length === 0) next.delete(wordId);
        else next.set(wordId, filtered);
      } else {
        arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null });
        arr.sort((a, b) => a.level - b.level);
        next.set(wordId, arr);
      }
      return next;
    });
    if (!wasSet) {
      setParagraphBreakIds((prev) => { const next = new Set(prev); next.add(wordId); return next; });
    } else if (existingArr.length === 1) {
      setParagraphBreakIds((prev) => { const next = new Set(prev); next.delete(wordId); return next; });
    }
    try {
      await fetch("/api/scene-breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book: osisBook, chapter: wordChapter, verse, source: textSource, level }),
      });
    } catch {
      setSceneBreakMap((prev) => {
        const next = new Map(prev);
        if (wasSet) {
          const arr = [...(prev.get(wordId) ?? [])];
          arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null });
          arr.sort((a, b) => a.level - b.level);
          next.set(wordId, arr);
        } else {
          const filtered = (prev.get(wordId) ?? []).filter((b) => b.level !== level);
          if (filtered.length === 0) next.delete(wordId);
          else next.set(wordId, filtered);
        }
        return next;
      });
      if (!wasSet) {
        setParagraphBreakIds((prev) => { const next = new Set(prev); next.delete(wordId); return next; });
      } else if (existingArr.length === 1) {
        setParagraphBreakIds((prev) => { const next = new Set(prev); next.add(wordId); return next; });
      }
    }
  }

  async function handleUpdateSceneHeading(wordId: string, level: number, heading: string) {
    const trimmed = heading.trim() || null;
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, heading: trimmed } : b
      );
      next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, heading: trimmed }),
      });
    } catch { /* non-critical */ }
  }

  async function handleUpdateSceneOutOfSequence(wordId: string, level: number, outOfSequence: boolean) {
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, outOfSequence } : b
      );
      next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, outOfSequence }),
      });
    } catch { /* non-critical */ }
  }

  async function handleUpdateSceneExtendedThrough(wordId: string, level: number, extendedThrough: number | null) {
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, extendedThrough } : b
      );
      next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, extendedThrough }),
      });
    } catch { /* non-critical */ }
  }

  // ── Line annotation handlers ───────────────────────────────────────────────

  function handleSelectAnnotationSegment(segWordId: string, shiftHeld = false) {
    if (annotRangeEnd !== null) {
      if (shiftHeld) {
        setAnnotRangeEnd(segWordId);
      } else {
        setAnnotRangeStart(segWordId);
        setAnnotRangeEnd(null);
      }
      return;
    }
    if (!annotRangeStart) {
      setAnnotRangeStart(segWordId);
      return;
    }
    setAnnotRangeEnd(segWordId);
  }

  function handleCancelAnnotation() {
    setAnnotRangeStart(null);
    setAnnotRangeEnd(null);
  }

  async function handleSaveAnnotation(data: {
    annotType: string;
    label: string;
    color: string;
    description: string | null;
    outOfSequence: boolean;
  }) {
    if (!annotRangeStart) return;
    const endWordId = annotRangeEnd ?? annotRangeStart;
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const startPos = posMap.get(annotRangeStart) ?? 0;
    const endPos   = posMap.get(endWordId) ?? 0;
    const lo = segIds[Math.min(startPos, endPos)] ?? annotRangeStart;
    const hi = segIds[Math.max(startPos, endPos)] ?? endWordId;
    const wordChapter = wordToChapter.get(lo) ?? passage.startChapter;

    setAnnotRangeStart(null);
    setAnnotRangeEnd(null);

    try {
      const resp = await fetch("/api/line-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          startWordId: lo,
          endWordId:   hi,
          book:        osisBook,
          chapter:     wordChapter,
          source:      textSource,
        }),
      });
      const { annotation } = await resp.json();
      setLineAnnotationsState((prev) => [...prev, annotation]);
    } catch { /* non-critical */ }
  }

  async function handleDeleteAnnotation(id: number) {
    setLineAnnotationsState((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch("/api/line-annotations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch { /* non-critical */ }
  }

  async function handleUpdateAnnotation(
    id: number,
    updates: { label?: string; color?: string; description?: string | null; outOfSequence?: boolean }
  ) {
    setLineAnnotationsState((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
    try {
      await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
    } catch { /* non-critical */ }
  }

  async function handleExpandAnnotationRange(
    id: number,
    direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end"
  ) {
    const ann = lineAnnotationsState.find((a) => a.id === id);
    if (!ann) return;
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((seg, i) => [seg, i]));
    const startPos = posMap.get(ann.startWordId) ?? 0;
    const endPos   = posMap.get(ann.endWordId)   ?? startPos;

    let newStartPos = startPos;
    let newEndPos   = endPos;
    switch (direction) {
      case "expand-start": newStartPos = Math.max(0, startPos - 1); break;
      case "shrink-start": newStartPos = Math.min(startPos + 1, endPos); break;
      case "expand-end":   newEndPos   = Math.min(endPos + 1, segIds.length - 1); break;
      case "shrink-end":   newEndPos   = Math.max(endPos - 1, startPos); break;
    }
    if (newStartPos === startPos && newEndPos === endPos) return;

    const newStart = segIds[newStartPos];
    const newEnd   = segIds[newEndPos];
    if (!newStart || !newEnd) return;

    setLineAnnotationsState((prev) =>
      prev.map((a) => a.id === id ? { ...a, startWordId: newStart, endWordId: newEnd } : a)
    );
    try {
      await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startWordId: newStart, endWordId: newEnd }),
      });
    } catch {
      setLineAnnotationsState((prev) =>
        prev.map((a) => a.id === id ? { ...a, startWordId: ann.startWordId, endWordId: ann.endWordId } : a)
      );
    }
  }

  // ── Word formatting (bold / italic) handlers ───────────────────────────────

  async function handleToggleFormattingById(wordId: string, source: string) {
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;
    const existing = wordFormattingMap.get(wordId) ?? { isBold: false, isItalic: false };
    const nextBold   = editingBold   ? !existing.isBold   : existing.isBold;
    const nextItalic = editingItalic ? !existing.isItalic : existing.isItalic;

    setWordFormattingMap((prev) => {
      const next = new Map(prev);
      if (!nextBold && !nextItalic) next.delete(wordId);
      else next.set(wordId, { isBold: nextBold, isItalic: nextItalic });
      return next;
    });
    try {
      await fetch("/api/word-formatting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wordId, isBold: nextBold, isItalic: nextItalic,
          textSource: source, book: osisBook, chapter: wordChapter,
        }),
      });
    } catch {
      setWordFormattingMap((prev) => {
        const next = new Map(prev);
        if (!existing.isBold && !existing.isItalic) next.delete(wordId);
        else next.set(wordId, existing);
        return next;
      });
    }
  }

  async function handleToggleWordFormatting(word: Word) {
    return handleToggleFormattingById(word.wordId, textSource);
  }

  // ── Translation verse editing ──────────────────────────────────────────────
  async function handleUpdateTranslationVerse(abbr: string, verse: number, newText: string) {
    const translation = availableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);
    if (!tvRecord) return;
    setLocalTranslationVerseData((prev) => ({
      ...prev,
      [translation.id]: (prev[translation.id] ?? []).map((tv) =>
        tv.verse === verse ? { ...tv, text: newText } : tv
      ),
    }));
    try {
      await fetch("/api/translation-verses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tvRecord.id, text: newText }),
      });
    } catch {
      setLocalTranslationVerseData((prev) => ({
        ...prev,
        [translation.id]: (prev[translation.id] ?? []).map((tv) =>
          tv.verse === verse ? { ...tv, text: tvRecord.text } : tv
        ),
      }));
    }
  }

  // ── Export outline ────────────────────────────────────────────────────────
  function handleExportOutline() {
    const allBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number }[] = [];
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        const ch = wordToChapter.get(wordId) ?? passage.startChapter;
        allBreaks.push({ wordId, heading: br.heading, level: br.level, chapter: ch, verse: br.verse });
      }
    }
    allBreaks.sort((a, b) => a.chapter !== b.chapter ? a.chapter - b.chapter : a.verse !== b.verse ? a.verse - b.verse : a.level - b.level);
    const text = generateOutline(allBreaks, sectionRanges);
    downloadOutline(text, `${bookName}-outline.txt`);
  }

  // ── Shared range button helper ────────────────────────────────────────────
  function rangeBtn(disabled: boolean, label: string, title: string, onClick: () => void) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isPending}
        title={title}
        className={[
          "px-2 py-0.5 rounded text-xs font-mono transition-colors select-none",
          disabled || isPending
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-stone-200 dark:hover:bg-stone-700 cursor-pointer",
        ].join(" ")}
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </button>
    );
  }

  function refStr(chapter: number, verse: number) { return `${chapter}:${verse}`; }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      {/* Main content + toolbar */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0" ref={overlayContainerRef} style={{ position: "relative" }}>
        {/* Overlay: RST relation lines */}
        <RstRelationOverlay
          relations={rstRelations}
          containerRef={overlayContainerRef}
          isHebrew={isHebrew}
          editing={editingRst}
          paragraphFirstWordIds={paragraphFirstWordIds}
          selectedNucleusWordId={rstSegA}
          selectedSatelliteWordId={rstSegB}
          onSelectSegment={handleSelectRstSegment}
          onDeleteGroup={handleDeleteRstGroup}
        />
        {/* Overlay: word-to-word arrows */}
        <WordArrowOverlay
          arrows={wordArrowsState}
          containerRef={overlayContainerRef}
          editing={editingArrows}
          selectedFromWordId={arrowFromWordId}
          onDeleteArrow={handleDeleteWordArrow}
        />

        {/* ── Passage header ──────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)" }}>

          {/* Header row: range label + outline export + delete */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-lg font-bold flex-1" style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}>
              {rangeLabel}
            </span>

            {/* Export outline */}
            {sceneBreakMap.size > 0 && (
              <button
                type="button"
                onClick={handleExportOutline}
                className="shrink-0 text-xs px-2 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="Export section break outline as .txt"
              >
                📋 Outline
              </button>
            )}

            {/* Delete */}
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Delete?</span>
                <button type="button" onClick={handleDelete}
                  className="text-xs px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors">
                  Yes
                </button>
                <button type="button" onClick={() => setShowDeleteConfirm(false)}
                  className="text-xs px-2 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                  style={{ color: "var(--text-muted)" }}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowDeleteConfirm(true)}
                className="shrink-0 text-xs px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                style={{ color: "var(--text-muted)" }} title="Delete this passage">
                🗑 Delete
              </button>
            )}
          </div>

          {isPending && <p className="text-xs mb-1 opacity-50" style={{ color: "var(--text-muted)" }}>updating…</p>}

          {/* New passage section break prompt */}
          {showNewPassagePrompt && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <span className="text-xs text-stone-600 dark:text-stone-300 shrink-0">Add section heading?</span>
              <span className="text-[10px] text-stone-400 mr-1 shrink-0">Level:</span>
              {([1,2,3,4,5,6] as const).map((l) => (
                <button key={l} type="button"
                  onClick={() => setNewPassageLevel(l)}
                  className={`text-[10px] px-1.5 h-5 rounded font-semibold transition-colors ${newPassageLevel === l ? "bg-amber-400 text-white" : "bg-stone-200 dark:bg-stone-700 text-stone-500 hover:bg-stone-300"}`}>
                  {l}
                </button>
              ))}
              <input
                value={newPassageHeading}
                onChange={(e) => setNewPassageHeading(e.target.value)}
                placeholder="Section label…"
                className="flex-1 min-w-0 text-xs bg-transparent border-b border-stone-300 dark:border-stone-600 outline-none px-0 py-0.5"
                style={{ color: "var(--foreground)" }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button type="button"
                className="shrink-0 text-xs px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                onClick={async () => {
                  const firstWord = words[0];
                  if (!firstWord) return;
                  await handleToggleSceneBreak(firstWord.wordId, newPassageLevel, firstWord.verse);
                  if (newPassageHeading.trim()) {
                    await handleUpdateSceneHeading(firstWord.wordId, newPassageLevel, newPassageHeading);
                  }
                  setShowNewPassagePrompt(false);
                  // Remove ?newPassage=true from URL without navigation
                  const url = new URL(window.location.href);
                  url.searchParams.delete("newPassage");
                  window.history.replaceState({}, "", url.toString());
                }}>
                Add
              </button>
              <button type="button"
                className="shrink-0 text-xs px-2 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                style={{ color: "var(--text-muted)" }}
                onClick={() => {
                  setShowNewPassagePrompt(false);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("newPassage");
                  window.history.replaceState({}, "", url.toString());
                }}>
                Skip
              </button>
            </div>
          )}

          {/* Range controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Start:</span>
              {rangeBtn(!canExtendStart, "← +1v", `Include ${startChapter === 1 && startVerse === 1 ? "(already at beginning)" : refStr(startVerse > 1 ? startChapter : startChapter - 1, startVerse > 1 ? startVerse - 1 : maxVerseOfPrevStartChapter)}`, handleExtendStart)}
              <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--foreground)" }}>
                {refStr(startChapter, startVerse)}
              </span>
              {rangeBtn(!canShrinkStart, "−1v →", `Exclude ${refStr(startChapter, startVerse)} (move start forward)`, handleShrinkStart)}
            </div>
            <span style={{ color: "var(--text-muted)" }}>–</span>
            <div className="flex items-center gap-1">
              {rangeBtn(!canShrinkEnd, "← −1v", `Exclude ${refStr(endChapter, endVerse)} (move end back)`, handleShrinkEnd)}
              <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--foreground)" }}>
                {refStr(endChapter, endVerse)}
              </span>
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>End:</span>
              {rangeBtn(!canExtendEnd, "+1v →", `Include ${endChapter === chapterCount && endVerse >= maxVerseOfEndChapter ? "(already at end)" : refStr(endVerse < maxVerseOfEndChapter ? endChapter : endChapter + 1, endVerse < maxVerseOfEndChapter ? endVerse + 1 : 1)}`, handleExtendEnd)}
            </div>
          </div>
        </div>

        {/* ── Sticky control area: toolbar + all editing panels/hints ─────── */}
        <div className="sticky top-0 z-20 shrink-0 flex flex-col" style={{ backgroundColor: "var(--background)" }}>

        {/* Toolbar */}
        <div className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4 flex-wrap">
          <DisplayModeToggle mode={displayMode} onChange={setDisplayMode} />
          {displayMode === "color" && (
            <>
              <GrammarFilter filter={grammarFilter} onChange={setGrammarFilter} />
              <ColorRulePanel rules={colorRules} onChange={setColorRules} isHebrew={isHebrew} />
            </>
          )}
          <button
            onClick={() => setShowTooltips((v) => !v)}
            title={showTooltips ? "Disable hover tooltips" : "Enable hover tooltips"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              showTooltips ? "bg-blue-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >Tooltips</button>

          {/* Paragraph edit mode */}
          <button
            onClick={() => setEditingParagraphs((v) => !v)}
            title={editingParagraphs ? "Exit paragraph edit mode" : "Enter paragraph edit mode — click any word to start/remove a paragraph there"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingParagraphs ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >¶</button>

          {/* Scene / episode break mode */}
          <button
            onClick={() => setEditingScenes((v) => !v)}
            title={editingScenes
              ? "Exit section break mode"
              : "Enter section break mode — click any word to start/remove a section break there"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingScenes ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >§</button>

          {/* Line annotation mode */}
          <button
            onClick={() => {
              setEditingAnnotations((v) => !v);
              setAnnotRangeStart(null);
              setAnnotRangeEnd(null);
            }}
            title={editingAnnotations
              ? "Exit annotation mode"
              : "Add plot/theme annotations to paragraph segments"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingAnnotations ? "bg-indigo-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >≡</button>

          {/* Character reference mode */}
          <button
            onClick={() => {
              setEditingRefs((v) => !v);
              setEditingSpeech(false); setEditingWordTags(false);
              setPendingWordTag(false); setSpeechRangeStart(null);
            }}
            title={editingRefs ? "Exit reference tagging" : "Tag words as referring to a character"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRefs ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >👤</button>

          {/* Speech section mode */}
          <button
            onClick={() => {
              setEditingSpeech((v) => !v);
              setEditingRefs(false); setEditingWordTags(false);
              setPendingWordTag(false); setSpeechRangeStart(null);
            }}
            title={editingSpeech ? "Exit speech tagging" : "Mark word ranges as spoken by a character (two clicks: start then end)"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingSpeech ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >💬</button>

          {/* Word/concept tag mode */}
          <button
            onClick={() => {
              setEditingWordTags((v) => !v);
              setEditingRefs(false); setEditingSpeech(false);
              setEditingIndents(false); setSpeechRangeStart(null);
              setPendingWordTag(false);
            }}
            title={editingWordTags ? "Exit word/concept tag mode" : "Tag words or concepts with colour highlights"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingWordTags ? "bg-yellow-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >🏷</button>

          {/* Indent mode */}
          <button
            onClick={() => {
              setEditingIndents((v) => !v);
              setEditingRefs(false); setEditingSpeech(false);
              setEditingWordTags(false); setSpeechRangeStart(null);
              setPendingWordTag(false);
            }}
            title={editingIndents ? "Exit indent mode" : "Indent paragraphs to indicate subordinate clauses"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingIndents ? "bg-teal-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >⇥</button>

          {/* Source/translation indent link toggle */}
          {editingIndents && (
            <label
              className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
              title={indentsLinked
                ? "Source and translation indent are linked — uncheck to set them independently"
                : "Source and translation indent are independent — check to link them"}
            >
              <input
                type="checkbox"
                checked={indentsLinked}
                onChange={(e) => {
                  const nowLinked = e.target.checked;
                  setIndentsLinked(nowLinked);
                  if (!nowLinked) {
                    // Seed T with S values for any paragraph not yet explicitly set,
                    // so T starts equal to S and can be changed independently from there.
                    setTvLineIndentMap((prev) => {
                      const next = new Map(prev);
                      for (const [wId, lvl] of lineIndentMap) {
                        if (!next.has(wId)) next.set(wId, lvl);
                      }
                      return next;
                    });
                  }
                }}
                className="w-3 h-3 accent-teal-600 cursor-pointer"
              />
              S↔T
            </label>
          )}

          {/* RST relation mode */}
          <button
            onClick={() => {
              setEditingRst((v) => !v);
              setEditingArrows(false);
              setArrowFromWordId(null);
              setRstSegA(null);
              setRstSegB(null);
              setShowRstPicker(false);
            }}
            title={editingRst ? "Exit RST relation mode" : "Mark RST (Rhetorical Structure Theory) relations between paragraph segments"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRst ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >↳</button>

          {/* Word arrow mode */}
          <button
            onClick={() => {
              setEditingArrows((v) => !v);
              setEditingRst(false);
              setRstSegA(null);
              setRstSegB(null);
              setShowRstPicker(false);
              setArrowFromWordId(null);
            }}
            title={editingArrows ? "Exit word arrow mode" : "Draw free-form arrows between words"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingArrows ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >↷</button>

          {/* Undo */}
          {undoStack.length > 0 && (
            <button
              onClick={() => {
                setUndoStack((prev) => {
                  if (prev.length === 0) return prev;
                  const entry = prev[prev.length - 1];
                  entry.undo();
                  return prev.slice(0, -1);
                });
              }}
              title={`Undo: ${undoStack[undoStack.length - 1].label} (Ctrl/Cmd+Z)`}
              className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
            >↩ {undoStack[undoStack.length - 1].label}</button>
          )}

          {/* Bold formatting mode */}
          <button
            onClick={() => {
              setEditingBold((v) => !v);
              setEditingItalic(false);
              setEditingParagraphs(false);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setEditingIndents(false);
              setEditingRst(false);
              setEditingArrows(false);
              setSpeechRangeStart(null);
              setRstSegA(null);
              setArrowFromWordId(null);
            }}
            title={editingBold ? "Exit bold mode" : "Click words to toggle bold"}
            className={["px-2.5 py-1 rounded text-xs font-bold transition-colors",
              editingBold ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >B</button>

          {/* Italic formatting mode */}
          <button
            onClick={() => {
              setEditingItalic((v) => !v);
              setEditingBold(false);
              setEditingParagraphs(false);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setEditingIndents(false);
              setEditingRst(false);
              setEditingArrows(false);
              setSpeechRangeStart(null);
              setRstSegA(null);
              setArrowFromWordId(null);
            }}
            title={editingItalic ? "Exit italic mode" : "Click words to toggle italic"}
            className={["px-2.5 py-1 rounded text-xs italic transition-colors",
              editingItalic ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >I</button>

          {/* Clear annotations */}
          <div className="border-l border-[var(--border)] pl-3 ml-1">
            <button
              onClick={() => setShowClearDialog(true)}
              title="Clear annotations by category"
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
            >
              🗑
            </button>
          </div>

          {/* Linguistic terms toggle — Hebrew only */}
          {isHebrew && (
            <button
              onClick={() => setUseLinguisticTerms((v) => !v)}
              title={useLinguisticTerms
                ? "Show descriptive aspect names (Perfect, Imperfect…)"
                : "Show linguistic terms (Qatal, Yiqtol, Wayyiqtol, Weqatal)"}
              className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
                useLinguisticTerms ? "bg-blue-600 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >Qatal</button>
          )}

          {/* Translation toggles */}
          {availableTranslations.length > 0 && (
            <div className="flex items-center gap-1 border-l border-[var(--border)] pl-4">
              <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">Translations:</span>
              {/* Source text visibility — shown only when a translation is active */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setHideSourceText((v) => !v)}
                  title={hideSourceText ? `Show ${textSource} text` : `Hide ${textSource} text`}
                  className={["px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                    !hideSourceText ? "bg-emerald-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >{textSource}</button>
              )}
              {/* Translation text edit mode */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setEditingTranslation((v) => !v)}
                  title={editingTranslation ? "Exit translation edit mode" : "Edit translation text"}
                  className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    editingTranslation ? "bg-sky-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >✏</button>
              )}
              {availableTranslations.map((t) => (
                <button key={t.id} onClick={() => toggleTranslation(t.id)} title={t.name}
                  className={["px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                    activeTranslationIds.has(t.id) ? "bg-emerald-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >{t.abbreviation}</button>
              ))}
            </div>
          )}

          {/* Font size controls */}
          {(() => {
            const sizeBtn = "w-6 h-6 flex items-center justify-center rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors select-none";
            return (
              <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                <span className="text-xs text-stone-400 dark:text-stone-500 select-none">{isHebrew ? "Heb" : "Grk"}</span>
                <button className={sizeBtn} onClick={() => adjustFontSize("source", -0.125)} title="Decrease source text size">A−</button>
                <button className={sizeBtn} onClick={() => adjustFontSize("source", +0.125)} title="Increase source text size">A+</button>
                {hasActiveTranslations && (
                  <>
                    <span className="text-xs text-stone-400 dark:text-stone-500 select-none ml-1">Tr</span>
                    <button className={sizeBtn} onClick={() => adjustFontSize("translation", -0.0625)} title="Decrease translation text size">A−</button>
                    <button className={sizeBtn} onClick={() => adjustFontSize("translation", +0.0625)} title="Increase translation text size">A+</button>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Character palette bar */}
        {(editingRefs || editingSpeech) && (
          <CharacterPanel
            characters={characters}
            activeCharacterId={activeCharId}
            mode={editingRefs ? "refs" : "speech"}
            onSelectCharacter={setActiveCharId}
            onCreateCharacter={handleCreateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onUpdateCharacter={handleUpdateCharacter}
            highlightedCharIds={highlightCharIds}
            onToggleHighlight={handleToggleHighlight}
          />
        )}

        {/* Speech range start hint */}
        {editingSpeech && speechRangeStart && (
          <div className="px-6 py-1 text-xs bg-violet-50 dark:bg-violet-950 border-b border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300">
            Start paragraph set — now click any word in the end paragraph to complete the speech section
          </div>
        )}

        {/* Word/concept tag palette bar */}
        {editingWordTags && (
          <WordTagPanel
            tags={wordTags}
            activeTagId={activeWordTagId}
            highlightedTagIds={highlightWordTagIds}
            pendingWordTag={pendingWordTag}
            onSelectTag={(id) => { setActiveWordTagId(id); setPendingWordTag(false); }}
            onCreateConceptTag={handleCreateConceptTag}
            onCreatePendingWordTag={handleCreatePendingWordTag}
            onDeleteTag={handleDeleteWordTag}
            onUpdateTag={handleUpdateWordTag}
            onToggleHighlight={handleToggleWordTagHighlight}
          />
        )}

        {/* Pending word tag hint */}
        {editingWordTags && pendingWordTag && (
          <div className="px-6 py-1 text-xs bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300">
            Click a source word to name this tag by its lemma
          </div>
        )}

        {/* RST relation hint */}
        {editingRst && !showRstPicker && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {rstSegA
              ? "First segment selected — click another segment dot to choose a relation type"
              : "Click a segment dot (◉) to start an RST relation"}
          </div>
        )}

        {/* RST relation type picker bar */}
        {showRstPicker && (
          <div
            className="border-b border-[var(--border)] px-4 py-2 flex flex-col gap-2 shrink-0"
            style={{ backgroundColor: "var(--nav-bg)" }}
          >
            {/* Relation type buttons */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium mr-1" style={{ color: "var(--nav-fg-muted)" }}>
                RST Relation:
              </span>
              <span className="text-xs opacity-50 mr-0.5 select-none">Coord.</span>
              {RELATIONSHIP_TYPES.filter((r) => r.category === "coordinate").map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleCreateRstRelation(r.key)}
                  className="px-2 py-0.5 rounded text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: r.color }}
                >
                  {r.label}
                </button>
              ))}
              <span className="text-xs opacity-30 mx-1 select-none">|</span>
              <span className="text-xs opacity-50 mr-0.5 select-none">Sub.</span>
              {RELATIONSHIP_TYPES.filter((r) => r.category === "subordinate").map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleCreateRstRelation(r.key)}
                  className="px-2 py-0.5 rounded text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: r.color }}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={handleCancelRstPicker}
                className="ml-auto text-xs px-2 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
              >
                Cancel
              </button>
            </div>
            {/* Nucleus/satellite swap row (only relevant for subordinate) */}
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <span>Roles:</span>
              <span className={`px-1.5 py-0.5 rounded font-medium ${!rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-stone-100 dark:bg-stone-800"}`}>
                Seg A = {rstRolesSwapped ? "satellite" : "nucleus"}
              </span>
              <span>→</span>
              <span className={`px-1.5 py-0.5 rounded font-medium ${rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-stone-100 dark:bg-stone-800"}`}>
                Seg B = {rstRolesSwapped ? "nucleus" : "satellite"}
              </span>
              <button
                onClick={() => setRstRolesSwapped((v) => !v)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
                title="Swap nucleus and satellite roles"
              >⇄ swap</button>
              <span className="text-[10px] opacity-50">(applies to subordinate relations only)</span>
            </div>
          </div>
        )}

        {/* Word arrow hint */}
        {editingArrows && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {arrowFromWordId
              ? "Click a target word to complete the arrow"
              : "Click a source word to start an arrow"}
          </div>
        )}

        {/* Scene break hint */}
        {editingScenes && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            Click any word to mark/unmark a section break there
          </div>
        )}

        {/* Annotation range-selection hint */}
        {editingAnnotations && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {annotRangeStart && !annotRangeEnd
              ? "Click the end segment to complete the range (or the same segment for a single-line annotation)"
              : annotRangeStart && annotRangeEnd
              ? "Fill in the annotation form in the right column, then save"
              : "Click any word to start annotating that paragraph segment"}
          </div>
        )}

        </div>{/* end sticky control area */}

        {/* ── Passage text ─────────────────────────────────────────────────── */}
        {words.length === 0 ? (
          <p className="px-6 py-6 text-sm italic" style={{ color: "var(--text-muted)" }}>
            No words found for this range.
          </p>
        ) : (
          <div
            className={`py-6 flex-1 ${hasActiveTranslations ? "" : "max-w-3xl mx-auto w-full"}`}
            style={{
              paddingLeft:  "1.5rem",
              paddingRight: "1.5rem",
              "--hebrew-font-size": `${hebrewFontSize}rem`,
              "--greek-font-size": `${greekFontSize}rem`,
              "--translation-font-size": `${translationFontSize}rem`,
              "--source-row-height": `${(isHebrew ? hebrewFontSize : greekFontSize) * 2.0}rem`,
            } as React.CSSProperties}
          >
            {orderedVerses.map((verse, idx) => {
              const isFirstOfChapter = idx === 0 || orderedVerses[idx - 1].ch !== verse.ch;
              const prev = orderedVerses[idx - 1];
              const next = orderedVerses[idx + 1];
              return (
                <div key={`${verse.ch}:${verse.v}`}>
                  {/* Chapter heading — only shown for multi-chapter passages */}
                  {isMultiChapter && isFirstOfChapter && (
                    <h2
                      className="text-xs font-semibold uppercase tracking-widest mb-3 pb-1 border-b"
                      style={{
                        color: "var(--accent)",
                        borderColor: "var(--border)",
                        fontFamily: "Georgia, 'Times New Roman', serif",
                      }}
                    >
                      Chapter {verse.ch}
                    </h2>
                  )}
                  <VerseDisplay
                    verseNum={verse.v}
                    words={verse.words}
                    displayMode={displayMode}
                    grammarFilter={grammarFilter}
                    colorRules={colorRules}
                    onSelectWord={handleSelectWord}
                    selectedWordId={selectedWord?.wordId ?? null}
                    isHebrew={isHebrew}
                    showTooltips={showTooltips}
                    translationTexts={activeTranslationVerseMap.get(`${verse.ch}:${verse.v}`) ?? []}
                    useLinguisticTerms={useLinguisticTerms}
                    paragraphBreakIds={paragraphBreakIds}
                    editingParagraphs={editingParagraphs}
                    characterRefMap={characterRefMap}
                    characterMap={characterMap}
                    wordSpeechMap={wordSpeechMap}
                    prevVerseLastWordId={prev?.words[prev.words.length - 1]?.wordId ?? null}
                    nextVerseFirstWordId={next?.words[0]?.wordId ?? null}
                    editingRefs={editingRefs}
                    editingSpeech={editingSpeech}
                    activeCharId={activeCharId}
                    speechRangeStartWordId={speechRangeStart?.wordId ?? null}
                    book={osisBook}
                    chapter={verse.ch}
                    onSelectTranslationWord={handleSelectTranslationWord}
                    onToggleTranslationParagraphBreak={handleToggleTranslationParagraphBreak}
                    highlightCharIds={highlightCharIds}
                    onDeleteSpeechSection={handleDeleteSpeechSection}
                    onReassignSpeechSection={handleReassignSpeechSection}
                    wordTagRefMap={wordTagRefMap}
                    wordTagMap={wordTagMap}
                    editingWordTags={editingWordTags}
                    highlightWordTagIds={highlightWordTagIds}
                    lineIndentMap={lineIndentMap}
                    translationIndentMap={tvLineIndentMap}
                    indentsLinked={indentsLinked}
                    wordToParaStart={wordToParaStart}
                    editingIndents={editingIndents}
                    onSetSegmentIndent={handleSetIndent}
                    onSetSegmentTvIndent={handleSetTvIndent}
                    wordFormattingMap={wordFormattingMap}
                    editingFormatting={editingBold || editingItalic}
                    editingTranslation={editingTranslation}
                    onUpdateTranslationVerse={handleUpdateTranslationVerse}
                    sceneBreakMap={sceneBreakMap}
                    editingScenes={editingScenes}
                    onToggleSceneBreak={handleToggleSceneBreak}
                    onUpdateSceneHeading={handleUpdateSceneHeading}
                    onUpdateSceneOutOfSequence={handleUpdateSceneOutOfSequence}
                    onUpdateSceneExtendedThrough={handleUpdateSceneExtendedThrough}
                    sectionRanges={sectionRanges}
                    annotationsBySegment={annotationsBySegment}
                    themeColorsByLabel={themeColorsByLabel}
                    editingAnnotations={editingAnnotations}
                    annotRangeStartWordId={annotRangeStart}
                    annotRangeEndWordId={annotRangeEnd}
                    onSelectAnnotationSegment={handleSelectAnnotationSegment}
                    onSaveAnnotation={handleSaveAnnotation}
                    onCancelAnnotation={handleCancelAnnotation}
                    onDeleteAnnotation={handleDeleteAnnotation}
                    onUpdateAnnotation={handleUpdateAnnotation}
                    onExpandAnnotationRange={handleExpandAnnotationRange}
                    showAnnotationCol={editingAnnotations || lineAnnotationsState.length > 0}
                    editingArrows={editingArrows}
                    onSelectArrowWordById={handleSelectArrowWordById}
                    hideSourceText={hideSourceText}
                  />
                </div>
              );
            })}

            {/* Word count footer */}
            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              {words.length.toLocaleString()} words · {rangeLabel}
            </p>
          </div>
        )}
      </div>

      {/* ── Morphology side panel ────────────────────────────────────────── */}
      {panelOpen && (
        <div className="w-72 border-l border-[var(--border)] flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Word Analysis</h2>
            <button
              onClick={() => setPanelOpen(false)}
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
              aria-label="Close"
            >×</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <MorphologyPanel word={selectedWord} useLinguisticTerms={useLinguisticTerms} />
          </div>
        </div>
      )}

      {/* Clear annotations dialog */}
      {showClearDialog && (
        <ClearAnnotationsDialog
          scopeLabel={passage.label || `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`}
          book={osisBook}
          textSource={textSource}
          startChapter={passage.startChapter}
          endChapter={passage.endChapter}
          availableCategories={["paragraphBreaks", "characterRefs", "speechSections", "wordTagRefs", "lineIndents", "rstRelations", "wordArrows"]}
          onClose={() => setShowClearDialog(false)}
          onCleared={handleAnnotationsCleared}
        />
      )}
    </div>
  );
}
