"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Word, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, RstRelation, WordArrow, LineAnnotation } from "@/lib/db/schema";
import type { Translation, TranslationVerse } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry, InterlinearSubMode } from "@/lib/morphology/types";
import VerseDisplay from "./VerseDisplay";
import MorphologyPanel from "./MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import InterlinearSubModePicker from "@/components/controls/InterlinearSubModePicker";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel from "@/components/controls/WordTagPanel";
import RstRelationOverlay from "./RstRelationOverlay";
import WordArrowOverlay from "./WordArrowOverlay";
import ClearAnnotationsDialog, { type ClearCategory } from "@/components/controls/ClearAnnotationsDialog";
import TranslationPicker from "@/components/controls/TranslationPicker";
import NotesPane from "@/components/notes/NotesPane";
import SearchPane from "@/components/search/SearchPane";
import ResizablePane from "@/components/ResizablePane";
import RstTypeManager from "@/components/controls/RstTypeManager";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { RELATIONSHIP_TYPES, RELATIONSHIP_MAP } from "@/lib/morphology/clauseRelationships";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";
import type { RstCustomType } from "@/lib/db/schema";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import { computeSectionRanges } from "@/lib/utils/sectionRanges";
import { generateOutline } from "@/lib/utils/outlineExport";
import { useTranslation } from "@/lib/i18n/LocaleContext";

/** Returns true if the word's surface text is entirely punctuation and should
 *  be skipped during character / word-tag selection. */
function isPunctuationWord(word: Word): boolean {
  const text = (word.surfaceText ?? "").replace(/\//g, "").trim();
  // Match common ASCII and Unicode punctuation: quotes, period, comma, colon, semicolon, middle dot
  return text.length > 0 && /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7]+$/.test(text);
}

interface ChapterDisplayProps {
  words: Word[];
  book: string;
  chapter: number;
  textSource: string;
  availableTranslations: Translation[];
  translationVerseData: Record<number, TranslationVerse[]>;
  initialParagraphBreakIds: string[];
  initialCharacters: Character[];
  initialCharacterRefs: CharacterRef[];
  initialSpeechSections: SpeechSection[];
  initialWordTags: WordTag[];
  initialWordTagRefs: WordTagRef[];
  initialLineIndents: { wordId: string; indentLevel: number }[];
  initialRstRelations: RstRelation[];
  initialTvRstRelations?: RstRelation[];
  initialWordArrows: WordArrow[];
  initialWordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[];
  initialSceneBreaks: { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null }[];
  initialLineAnnotations: LineAnnotation[];
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; extendedThrough: number | null }[];
  bookMaxVerses: Map<number, number>;
  /** Base verse text from data/ult.db (empty if not imported). */
  ultBaseVerses?: { verse: number; text: string }[];
  /** The Translation record for ULT in user.db (null if not imported). */
  ultTranslation?: Translation | null;
  /** Optional heading strip (book title, chapter number, word count) rendered
   *  above the toolbar; hidden automatically in presentation mode. */
  headingSlot?: React.ReactNode;
}

const DEFAULT_FILTER: GrammarFilterState = {
  noun: true, verb: true, adjective: true, adverb: true,
  preposition: true, conjunction: true, pronoun: true,
  particle: true, article: true, interjection: true,
};

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

export default function ChapterDisplay({
  words,
  book,
  chapter,
  textSource,
  availableTranslations,
  translationVerseData,
  initialParagraphBreakIds,
  initialCharacters,
  initialCharacterRefs,
  initialSpeechSections,
  initialWordTags,
  initialWordTagRefs,
  initialLineIndents,
  initialRstRelations,
  initialTvRstRelations = [],
  initialWordArrows,
  initialWordFormatting,
  initialSceneBreaks,
  initialLineAnnotations,
  bookSceneBreaks,
  bookMaxVerses,
  ultBaseVerses = [],
  ultTranslation = null,
  headingSlot,
}: ChapterDisplayProps) {
  const { t } = useTranslation();
  // Use fallback defaults for SSR — localStorage values are loaded in useEffect after hydration
  const [displayMode, setDisplayMode] = useState<DisplayMode>("clean");
  const [interlinearSubMode, setInterlinearSubMode] = useState<InterlinearSubMode>("lemma");
  const [constituentLabelMap, setConstituentLabelMap] = useState<Map<string, string>>(new Map());
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([]);
  const [datasetEntryMap, setDatasetEntryMap] = useState<Map<string, string>>(new Map());
  // Upload dialog state
  const [uploadDatasetId, setUploadDatasetId] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const [searchRequest, setSearchRequest] = useState<{ query: string; source: string; nonce: number } | null>(null);
  const [notesScrollVerse, setNotesScrollVerse] = useState<number | null>(null);

  // Auto-open search pane if a previous search was persisted in sessionStorage
  useEffect(() => {
    try {
      if (sessionStorage.getItem("structura.search")) setSearchOpen(true);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showTooltips, setShowTooltips] = useState(false);
  const [showAtnachBreaks, setShowAtnachBreaks] = useState(false);
  // Store active translations by abbreviation so they survive cross-book navigation
  const [activeTranslationAbbrs, setActiveTranslationAbbrs] = useState<Set<string>>(new Set());
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [useLinguisticTerms, setUseLinguisticTerms] = useState(false);
  const [hebrewFontSize, setHebrewFontSize] = useState(1.375);
  const [greekFontSize, setGreekFontSize] = useState(1.25);
  const [translationFontSize, setTranslationFontSize] = useState(0.875);
  const [editingParagraphs, setEditingParagraphs] = useState(false);
  const [paragraphBreakIds, setParagraphBreakIds] = useState<Set<string>>(
    () => new Set(initialParagraphBreakIds)
  );

  // ── Section break state ──────────────────────────────────────────────────────
  // Map of wordId → Array<{ heading, level, verse, outOfSequence, extendedThrough }>.
  // Multiple levels may exist at the same wordId; toggling also mirrors into paragraphBreakIds.
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

  // ── Line annotation state ────────────────────────────────────────────────────
  // lineAnnotations: full chapter list; annotRangeStart/End: two-click segment selection.
  const [lineAnnotations, setLineAnnotations] = useState<LineAnnotation[]>(initialLineAnnotations);
  const [editingAnnotations, setEditingAnnotations] = useState(false);
  // First word of the start/end segment selected for a new annotation.
  const [annotRangeStart, setAnnotRangeStart] = useState<string | null>(null);
  const [annotRangeEnd, setAnnotRangeEnd] = useState<string | null>(null);

  // ── Character tagging state ────────────────────────────────────────────────
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
  // Pending first-click word for two-click speech section selection
  const [speechRangeStart, setSpeechRangeStart] = useState<Word | null>(null);

  // ── Word / concept tag state ────────────────────────────────────────────────
  const [wordTags, setWordTags] = useState<WordTag[]>(initialWordTags);
  const [wordTagRefMap, setWordTagRefMap] = useState<Map<string, WordTagRef>>(
    () => new Map(initialWordTagRefs.map((r) => [r.wordId, r]))
  );
  const [editingWordTags, setEditingWordTags] = useState(false);
  const [activeWordTagId, setActiveWordTagId] = useState<number | null>(
    initialWordTags[0]?.id ?? null
  );
  const [highlightWordTagIds, setHighlightWordTagIds] = useState<Set<number>>(new Set());
  // When true, the next source-word click creates a "word"-type tag using its lemma
  const [pendingWordTag, setPendingWordTag] = useState(false);
  const [pendingWordTagColor, setPendingWordTagColor] = useState<string | null>(null);

  const wordTagMap = useMemo(
    () => new Map(wordTags.map((t) => [t.id, t])),
    [wordTags]
  );

  // ── Search hit highlighting ──────────────────────────────────────────────────
  /** Called by SearchPane whenever results change. Filters to words in this chapter. */
  const handleSearchResults = useCallback((allResults: import("@/app/api/search/words/route").SearchResult[]) => {
    const normalizedSource = textSource === "LXX" ? "STEPBIBLE_LXX" : textSource;
    const hits = new Set<string>();
    for (const r of allResults) {
      if (r.book === book && r.chapter === chapter && r.textSource === normalizedSource) {
        hits.add(r.wordId);
      }
    }
    setSearchHits(hits);
  }, [book, chapter, textSource]);

  /** Called by SearchPane after a successful save-as-list.
   *  Injects the new tag into local state and clears temp highlights. */
  const handleSearchSaved = useCallback((tagId: number, name: string, color: string, wordRefs: { wordId: string; book: string; chapter: number; textSource: string }[]) => {
    // Add the new corpus-wide tag to local state
    const newTag: WordTag = { id: tagId, workspaceId: 1, book: "*", name, color, type: "search", createdAt: new Date().toISOString() };
    setWordTags((prev) => [...prev, newTag]);

    // Add refs for the current chapter to the local wordTagRefMap
    const normalizedSource = textSource === "LXX" ? "STEPBIBLE_LXX" : textSource;
    const chapterRefs = wordRefs.filter(
      (r) => r.book === book && r.chapter === chapter && r.textSource === normalizedSource
    );
    if (chapterRefs.length > 0) {
      setWordTagRefMap((prev) => {
        const next = new Map(prev);
        for (const r of chapterRefs) {
          // Only add if not already tagged (onConflictDoNothing mirrors DB behaviour)
          if (!next.has(r.wordId)) {
            next.set(r.wordId, { id: -1, workspaceId: 1, wordId: r.wordId, tagId, textSource: r.textSource, book: r.book, chapter: r.chapter });
          }
        }
        return next;
      });
    }
    // Clear temporary search highlights — now handled by the tag system
    setSearchHits(new Set());
  }, [book, chapter, textSource]);

  /** Called by MorphologyPanel when the user clicks a lemma or Strong's number. */
  const handleSearchFromWord = useCallback((query: string, source: string) => {
    setSearchOpen(true);
    setSearchRequest({ query, source, nonce: Date.now() });
  }, []);

  /** Called when the user clicks a lemma in interlinear mode. */
  const handleLemmaClick = useCallback((word: import("@/lib/db/schema").Word) => {
    const query = word.language === "hebrew"
      ? (word.strongNumber ?? word.lemma ?? "")
      : (word.lemma ?? "");
    if (!query) return;
    setSearchOpen(true);
    setSearchRequest({ query, source: word.textSource, nonce: Date.now() });
  }, []);

  // ── Paragraph indentation state ─────────────────────────────────────────────
  // Source and translation indents are stored separately: tv:-prefixed wordIds
  // hold the translation column's indent level in the DB.
  const [lineIndentMap, setLineIndentMap] = useState<Map<string, number>>(
    () => new Map(initialLineIndents.filter(li => !li.wordId.startsWith("tv:")).map((li) => [li.wordId, li.indentLevel]))
  );
  const [tvLineIndentMap, setTvLineIndentMap] = useState<Map<string, number>>(
    () => new Map(initialLineIndents.filter(li => li.wordId.startsWith("tv:")).map((li) => [li.wordId.slice(3), li.indentLevel]))
  );
  const [indentsLinked, setIndentsLinked] = useState(true);
  const [editingIndents, setEditingIndents] = useState(false);

  // ── RST relation state ───────────────────────────────────────────────────
  const [rstRelations, setRstRelations]      = useState<RstRelation[]>(initialRstRelations);
  const [tvRstRelations, setTvRstRelations]  = useState<RstRelation[]>(initialTvRstRelations);
  const [rstRelationsLinked, setRstRelationsLinked] = useState(
    () => readLocal("structura:rstLinked", true)
  );
  const [rstEditingSide, setRstEditingSide]  = useState<"source" | "translation">("source");
  const [editingRst, setEditingRst]          = useState(false);
  // First-selected segment (nucleus for subordinate; first nucleus for coordinate)
  const [rstSegA, setRstSegA]              = useState<string | null>(null);
  // Second-selected segment (triggers picker)
  const [rstSegB, setRstSegB]              = useState<string | null>(null);
  // Whether the user wants to swap nucleus/satellite roles (for subordinate types)
  const [rstRolesSwapped, setRstRolesSwapped] = useState(false);
  const [showRstPicker, setShowRstPicker]  = useState(false);
  // groupId of the relation whose type is being edited via chip click
  const [rstEditGroupId, setRstEditGroupId] = useState<string | null>(null);
  // Custom RST label types
  const [customRstTypes, setCustomRstTypes] = useState<RstCustomType[]>([]);
  const [showRstTypeManager, setShowRstTypeManager] = useState(false);

  // ── Word arrows state ──────────────────────────────────────────────────────
  const [wordArrowsState, setWordArrowsState] = useState<WordArrow[]>(initialWordArrows);
  const [editingArrows, setEditingArrows]     = useState(false);
  const [arrowFromWordId, setArrowFromWordId] = useState<string | null>(null);

  // ── Word formatting (bold / italic) state ─────────────────────────────────
  const [wordFormattingMap, setWordFormattingMap] = useState<Map<string, { isBold: boolean; isItalic: boolean }>>(
    () => new Map(initialWordFormatting.map((f) => [f.wordId, { isBold: f.isBold, isItalic: f.isItalic }]))
  );
  const [editingBold, setEditingBold]     = useState(false);
  const [editingItalic, setEditingItalic] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);

  // ── Source text visibility ─────────────────────────────────────────────────
  // When true, source text columns are hidden so the user works with translation only.
  const [hideSourceText, setHideSourceText] = useState(false);

  // ── Presentation mode ─────────────────────────────────────────────────────
  const [presentationMode, setPresentationMode] = useState(false);

  // ── Outline copy ──────────────────────────────────────────────────────────
  const [outlineCopied, setOutlineCopied] = useState(false);

  // ── Translation text editing ───────────────────────────────────────────────
  // Local mutable copy of translationVerseData so edits can be reflected immediately.
  // If ULT base verses are provided, merge them in: user edits (from user.db) take precedence;
  // verses not yet edited fall back to the immutable base text from ult.db.
  const initialTranslationVerseData = useMemo(() => {
    if (!ultTranslation || ultBaseVerses.length === 0) return translationVerseData;
    const ultId = ultTranslation.id;
    const editedMap = new Map(
      (translationVerseData[ultId] ?? []).map((v) => [v.verse, v])
    );
    const merged: TranslationVerse[] = ultBaseVerses.map((base, i) => {
      return editedMap.get(base.verse) ?? {
        id: -(i + 1),                    // synthetic — not yet saved to user.db
        workspaceId: ultTranslation.workspaceId,
        translationId: ultId,
        osisRef: `${book}.${chapter}.${base.verse}`,
        bookId: 0, chapter,
        verse: base.verse,
        text: base.text,
      };
    });
    return { ...translationVerseData, [ultId]: merged };
  // Only recalculate when book/chapter/ultTranslation change (navigation); not on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, ultTranslation?.id]);

  const [localTranslationVerseData, setLocalTranslationVerseData] = useState(initialTranslationVerseData);
  const [editingTranslation, setEditingTranslation] = useState(false);
  // Snapshot taken when translation editing mode is entered, used for Cancel
  const translationEditSnapshotRef = useRef(translationVerseData);

  // ── Overlay refs ───────────────────────────────────────────────────────────
  const textContainerRef = useRef<HTMLDivElement>(null);
  // outerRef wraps textContainerRef without overflow clipping, so SVG arcs can
  // extend in any direction without being cut off by overflow-y: auto.
  const outerRef = useRef<HTMLDivElement>(null);

  // Maps every word in the chapter to the first word of its paragraph.
  // Used by VerseDisplay to look up indent levels for paragraph continuations.
  // Verse boundaries always reset the paragraph start so that indent levels from
  // the last segment of verse N never leak into the first segment of verse N+1.
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
  // Includes: chapter start (i=0), explicit ¶ breaks, and the first word of every verse
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

  // ── Annotation coverage map ───────────────────────────────────────────────
  // Maps each paragraph-segment first-word-id to the annotations that cover it,
  // along with whether this segment is the start/end of each annotation's range.
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

  // Maps theme label → color (first occurrence wins) so the creation form can
  // pre-fill the color when reusing an existing theme label.
  const themeColorsByLabel = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const ann of lineAnnotations) {
      if (ann.annotType === "theme" && !map.has(ann.label)) {
        map.set(ann.label, ann.color);
      }
    }
    return map;
  }, [lineAnnotations]);

  // ── Undo stack ─────────────────────────────────────────────────────────────
  type UndoEntry = { label: string; undo: () => void | Promise<void> };
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);

  function pushUndo(entry: UndoEntry) {
    setUndoStack((prev) => {
      const next = [...prev.slice(-49), entry];
      undoStackRef.current = next;
      return next;
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        const entry = stack[stack.length - 1];
        const next = stack.slice(0, -1);
        undoStackRef.current = next;
        setUndoStack(next);
        entry.undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Restore all persisted settings after hydration — avoids SSR/client HTML mismatch.
  // Font sizes are included here (not in lazy initializers) for the same reason.
  // Write effects for font sizes were removed; adjustFontSize writes directly instead.
  useEffect(() => {
    setDisplayMode(readLocal<DisplayMode>("structura:displayMode", "clean"));
    setInterlinearSubMode(readLocal<InterlinearSubMode>("structura:interlinearSubMode", "lemma"));
    setActiveTranslationAbbrs(new Set(readLocal<string[]>("structura:activeTranslations", [])));
    setUseLinguisticTerms(readLocal<boolean>("structura:useLinguisticTerms", false));
    setHebrewFontSize(readLocal<number>("structura:hebrewFontSize", 1.375));
    setGreekFontSize(readLocal<number>("structura:greekFontSize", 1.25));
    setTranslationFontSize(readLocal<number>("structura:translationFontSize", 0.875));
    setHideSourceText(readLocal<boolean>("structura:hideSourceText", false));
  }, []); // empty deps → runs once after first render (client only)

  // Snapshot translation data when editing mode is entered so Cancel can revert to it
  useEffect(() => {
    if (editingTranslation) {
      translationEditSnapshotRef.current = localTranslationVerseData;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTranslation]);

  // Persist sticky settings whenever they change
  useEffect(() => { writeLocal("structura:displayMode", displayMode); }, [displayMode]);
  useEffect(() => { writeLocal("structura:interlinearSubMode", interlinearSubMode); }, [interlinearSubMode]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);
  useEffect(() => { writeLocal("structura:rstLinked", rstRelationsLinked); }, [rstRelationsLinked]);

  // ── Load datasets list on mount ───────────────────────────────────────────
  useEffect(() => {
    fetch("/api/interlinear/datasets?workspaceId=1")
      .then((r) => r.json())
      .then((rows: { id: number; name: string }[]) => setDatasets(rows))
      .catch(() => {});
  }, []);

  // ── Load constituent labels for current chapter ───────────────────────────
  useEffect(() => {
    if (displayMode !== "interlinear" || interlinearSubMode !== "constituent") return;
    fetch(
      `/api/interlinear/constituent-labels?workspaceId=1&book=${encodeURIComponent(book)}&chapter=${chapter}&textSource=${encodeURIComponent(textSource)}`
    )
      .then((r) => r.json())
      .then((rows: { wordId: string; label: string }[]) =>
        setConstituentLabelMap(new Map(rows.map((r) => [r.wordId, r.label])))
      )
      .catch(() => {});
  }, [displayMode, interlinearSubMode, book, chapter, textSource]);

  // ── Load dataset entries for active dataset + current chapter ─────────────
  useEffect(() => {
    if (displayMode !== "interlinear") return;
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    fetch(
      `/api/interlinear/datasets/${dsId}/entries?book=${encodeURIComponent(book)}&chapter=${chapter}&textSource=${encodeURIComponent(textSource)}`
    )
      .then((r) => r.json())
      .then((rows: { wordId: string; value: string }[]) =>
        setDatasetEntryMap(new Map(rows.map((r) => [r.wordId, r.value])))
      )
      .catch(() => {});
  }, [displayMode, interlinearSubMode, book, chapter, textSource]);

  // Fetch custom RST types on mount
  useEffect(() => {
    fetch("/api/rst-custom-types")
      .then((r) => r.json())
      .then((rows: RstCustomType[]) => setCustomRstTypes(rows))
      .catch(() => {});
  }, []);

  // Merged RST types (built-in + custom)
  const allRstTypes = useMemo<RstTypeEntry[]>(
    () => [...RELATIONSHIP_TYPES, ...customRstTypes],
    [customRstTypes]
  );

  const isHebrew = words[0]?.language === "hebrew";

  // Group words by verse (stable for the chapter)
  const verseGroups = useMemo(() => {
    const map = new Map<number, Word[]>();
    for (const w of words) {
      if (!map.has(w.verse)) map.set(w.verse, []);
      map.get(w.verse)!.push(w);
    }
    return map;
  }, [words]);
  const verseNums = useMemo(() => [...verseGroups.keys()].sort((a, b) => a - b), [verseGroups]);

  // Flatten sceneBreakMap + book-wide breaks into sorted array for cross-chapter range computation.
  // Current-chapter breaks come from live state (sceneBreakMap); other chapters come from the
  // static bookSceneBreaks prop fetched at page load.
  const sectionRanges = useMemo(() => {
    // Start with book-wide breaks, excluding the current chapter (live state overrides those)
    const allBreaks: { wordId: string; level: number; chapter: number; verse: number; extendedThrough: number | null }[] =
      bookSceneBreaks
        .filter((b) => b.chapter !== chapter)
        .map((b) => ({ ...b }));

    // Add current chapter breaks from live sceneBreakMap state
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        allBreaks.push({ wordId, level: br.level, chapter, verse: br.verse, extendedThrough: null });
      }
    }

    return computeSectionRanges(allBreaks, bookMaxVerses, book);
  }, [sceneBreakMap, bookSceneBreaks, bookMaxVerses, chapter, book]);

  // Character id → Character
  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  // Merge ULT into availableTranslations when it has base verses (it won't appear
  // in the DB query result if no translation_verses edits exist for this chapter).
  const allAvailableTranslations = useMemo(() => {
    if (!ultTranslation || ultBaseVerses.length === 0) return availableTranslations;
    if (availableTranslations.some((t) => t.id === ultTranslation.id)) return availableTranslations;
    return [ultTranslation, ...availableTranslations];
  }, [availableTranslations, ultTranslation, ultBaseVerses.length]);

  // Set of system translation IDs — shown with a "built-in" badge in the picker
  const systemTranslationIds = useMemo(
    () => new Set(ultTranslation ? [ultTranslation.id] : []),
    [ultTranslation]
  );

  // Resolve stored abbreviations → numeric IDs for the current chapter's translations
  const activeTranslationIds = useMemo(
    () => new Set(
      allAvailableTranslations
        .filter((t) => activeTranslationAbbrs.has(t.abbreviation))
        .map((t) => t.id)
    ),
    [activeTranslationAbbrs, allAvailableTranslations]
  );

  // wordId → SpeechSection[] sorted largest-range-first (outermost → innermost).
  // Multiple sections per word occur when speech boxes nest (a quote within a quote).
  const wordSpeechMap = useMemo<Map<string, SpeechSection[]>>(() => {
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));

    // Sort descending by range size so index-0 is always the outermost section.
    const sorted = [...speechSections].sort((a, b) => {
      const aLen = ((posMap.get(a.endWordId) ?? 0) - (posMap.get(a.startWordId) ?? 0));
      const bLen = ((posMap.get(b.endWordId) ?? 0) - (posMap.get(b.startWordId) ?? 0));
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

  // Build verseNum → TranslationTextEntry[] for active translations
  const activeTranslationVerseMap = useMemo(() => {
    const map = new Map<number, TranslationTextEntry[]>();
    for (const t of allAvailableTranslations) {
      if (!activeTranslationIds.has(t.id)) continue;
      const verses = localTranslationVerseData[t.id] ?? [];
      for (const tv of verses) {
        const existing = map.get(tv.verse) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text });
        map.set(tv.verse, existing);
      }
    }
    return map;
  }, [activeTranslationIds, allAvailableTranslations, localTranslationVerseData]);

  const hasActiveTranslations = activeTranslationIds.size > 0;

  function toggleTranslation(id: number) {
    const abbr = allAvailableTranslations.find((t) => t.id === id)?.abbreviation;
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

  function handleSelectWord(word: Word, shiftHeld = false) {
    if (editingAnnotations) {
      // Map the clicked word to its paragraph-segment first-word-id
      const segId = wordToParaStart.get(word.wordId) ?? word.wordId;
      handleSelectAnnotationSegment(segId, shiftHeld);
      return;
    }
    if (editingBold || editingItalic) {
      handleToggleWordFormatting(word);
      return;
    }
    if (editingArrows) {
      handleSelectArrowWord(word);
      return;
    }
    if (editingParagraphs) {
      handleToggleParagraphBreak(word.wordId);
      return;
    }
    if (editingScenes) {
      const existing = sceneBreakMap.get(word.wordId) ?? [];
      if (existing.length === 0) {
        // No break yet — add level 1
        handleToggleSceneBreak(word.wordId, 1, word.verse);
      } else {
        // Word already has break(s): add the lowest missing level.
        // Level 1 is not accessible via click once it exists; skip it.
        const existingLevels = new Set(existing.map((b) => b.level));
        let nextLevel = existingLevels.has(1) ? 2 : 1;
        while (existingLevels.has(nextLevel) && nextLevel <= 6) nextLevel++;
        if (nextLevel <= 6) {
          handleToggleSceneBreak(word.wordId, nextLevel, word.verse);
        }
        // All 6 levels already present — clicking does nothing
      }
      return;
    }
    if (editingRefs) {
      if (activeCharId === null) return;
      handleToggleCharacterRef(word);
      return;
    }
    if (editingSpeech) {
      if (activeCharId === null) return;
      handleToggleSpeechSection(word, shiftHeld);
      return;
    }
    if (editingWordTags) {
      handleToggleWordTagRef(word);
      return;
    }
    setSelectedWord(word);
    setPanelOpen(true);
  }

  // Core toggle logic — works for source words (source = textSource) and
  // translation words (source = translation abbreviation, e.g. "KJV").
  // Pass record=false when called from an undo handler to avoid pushing another undo entry.
  async function handleToggleParagraphBreakById(wordId: string, source: string, record = true) {
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
        body: JSON.stringify({ wordId, book, chapter, source }),
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
    // When ADDING a break inside an indented paragraph, inherit the indent level
    // so the new segment starts at the same indentation as the paragraph it splits from.
    const wasSet = paragraphBreakIds.has(wordId);
    if (!wasSet) {
      const paraStartId = wordToParaStart.get(wordId) ?? wordId;
      const inheritedIndent = lineIndentMap.get(paraStartId) ?? 0;
      if (inheritedIndent > 0) {
        handleSetIndent(wordId, inheritedIndent);
      }
    }
    return handleToggleParagraphBreakById(wordId, textSource);
  }

  // Called when a translation word is clicked in paragraph-editing mode.
  function handleToggleTranslationParagraphBreak(wordId: string, abbr: string) {
    return handleToggleParagraphBreakById(wordId, abbr);
  }

  async function handleAddAtnachParagraphBreaks() {
    const toAdd: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i];
      const next = words[i + 1];
      if (
        w.verse === next.verse &&
        (w.surfaceText ?? "").includes("\u0591") &&
        !paragraphBreakIds.has(next.wordId)
      ) {
        toAdd.push(next.wordId);
      }
    }
    if (toAdd.length === 0) return;

    pushUndo({
      label: `Add ${toAdd.length} atnach ¶`,
      undo: () => {
        setParagraphBreakIds((prev) => {
          const next = new Set(prev);
          toAdd.forEach((id) => next.delete(id));
          return next;
        });
        toAdd.forEach((id) =>
          fetch("/api/paragraph-breaks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wordId: id, book, chapter, source: textSource }),
          })
        );
      },
    });

    setParagraphBreakIds((prev) => {
      const next = new Set(prev);
      toAdd.forEach((id) => next.add(id));
      return next;
    });

    await Promise.all(
      toAdd.map((id) =>
        fetch("/api/paragraph-breaks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: id, book, chapter, source: textSource }),
        })
      )
    );
  }

  // ── Section break handlers ───────────────────────────────────────────────────

  async function handleToggleSceneBreak(wordId: string, level: number, verse: number, record = true) {
    const existingArr = sceneBreakMap.get(wordId) ?? [];
    const wasSet = existingArr.some((b) => b.level === level);
    if (record) {
      pushUndo({
        label: wasSet ? "Remove section break" : "Add section break",
        undo: () => handleToggleSceneBreak(wordId, level, verse, false),
      });
    }
    // Optimistic update
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
    // Mirror paragraph break: add if no breaks existed before; remove if none remain after
    if (!wasSet) {
      setParagraphBreakIds((prev) => { const next = new Set(prev); next.add(wordId); return next; });
    } else if (existingArr.length === 1) {
      // This was the last break
      setParagraphBreakIds((prev) => { const next = new Set(prev); next.delete(wordId); return next; });
    }
    try {
      await fetch("/api/scene-breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book, chapter, verse, source: textSource, level }),
      });
    } catch {
      // Rollback on error
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
    } catch {
      // Non-critical; leave optimistic state
    }
  }

  async function handleChangeSceneBreakLevel(wordId: string, fromLevel: number, toLevel: number, verse: number) {
    const existing = sceneBreakMap.get(wordId)?.find(b => b.level === fromLevel);
    if (!existing) return;
    // Optimistic update: swap level in state
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? [])
        .filter(b => b.level !== fromLevel)
        .concat({ ...existing, level: toLevel });
      arr.sort((a, b) => a.level - b.level);
      next.set(wordId, arr);
      return next;
    });
    try {
      // Toggle old level off, new level on
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book, chapter, verse, source: textSource, level: fromLevel }) });
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book, chapter, verse, source: textSource, level: toLevel }) });
      // Restore heading on the new level
      if (existing.heading) {
        await fetch("/api/scene-breaks", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, level: toLevel, heading: existing.heading }) });
      }
    } catch {
      // Rollback
      setSceneBreakMap((prev) => {
        const next = new Map(prev);
        const arr = (prev.get(wordId) ?? [])
          .filter(b => b.level !== toLevel)
          .concat(existing);
        arr.sort((a, b) => a.level - b.level);
        next.set(wordId, arr);
        return next;
      });
    }
  }

  function handleExitSceneEditing() {
    // Read DOM input values while inputs are still mounted, then remove any breaks
    // whose heading the user left blank.
    const emptyBreaks: { wordId: string; level: number; verse: number }[] = [];
    for (const [wordId, breaks] of sceneBreakMap) {
      for (const br of breaks) {
        const inputEl = document.getElementById(`scene-heading-${wordId}-${br.level}`) as HTMLInputElement | null;
        const currentValue = inputEl ? inputEl.value.trim() : (br.heading?.trim() ?? "");
        if (!currentValue) {
          emptyBreaks.push({ wordId, level: br.level, verse: br.verse });
        }
      }
    }
    setEditingScenes(false);
    for (const { wordId, level, verse } of emptyBreaks) {
      handleToggleSceneBreak(wordId, level, verse);
    }
  }

  async function handleExportOutline() {
    // Book-wide breaks: other chapters come from the static prop; current chapter uses live state.
    const allBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number }[] = [];
    for (const b of bookSceneBreaks) {
      if (b.chapter !== chapter) allBreaks.push(b);
    }
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        allBreaks.push({ wordId, heading: br.heading, level: br.level, chapter, verse: br.verse });
      }
    }
    allBreaks.sort((a, b) =>
      a.chapter !== b.chapter ? a.chapter - b.chapter :
      a.verse !== b.verse ? a.verse - b.verse :
      a.level - b.level
    );
    const text = generateOutline(allBreaks, sectionRanges);
    await navigator.clipboard.writeText(text);
    setOutlineCopied(true);
    setTimeout(() => setOutlineCopied(false), 2000);
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
    } catch {
      // Non-critical; leave optimistic state
    }
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
    } catch {
      // Non-critical; leave optimistic state
    }
  }

  // ── Line annotation handlers ─────────────────────────────────────────────────

  function handleSelectAnnotationSegment(segWordId: string, shiftHeld = false) {
    if (annotRangeEnd !== null) {
      // Form is already showing
      if (shiftHeld) {
        // Shift+click while form shows → redefine end without losing start
        setAnnotRangeEnd(segWordId);
      } else {
        // Plain click → discard and start fresh
        setAnnotRangeStart(segWordId);
        setAnnotRangeEnd(null);
      }
      return;
    }
    if (!annotRangeStart) {
      // No start yet → set start regardless of shift
      setAnnotRangeStart(segWordId);
      return;
    }
    // Start is set, end not yet: any click (same or different) completes the range
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
    // Normalise so that start ≤ end in segment order
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const startPos = posMap.get(annotRangeStart) ?? 0;
    const endPos   = posMap.get(endWordId) ?? 0;
    const lo = segIds[Math.min(startPos, endPos)] ?? annotRangeStart;
    const hi = segIds[Math.max(startPos, endPos)] ?? endWordId;

    // Optimistic clear
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
          book,
          chapter,
          source: textSource,
        }),
      });
      const { annotation } = await resp.json();
      setLineAnnotations((prev) => [...prev, annotation]);
    } catch {
      // non-critical, silently ignore — annotation just won't appear
    }
  }

  async function handleDeleteAnnotation(id: number) {
    // Optimistic
    setLineAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch("/api/line-annotations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // non-critical
    }
  }

  async function handleUpdateAnnotation(
    id: number,
    updates: { label?: string; color?: string; description?: string | null; outOfSequence?: boolean }
  ) {
    setLineAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
    try {
      await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
    } catch {
      // non-critical
    }
  }

  /** Expand or shrink the start/end boundary of an annotation by one paragraph segment. */
  async function handleExpandAnnotationRange(
    id: number,
    direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end"
  ) {
    const ann = lineAnnotations.find((a) => a.id === id);
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
    if (newStartPos === startPos && newEndPos === endPos) return; // already at limit

    const newStart = segIds[newStartPos];
    const newEnd   = segIds[newEndPos];
    if (!newStart || !newEnd) return;

    setLineAnnotations((prev) => prev.map((a) =>
      a.id === id ? { ...a, startWordId: newStart, endWordId: newEnd } : a
    ));
    try {
      await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startWordId: newStart, endWordId: newEnd }),
      });
    } catch {
      // rollback
      setLineAnnotations((prev) => prev.map((a) =>
        a.id === id ? { ...a, startWordId: ann.startWordId, endWordId: ann.endWordId } : a
      ));
    }
  }

  // Core ref toggle logic — works for both source words and translation words.
  // `source` is the textSource string stored in the DB (e.g. "OSHB", "KJV").
  async function handleToggleCharacterRefById(wordId: string, source: string) {
    if (activeCharId === null) return;

    // Capture the state before any change for undo
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
              body: JSON.stringify({ wordId, character1Id: null, book, chapter, source }),
            });
          } else {
            await fetch("/api/character-refs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                wordId,
                character1Id: beforeRef.character1Id,
                character2Id: beforeRef.character2Id ?? null,
                book, chapter, source,
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
      // No ref → add with character1
      nextRef = {
        id: -1, wordId, character1Id: activeCharId,
        character2Id: null, textSource: source, book, chapter, workspaceId: 0,
      };
    } else if (existing.character1Id === activeCharId) {
      if (existing.character2Id !== null) {
        // Remove character1, promote character2
        nextRef = { ...existing, character1Id: existing.character2Id, character2Id: null };
      } else {
        // Only character1 → remove entirely
        shouldRemove = true;
      }
    } else if (existing.character2Id === activeCharId) {
      // Remove character2
      nextRef = { ...existing, character2Id: null };
    } else if (existing.character2Id === null) {
      // Add as character2
      nextRef = { ...existing, character2Id: activeCharId };
    } else {
      // Both slots occupied → replace character1
      nextRef = { ...existing, character1Id: activeCharId };
    }

    // Optimistic update
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
          body: JSON.stringify({ wordId, character1Id: null, book, chapter, source }),
        });
      } else if (nextRef) {
        await fetch("/api/character-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wordId,
            character1Id: nextRef.character1Id,
            character2Id: nextRef.character2Id,
            book, chapter, source,
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

  // Called when a translation word is clicked in refs-editing, word-tag-editing,
  // or formatting mode.
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

  // ── Word / concept tag handlers ──────────────────────────────────────────

  async function handleToggleWordTagRefById(wordId: string, source: string) {
    if (activeWordTagId === null) return;
    const existing = wordTagRefMap.get(wordId);
    const isRemove = existing?.tagId === activeWordTagId;
    const tagId = isRemove ? null : activeWordTagId;

    // Optimistic update
    setWordTagRefMap((prev) => {
      const next = new Map(prev);
      if (isRemove) next.delete(wordId);
      else next.set(wordId, { id: -1, wordId, tagId: activeWordTagId!, textSource: source, book, chapter, workspaceId: 0 });
      return next;
    });

    try {
      await fetch("/api/word-tag-refs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, tagId, book, chapter, source }),
      });
    } catch {
      // Rollback
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
    if (pendingWordTag && pendingWordTagColor !== null) {
      // "Word" type: create a new tag named after the lemma and immediately tag this word.
      // For Hebrew words use the lexicon lookup (same as the interlinear label); for Greek
      // word.lemma already holds the Greek text.
      const lemma = word.language === "hebrew"
        ? ((hebrewLemmas as Record<string, string>)[word.strongNumber ?? ""]
            ?? word.surfaceText?.replace(/\//g, "")
            ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      await handleCreateTag("word", lemma, pendingWordTagColor, word.wordId, textSource);
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
    firstWordSource?: string
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0,
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, type, book }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

      // If a source word was provided, create the ref immediately
      if (firstWordId && firstWordSource) {
        const ref: WordTagRef = {
          id: -1, wordId: firstWordId, tagId: realTag.id,
          textSource: firstWordSource, book, chapter, workspaceId: 0,
        };
        setWordTagRefMap((prev) => new Map(prev).set(firstWordId, ref));
        await fetch("/api/word-tag-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: firstWordId, tagId: realTag.id, book, chapter, source: firstWordSource }),
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
    // Remove all refs for this tag
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
            body: JSON.stringify({ book, chapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    // Optimistic update
    setSpeechSections((prev) =>
      prev.map((s) => s.id === sectionId ? { ...s, characterId: newCharId } : s)
    );
    try {
      const res = await fetch("/api/speech-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, characterId: newCharId, book, chapter, source: textSource }),
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
            body: JSON.stringify({ book, chapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    setSpeechSections((prev) => prev.filter((s) => s.id !== sectionId));
    try {
      const res = await fetch("/api/speech-sections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: section.startWordId, book, chapter, source: textSource }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  async function handleToggleSpeechSection(word: Word, _shiftHeld = false) {
    if (activeCharId === null) return;

    // ── Helpers: split verse words into paragraph segments ─────────────────
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

    // Snap to paragraph boundaries instead of verse boundaries
    const clickedVerseWords = verseGroups.get(word.verse) ?? [word];
    const clickedSeg = findSeg(word.wordId, clickedVerseWords);

    // First click: record the first word of the clicked paragraph as range start
    if (!speechRangeStart) {
      setSpeechRangeStart(clickedSeg[0]);
      return;
    }

    // Second click: snap to the paragraph segment's last word; handle reverse order
    const startVerseWords = verseGroups.get(speechRangeStart.verse) ?? [speechRangeStart];
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

    // Snapshot before create (for undo)
    const beforeSections = [...speechSections];
    pushUndo({
      label: "Add speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book, chapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    // Optimistic: add a temporary section
    const tempSection: SpeechSection = {
      id: Date.now(), characterId: activeCharId,
      startWordId: orderedStart, endWordId: orderedEnd,
      textSource, book, chapter, workspaceId: 0,
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
          book, chapter, source: textSource,
        }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  async function handleCreateCharacter(name: string, color: string) {
    // Optimistic: add placeholder
    const tempChar: Character = {
      id: -(Date.now()), book, name, color,
      createdAt: new Date().toISOString(), workspaceId: 0,
    };
    setCharacters((prev) => [...prev, tempChar]);
    setActiveCharId(tempChar.id);

    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, book }),
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
    // Clean up refs and speech sections for this character
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

  // ── Indent handlers ────────────────────────────────────────────────────────

  async function handleSetIndent(paraStartWordId: string, level: number) {
    const prevLevel = lineIndentMap.get(paraStartWordId) ?? 0;
    const prevTvLevel = tvLineIndentMap.get(paraStartWordId) ?? 0;
    // Optimistic update — source
    setLineIndentMap((prev) => {
      const next = new Map(prev);
      if (level <= 0) next.delete(paraStartWordId);
      else next.set(paraStartWordId, level);
      return next;
    });
    // When linked, mirror into translation map
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
        body: JSON.stringify({ wordId: paraStartWordId, indentLevel: level, textSource, book, chapter }),
      });
      if (indentsLinked) {
        await fetch("/api/line-indents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book, chapter }),
        });
      }
    } catch {
      // Rollback on error
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
        body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book, chapter }),
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

  // ── RST relation handlers ────────────────────────────────────────────────
  function handleSelectRstSegment(wordId: string) {
    if (!rstSegA) {
      setRstSegA(wordId);
    } else if (wordId === rstSegA) {
      // Click same segment again → deselect and reset
      setRstSegA(null);
      setRstSegB(null);
      setShowRstPicker(false);
    } else {
      setRstSegB(wordId);
      setRstRolesSwapped(false);
      setShowRstPicker(true);
    }
  }

  /** Select an existing RST group as an endpoint by resolving its nucleus segWordId. */
  function handleSelectRstGroup(groupId: string) {
    const nucleusRow = rstRelations.find(r => r.groupId === groupId && r.role === "nucleus")
      ?? rstRelations.find(r => r.groupId === groupId);
    if (nucleusRow) handleSelectRstSegment(nucleusRow.segWordId);
  }

  async function handleCreateRstRelation(relType: string) {
    if (!rstSegA || !rstSegB) return;
    const relMeta  = RELATIONSHIP_MAP[relType];
    const category = relMeta?.category ?? "subordinate";
    const isCoord  = category === "coordinate";

    // Determine active side for unlinked mode
    const editingTv   = !rstRelationsLinked && rstEditingSide === "translation";
    const activeRels  = editingTv ? tvRstRelations : rstRelations;
    const setActive   = editingTv ? setTvRstRelations : setRstRelations;
    const activeSrc   = editingTv ? `tv:${textSource}` : textSource;

    let members: { segWordId: string; role: "nucleus" | "satellite"; sortOrder: number }[];
    if (isCoord) {
      const existingGroup = activeRels.find(
        (r) => r.segWordId === rstSegA && r.relType === relType && r.role === "nucleus"
      );
      if (existingGroup) {
        const groupId  = existingGroup.groupId;
        const maxOrder = activeRels
          .filter((r) => r.groupId === groupId)
          .reduce((m, r) => Math.max(m, r.sortOrder), 0);
        const extMember = [{ segWordId: rstSegB, role: "nucleus" as const, sortOrder: maxOrder + 1 }];

        const resp = await fetch("/api/rst-relations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, members: extMember, relType, book, chapter, source: activeSrc }),
        });
        const { relations: newRels } = await resp.json();
        setActive((prev) => [...prev, ...newRels]);

        if (rstRelationsLinked) {
          const tvMax = tvRstRelations.filter((r) => r.groupId === groupId).reduce((m, r) => Math.max(m, r.sortOrder), 0);
          const respTv = await fetch("/api/rst-relations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId, members: [{ segWordId: rstSegB, role: "nucleus" as const, sortOrder: tvMax + 1 }], relType, book, chapter, source: `tv:${textSource}` }),
          });
          const { relations: newTvRels } = await respTv.json();
          setTvRstRelations((prev) => [...prev, ...newTvRels]);
        }

        setRstSegB(null);
        setShowRstPicker(false);
        return;
      }
      members = [
        { segWordId: rstSegA, role: "nucleus",  sortOrder: 0 },
        { segWordId: rstSegB, role: "nucleus",  sortOrder: 1 },
      ];
    } else {
      const nucleusId   = rstRolesSwapped ? rstSegB : rstSegA;
      const satelliteId = rstRolesSwapped ? rstSegA : rstSegB;
      members = [
        { segWordId: nucleusId,   role: "nucleus",   sortOrder: 0 },
        { segWordId: satelliteId, role: "satellite",  sortOrder: 1 },
      ];
    }

    const groupId = crypto.randomUUID();
    const resp = await fetch("/api/rst-relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, members, relType, book, chapter, source: activeSrc }),
    });
    const { relations: newRels } = await resp.json();
    setActive((prev) => [...prev, ...newRels]);

    if (rstRelationsLinked) {
      const respTv = await fetch("/api/rst-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, members, relType, book, chapter, source: `tv:${textSource}` }),
      });
      const { relations: newTvRels } = await respTv.json();
      setTvRstRelations((prev) => [...prev, ...newTvRels]);
    }

    setRstSegB(null);
    setRstRolesSwapped(false);
    setShowRstPicker(false);
  }

  function handleCancelRstPicker() {
    setShowRstPicker(false);
    setRstSegB(null);
    setRstRolesSwapped(false);
  }

  /** Called when the user clicks a relation chip label to change its type. */
  function handleEditRstGroup(groupId: string) {
    setRstEditGroupId(groupId);
    // Clear any in-progress "create new relation" state so the two pickers don't conflict.
    setShowRstPicker(false);
    setRstSegA(null);
    setRstSegB(null);
    setRstRolesSwapped(false);
  }

  /** Apply the new type to an existing group (PATCH API + local state update). */
  async function handleUpdateRstGroupType(relType: string) {
    if (!rstEditGroupId) return;
    await fetch("/api/rst-relations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: rstEditGroupId, relType }),
    });
    // Update both arrays; when unlinked only one has this groupId — safe either way.
    setRstRelations((prev) =>
      prev.map((r) => r.groupId === rstEditGroupId ? { ...r, relType } : r)
    );
    setTvRstRelations((prev) =>
      prev.map((r) => r.groupId === rstEditGroupId ? { ...r, relType } : r)
    );
    setRstEditGroupId(null);
  }

  async function handleDeleteRstGroup(groupId: string) {
    await fetch("/api/rst-relations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    // Filter both arrays; when unlinked only one will have this groupId — safe either way.
    setRstRelations((prev) => prev.filter((r) => r.groupId !== groupId));
    setTvRstRelations((prev) => prev.filter((r) => r.groupId !== groupId));
  }

  // ── Word arrow handlers ────────────────────────────────────────────────────
  // Works with any wordId — source words (e.g. "OSHB.1") or translation tokens
  // (e.g. "tv:ESV:Gen.1.1.0"). Called directly for translation words and via
  // handleSelectArrowWord for source Word objects.
  async function handleSelectArrowWordById(wordId: string) {
    if (!arrowFromWordId) {
      setArrowFromWordId(wordId);
      return;
    }
    if (arrowFromWordId === wordId) {
      setArrowFromWordId(null);
      return;
    }
    const resp = await fetch("/api/word-arrows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWordId: arrowFromWordId,
        toWordId:   wordId,
        book,
        chapter,
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

  // ── Word formatting (bold / italic) handler ────────────────────────────────

  // ── Interlinear annotation handlers ────────────────────────────────────────

  async function handleSaveConstituentLabel(wordId: string, label: string | null) {
    // Optimistic update
    setConstituentLabelMap((prev) => {
      const next = new Map(prev);
      if (label === null) next.delete(wordId);
      else next.set(wordId, label);
      return next;
    });
    try {
      if (label === null) {
        await fetch("/api/interlinear/constituent-labels", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId }),
        });
      } else {
        await fetch("/api/interlinear/constituent-labels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId, label, textSource, book, chapter }),
        });
      }
    } catch { /* ignore */ }
  }

  async function handleSaveDatasetEntry(wordId: string, value: string | null) {
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    // Optimistic update
    setDatasetEntryMap((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(wordId);
      else next.set(wordId, value);
      return next;
    });
    try {
      if (value === null) {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId }),
        });
      } else {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, value, textSource, book, chapter }),
        });
      }
    } catch { /* ignore */ }
  }

  async function handleCreateDataset(name: string): Promise<{ id: number; name: string } | null> {
    try {
      const res  = await fetch("/api/interlinear/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: 1, name }),
      });
      const ds   = await res.json() as { id: number; name: string };
      setDatasets((prev) => [...prev, ds]);
      return ds;
    } catch {
      return null;
    }
  }

  async function handleDeleteDataset(id: number) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    try {
      await fetch(`/api/interlinear/datasets/${id}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  async function handleRenameDataset(id: number, name: string) {
    setDatasets((prev) => prev.map((d) => d.id === id ? { ...d, name } : d));
    // If active dataset, update subMode name
    if (typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset" && interlinearSubMode.id === id) {
      setInterlinearSubMode({ type: "dataset", id, name });
    }
    try {
      await fetch(`/api/interlinear/datasets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch { /* ignore */ }
  }

  async function handleUploadDatasetFile(datasetId: number, file: File) {
    const text = await file.text();
    const entries: { wordId: string; value: string; textSource: string; book: string; chapter: number }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("\t");
      if (sep < 1) continue;
      const wordId = trimmed.slice(0, sep).trim();
      const value  = trimmed.slice(sep + 1).trim();
      if (wordId && value) entries.push({ wordId, value, textSource, book, chapter });
    }
    if (entries.length === 0) return;
    try {
      await fetch(`/api/interlinear/datasets/${datasetId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      // Reload entries if this is the active dataset
      if (typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset" && interlinearSubMode.id === datasetId) {
        const res  = await fetch(`/api/interlinear/datasets/${datasetId}/entries?book=${encodeURIComponent(book)}&chapter=${chapter}&textSource=${encodeURIComponent(textSource)}`);
        const rows = await res.json() as { wordId: string; value: string }[];
        setDatasetEntryMap(new Map(rows.map((r) => [r.wordId, r.value])));
      }
    } catch { /* ignore */ }
    setUploadDatasetId(null);
  }

  // Core toggle — shared by source words (source = textSource) and translation
  // words (source = translation abbreviation, e.g. "ESV").
  async function handleToggleFormattingById(wordId: string, source: string) {
    const existing = wordFormattingMap.get(wordId) ?? { isBold: false, isItalic: false };
    const nextBold   = editingBold   ? !existing.isBold   : existing.isBold;
    const nextItalic = editingItalic ? !existing.isItalic : existing.isItalic;

    // Optimistic update
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
        body: JSON.stringify({ wordId, isBold: nextBold, isItalic: nextItalic, textSource: source, book, chapter }),
      });
    } catch {
      // Rollback on error
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

  // ── Translation verse text edit handler ────────────────────────────────────
  async function handleUpdateTranslationVerse(abbr: string, verse: number, newText: string, record = true) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);
    if (!tvRecord) return;

    const oldText = tvRecord.text;
    if (record && newText !== oldText) {
      pushUndo({
        label: `Edit translation ${abbr} ${verse}`,
        undo: () => handleUpdateTranslationVerse(abbr, verse, oldText, false),
      });
    }

    // Optimistic update
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
      // Rollback on network error
      setLocalTranslationVerseData((prev) => ({
        ...prev,
        [translation.id]: (prev[translation.id] ?? []).map((tv) =>
          tv.verse === verse ? { ...tv, text: oldText } : tv
        ),
      }));
    }
  }

  // Revert a verse back to the text it had when translation editing mode was entered
  async function handleCancelTranslationVerse(abbr: string, verse: number) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const snapshot = translationEditSnapshotRef.current;
    const snapRecord = snapshot[translation.id]?.find((tv) => tv.verse === verse);
    if (!snapRecord) return;
    await handleUpdateTranslationVerse(abbr, verse, snapRecord.text, false);
  }

  // ── Mode mutual-exclusivity ────────────────────────────────────────────────
  // Compatible groups (may be active simultaneously):
  //   A: paragraph + indent
  //   B: bold + italic
  //   C: speech + rst + indent
  // All other combinations are mutually incompatible.
  // Modes that are mutually exclusive with each other (only one may be active):
  //   refs, speech, arrows, wordTags
  // Each lists everything it is COMPATIBLE with — i.e., everything except the
  // other three annotation-editing modes.
  const NON_ANNOTATION = ["paragraph", "scenes", "annotations", "indents", "rst", "bold", "italic"] as const;
  const COMPAT: Record<string, string[]> = {
    paragraph:   ["indents"],
    indents:     ["paragraph", "speech", "rst"],
    bold:        ["italic"],
    italic:      ["bold"],
    speech:      ["rst", "indents", ...NON_ANNOTATION],
    rst:         ["speech", "indents"],
    arrows:      [...NON_ANNOTATION],
    scenes:      [],
    annotations: [],
    refs:        [...NON_ANNOTATION],
    wordTags:    [...NON_ANNOTATION],
  };
  function deactivateIncompatible(mode: string) {
    const keep = new Set([mode, ...(COMPAT[mode] ?? [])]);
    if (!keep.has("paragraph"))   setEditingParagraphs(false);
    if (!keep.has("scenes"))      setEditingScenes(false);
    if (!keep.has("annotations")) { setEditingAnnotations(false); setAnnotRangeStart(null); setAnnotRangeEnd(null); }
    if (!keep.has("refs"))        setEditingRefs(false);
    if (!keep.has("speech"))      { setEditingSpeech(false); setSpeechRangeStart(null); }
    if (!keep.has("wordTags"))    { setEditingWordTags(false); setPendingWordTag(false); }
    if (!keep.has("indents"))     setEditingIndents(false);
    if (!keep.has("rst"))         { setEditingRst(false); setRstSegA(null); setRstSegB(null); setShowRstPicker(false); setRstEditGroupId(null); }
    if (!keep.has("arrows"))      { setEditingArrows(false); setArrowFromWordId(null); }
    if (!keep.has("bold"))        setEditingBold(false);
    if (!keep.has("italic"))      setEditingItalic(false);
  }

  return (
    <div className="relative h-full min-h-0 flex flex-row">
      {/* Main text area — takes remaining width; notes pane sits to the right */}
      <div className="flex-1 min-w-0 relative min-h-0 flex flex-col" ref={outerRef}>
        {/* Scrollable text container — both overlays live INSIDE so they scroll
            with the content and use stable scroll-canvas coordinates. */}
        <div
          className="flex-1 overflow-y-auto relative flex flex-col min-h-0"
          ref={textContainerRef}
        >
          <RstRelationOverlay
            relations={rstRelations}
            tvRelations={!rstRelationsLinked ? tvRstRelations : undefined}
            editingTranslation={editingRst && !rstRelationsLinked && rstEditingSide === "translation"}
            containerRef={textContainerRef}
            layoutRef={outerRef}
            isHebrew={isHebrew}
            hasTranslation={hasActiveTranslations}
            hideSourceTree={hideSourceText}
            editing={editingRst}
            paragraphFirstWordIds={paragraphFirstWordIds}
            selectedNucleusWordId={rstSegA}
            selectedSatelliteWordId={rstSegB}
            editingGroupId={rstEditGroupId}
            onSelectSegment={handleSelectRstSegment}
            onDeleteGroup={handleDeleteRstGroup}
            onEditGroup={handleEditRstGroup}
            onSelectGroup={handleSelectRstGroup}
            customTypes={customRstTypes}
          />
          <WordArrowOverlay
            arrows={wordArrowsState}
            containerRef={textContainerRef}
            layoutRef={outerRef}
            editing={editingArrows}
            selectedFromWordId={arrowFromWordId}
            onDeleteArrow={handleDeleteWordArrow}
            isHebrew={isHebrew}
          />
        {/* Chapter heading strip — hidden in presentation mode */}
        {!presentationMode && headingSlot}

        {/* Sticky control area: toolbar + all editing panels/hints */}
        <div className="sticky top-0 z-20 shrink-0 flex flex-col" style={{ backgroundColor: "var(--background)" }}>

        {/* Toolbar */}
        <div className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4 flex-wrap">

          {/* Presentation mode toggle — always visible */}
          <button
            onClick={() => {
              const entering = !presentationMode;
              setPresentationMode(entering);
              if (entering) {
                setEditingParagraphs(false);
                setEditingScenes(false);
                setEditingAnnotations(false);
                setEditingSpeech(false);
                setEditingIndents(false);
                setEditingRst(false);
                setEditingArrows(false);
                setEditingBold(false);
                setEditingItalic(false);
                setEditingTranslation(false);
                setSpeechRangeStart(null);
                setRstSegA(null);
                setRstSegB(null);
                setShowRstPicker(false);
                setArrowFromWordId(null);
                setNotesOpen(false);
                setPanelOpen(false);
              }
            }}
            title={presentationMode ? t("toolbar.titlePresentationOn") : t("toolbar.titlePresentationOff")}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              presentationMode
                ? "bg-sky-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ⊞
          </button>

          {!presentationMode && (
            <>
              <DisplayModeToggle mode={displayMode} onChange={setDisplayMode} />
              {displayMode === "color" && (
                <>
                  <GrammarFilter filter={grammarFilter} onChange={setGrammarFilter} />
                  <ColorRulePanel rules={colorRules} onChange={setColorRules} isHebrew={isHebrew} />
                </>
              )}
              {displayMode === "interlinear" && (
                <InterlinearSubModePicker
                  subMode={interlinearSubMode}
                  onChange={setInterlinearSubMode}
                  datasets={datasets}
                  onCreateDataset={handleCreateDataset}
                  onDeleteDataset={handleDeleteDataset}
                  onRenameDataset={handleRenameDataset}
                  onUploadDataset={(id) => {
                    setUploadDatasetId(id);
                    // Trigger hidden file input
                    setTimeout(() => uploadInputRef.current?.click(), 0);
                  }}
                />
              )}
              <button
                onClick={() => setShowTooltips((v) => !v)}
                title={showTooltips ? t("toolbar.titleTooltipsOn") : t("toolbar.titleTooltipsOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  showTooltips
                    ? "bg-blue-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                {t("toolbar.tooltips")}
              </button>

              {isHebrew && (
                <>
                  <button
                    onClick={() => setShowAtnachBreaks((v) => !v)}
                    title={showAtnachBreaks
                      ? "Hide atnach half-verse markers"
                      : "Show atnach accent markers (main cantillation accent dividing each verse)"}
                    className={[
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      showAtnachBreaks
                        ? "bg-violet-600 text-white"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                    ].join(" ")}
                  >
                    Atnach
                  </button>
                  <button
                    onClick={handleAddAtnachParagraphBreaks}
                    title="Insert paragraph breaks at every atnach accent in this chapter"
                    className="px-2.5 py-1 rounded text-xs font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                  >
                    ¶ Atnach
                  </button>
                </>
              )}

              {/* Paragraph edit mode toggle */}
              <button
                onClick={() => { if (!editingParagraphs) deactivateIncompatible("paragraph"); setEditingParagraphs((v) => !v); }}
                title={editingParagraphs
                  ? t("toolbar.titleParagraphOn")
                  : t("toolbar.titleParagraphOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingParagraphs
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ¶
              </button>

              {/* Scene / episode break mode */}
              <button
                onClick={() => { if (editingScenes) { handleExitSceneEditing(); } else { deactivateIncompatible("scenes"); setEditingScenes(true); } }}
                title={editingScenes
                  ? t("toolbar.titleSectionOn")
                  : t("toolbar.titleSectionOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingScenes
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                §
              </button>

              {/* Line annotation mode */}
              <button
                onClick={() => {
                  if (!editingAnnotations) deactivateIncompatible("annotations");
                  setEditingAnnotations((v) => !v);
                }}
                title={editingAnnotations
                  ? t("toolbar.titleAnnotationOn")
                  : t("toolbar.titleAnnotationOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingAnnotations
                    ? "bg-indigo-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ≡
              </button>
            </>
          )}

          {/* Character reference tag mode — always visible */}
          <button
            onClick={() => {
              if (!editingRefs) deactivateIncompatible("refs");
              setEditingRefs((v) => !v);
            }}
            title={editingRefs ? t("toolbar.titleRefsOn") : t("toolbar.titleRefsOff")}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRefs
                ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            👤
          </button>

          {!presentationMode && (
            /* Speech section tag mode */
            <button
              onClick={() => {
                if (!editingSpeech) deactivateIncompatible("speech");
                setEditingSpeech((v) => !v);
              }}
              title={editingSpeech
                ? t("toolbar.titleSpeechOn")
                : t("toolbar.titleSpeechOff")}
              className={[
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                editingSpeech
                  ? "bg-violet-600 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >
              💬
            </button>
          )}

          {/* Word / concept tag mode — always visible */}
          <button
            onClick={() => {
              if (!editingWordTags) deactivateIncompatible("wordTags");
              setEditingWordTags((v) => !v);
            }}
            title={editingWordTags
              ? t("toolbar.titleWordTagOn")
              : t("toolbar.titleWordTagOff")}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingWordTags
                ? "bg-yellow-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            🏷
          </button>

          {!presentationMode && (
            <>
              {/* Paragraph indent mode */}
              <button
                onClick={() => {
                  if (!editingIndents) deactivateIncompatible("indents");
                  setEditingIndents((v) => !v);
                }}
                title={editingIndents
                  ? t("toolbar.titleIndentOn")
                  : t("toolbar.titleIndentOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingIndents
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ⇥
              </button>

              {/* Source/translation indent link toggle — visible only in indent mode */}
              {editingIndents && (
                <label
                  className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
                  title={indentsLinked
                    ? t("toolbar.titleIndentLinked")
                    : t("toolbar.titleIndentUnlinked")}
                >
                  <input
                    type="checkbox"
                    checked={indentsLinked}
                    onChange={(e) => {
                      const nowLinked = e.target.checked;
                      setIndentsLinked(nowLinked);
                      if (!nowLinked) {
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
                  {t("toolbar.indentLinkLabel")}
                </label>
              )}

              {/* RST relation mode */}
              <button
                onClick={() => {
                  const entering = !editingRst;
                  if (entering) {
                    deactivateIncompatible("rst");
                  } else {
                    setRstSegA(null);
                    setRstSegB(null);
                    setShowRstPicker(false);
                    setRstEditGroupId(null);
                    setShowRstTypeManager(false);
                  }
                  setEditingRst(entering);
                }}
                title={editingRst
                  ? t("toolbar.titleRstOn")
                  : t("toolbar.titleRstOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingRst
                    ? "bg-rose-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ↳
              </button>
              {editingRst && (
                <button
                  onClick={() => setShowRstTypeManager((v) => !v)}
                  title={t("toolbar.titleRstLabels")}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    showRstTypeManager
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  {t("toolbar.rstLabels")}
                </button>
              )}
              {editingRst && hasActiveTranslations && (
                <>
                  <label
                    className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
                    title={rstRelationsLinked ? t("toolbar.titleRstLinked") : t("toolbar.titleRstUnlinked")}
                  >
                    <input
                      type="checkbox"
                      checked={rstRelationsLinked}
                      onChange={(e) => {
                        const nowLinked = e.target.checked;
                        setRstRelationsLinked(nowLinked);
                        if (nowLinked) setRstEditingSide("source");
                      }}
                      className="w-3 h-3 accent-rose-600 cursor-pointer"
                    />
                    {t("toolbar.rstLinkLabel")}
                  </label>
                  {!rstRelationsLinked && (
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => setRstEditingSide("source")}
                        title={t("toolbar.titleRstSrcSide")}
                        className={[
                          "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                          rstEditingSide === "source"
                            ? "bg-rose-600 text-white"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
                        ].join(" ")}
                      >
                        Src
                      </button>
                      <button
                        onClick={() => setRstEditingSide("translation")}
                        title={t("toolbar.titleRstTransSide")}
                        className={[
                          "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                          rstEditingSide === "translation"
                            ? "bg-rose-600 text-white"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
                        ].join(" ")}
                      >
                        Trans
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Word arrow mode */}
              <button
                onClick={() => {
                  const entering = !editingArrows;
                  if (entering) {
                    deactivateIncompatible("arrows");
                  } else {
                    setArrowFromWordId(null);
                  }
                  setEditingArrows(entering);
                }}
                title={editingArrows
                  ? t("toolbar.titleArrowOn")
                  : t("toolbar.titleArrowOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  editingArrows
                    ? "bg-rose-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ↷
              </button>

              {/* Undo button */}
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
                  title={t("toolbar.titleUndo", { label: undoStack[undoStack.length - 1].label })}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  ↩ {undoStack[undoStack.length - 1].label}
                </button>
              )}

              {/* Bold formatting mode */}
              <button
                onClick={() => {
                  if (!editingBold) deactivateIncompatible("bold");
                  setEditingBold((v) => !v);
                }}
                title={editingBold ? t("toolbar.titleBoldOn") : t("toolbar.titleBoldOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs font-bold transition-colors",
                  editingBold
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                B
              </button>

              {/* Italic formatting mode */}
              <button
                onClick={() => {
                  if (!editingItalic) deactivateIncompatible("italic");
                  setEditingItalic((v) => !v);
                }}
                title={editingItalic ? t("toolbar.titleItalicOn") : t("toolbar.titleItalicOff")}
                className={[
                  "px-2.5 py-1 rounded text-xs italic transition-colors",
                  editingItalic
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                I
              </button>

              {/* Clear annotations */}
              <div className="border-l border-[var(--border)] pl-3 ml-1">
                <button
                  onClick={() => setShowClearDialog(true)}
                  title={t("toolbar.titleClear")}
                  className="px-2.5 py-1 rounded text-xs font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                >
                  🗑
                </button>
              </div>

              {/* Notes panel toggle */}
              <div className="border-l border-[var(--border)] pl-3 ml-1">
                <button
                  onClick={() => setNotesOpen((v) => !v)}
                  title={notesOpen ? t("toolbar.titleNotesOn") : t("toolbar.titleNotesOff")}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    notesOpen
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  📝
                </button>
              </div>

              {/* Search panel toggle */}
              <div className="border-l border-[var(--border)] pl-3 ml-1">
                <button
                  onClick={() => setSearchOpen((v) => !v)}
                  title={searchOpen ? "Close Search" : "Search corpus"}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    searchOpen
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  🔍
                </button>
              </div>

              {/* Copy outline to clipboard */}
              {(sceneBreakMap.size > 0 || bookSceneBreaks.length > 0) && (
                <button
                  type="button"
                  onClick={handleExportOutline}
                  className="shrink-0 text-xs px-2 py-1 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors bg-stone-100 dark:bg-stone-800"
                  style={{ color: "var(--text-muted)" }}
                  title={t("toolbar.titleCopyOutline")}
                >
                  {outlineCopied ? t("toolbar.outlineCopied") : t("toolbar.outline")}
                </button>
              )}

              {/* Linguistic terms toggle — Hebrew only */}
              {isHebrew && (
                <button
                  onClick={() => setUseLinguisticTerms((v) => !v)}
                  title={useLinguisticTerms
                    ? t("toolbar.titleLinguisticOn")
                    : t("toolbar.titleLinguisticOff")}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    useLinguisticTerms
                      ? "bg-blue-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  Qatal
                </button>
              )}

              {/* Translation picker + source visibility toggle + translation edit */}
              {allAvailableTranslations.length > 0 && (
                <div className="flex items-center gap-1 border-l border-[var(--border)] pl-4">
                  <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">
                    {t("toolbar.trLabel")}
                  </span>
                  <TranslationPicker
                    availableTranslations={allAvailableTranslations}
                    activeTranslationIds={activeTranslationIds}
                    systemTranslationIds={systemTranslationIds}
                    onToggle={toggleTranslation}
                  />
                  {hasActiveTranslations && (
                    <button
                      onClick={() => setHideSourceText((v) => !v)}
                      title={hideSourceText ? t("toolbar.titleShowSource", { source: textSource }) : t("toolbar.titleHideSource", { source: textSource })}
                      className={[
                        "px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                        !hideSourceText
                          ? "bg-emerald-600 text-white"
                          : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                      ].join(" ")}
                    >
                      {textSource}
                    </button>
                  )}
                  {hasActiveTranslations && (
                    <button
                      onClick={() => setEditingTranslation((v) => !v)}
                      title={editingTranslation ? t("toolbar.titleEditTranslationOn") : t("toolbar.titleEditTranslationOff")}
                      className={[
                        "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                        editingTranslation
                          ? "bg-sky-600 text-white"
                          : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                      ].join(" ")}
                    >
                      ✏
                    </button>
                  )}
                </div>
              )}

              {/* Font size controls */}
              {(() => {
                const sizeBtn = "w-6 h-6 flex items-center justify-center rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors select-none";
                return (
                  <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                    <span className="text-xs text-stone-400 dark:text-stone-500 select-none">
                      {isHebrew ? t("toolbar.sourceLabel") : t("toolbar.sourceLabelGk")}
                    </span>
                    <button className={sizeBtn} onClick={() => adjustFontSize("source", -0.125)} title={t("toolbar.titleDecreaseSource")}>A−</button>
                    <button className={sizeBtn} onClick={() => adjustFontSize("source", +0.125)} title={t("toolbar.titleIncreaseSource")}>A+</button>
                    {hasActiveTranslations && (
                      <>
                        <span className="text-xs text-stone-400 dark:text-stone-500 select-none ml-1">{t("toolbar.trSizeLabel")}</span>
                        <button className={sizeBtn} onClick={() => adjustFontSize("translation", -0.0625)} title={t("toolbar.titleDecreaseTr")}>A−</button>
                        <button className={sizeBtn} onClick={() => adjustFontSize("translation", +0.0625)} title={t("toolbar.titleIncreaseTr")}>A+</button>
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Character palette bar (shows when in ref or speech mode) */}
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
            {t("toolbar.hintSpeechRange")}
          </div>
        )}

        {/* Word/concept tag palette bar */}
        {editingWordTags && (
          <WordTagPanel
            tags={wordTags}
            activeTagId={activeWordTagId}
            highlightedTagIds={highlightWordTagIds}
            pendingWordTag={pendingWordTag}
            onSelectTag={(id) => {
              setActiveWordTagId(id);
              setPendingWordTag(false);
            }}
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
            {t("toolbar.hintPendingTag")}
          </div>
        )}

        {/* RST relation hint */}
        {editingRst && !showRstPicker && !rstEditGroupId && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {rstSegA
              ? t("toolbar.hintRstA")
              : t("toolbar.hintRstStart")}
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
                {t("toolbar.rstRelation")}
              </span>
              <span className="text-xs opacity-50 mr-0.5 select-none">{t("toolbar.rstCoord")}</span>
              {allRstTypes.filter((r) => r.category === "coordinate").map((r) => (
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
              <span className="text-xs opacity-50 mr-0.5 select-none">{t("toolbar.rstSub")}</span>
              {allRstTypes.filter((r) => r.category === "subordinate").map((r) => (
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
                {t("toolbar.cancel")}
              </button>
            </div>
            {/* Nucleus/satellite swap row (only relevant for subordinate) */}
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
              <span>{t("toolbar.rstRoles")}</span>
              <span className={`px-1.5 py-0.5 rounded font-medium ${!rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-stone-100 dark:bg-stone-800"}`}>
                {t("toolbar.rstSegA")} {rstRolesSwapped ? t("toolbar.rstSatellite") : t("toolbar.rstNucleus")}
              </span>
              <span>→</span>
              <span className={`px-1.5 py-0.5 rounded font-medium ${rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-stone-100 dark:bg-stone-800"}`}>
                {t("toolbar.rstSegB")} {rstRolesSwapped ? t("toolbar.rstNucleus") : t("toolbar.rstSatellite")}
              </span>
              <button
                onClick={() => setRstRolesSwapped((v) => !v)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
                title={t("toolbar.titleRstSwap")}
              >{t("toolbar.rstSwap")}</button>
              <span className="text-[10px] opacity-50">{t("toolbar.rstSubOnly")}</span>
            </div>
          </div>
        )}

        {/* RST edit relation type picker bar — shown when a chip label is clicked */}
        {rstEditGroupId && (
          <div
            className="border-b border-[var(--border)] px-4 py-2 shrink-0"
            style={{ backgroundColor: "var(--nav-bg)" }}
          >
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium mr-1" style={{ color: "var(--nav-fg-muted)" }}>
                {t("toolbar.rstChangeType")}
              </span>
              <span className="text-xs opacity-50 mr-0.5 select-none">{t("toolbar.rstCoord")}</span>
              {allRstTypes.filter((r) => r.category === "coordinate").map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleUpdateRstGroupType(r.key)}
                  className="px-2 py-0.5 rounded text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: r.color }}
                >
                  {r.label}
                </button>
              ))}
              <span className="text-xs opacity-30 mx-1 select-none">|</span>
              <span className="text-xs opacity-50 mr-0.5 select-none">{t("toolbar.rstSub")}</span>
              {allRstTypes.filter((r) => r.category === "subordinate").map((r) => (
                <button
                  key={r.key}
                  onClick={() => handleUpdateRstGroupType(r.key)}
                  className="px-2 py-0.5 rounded text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: r.color }}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={() => setRstEditGroupId(null)}
                className="ml-auto text-xs px-2 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
              >
                {t("toolbar.cancel")}
              </button>
            </div>
          </div>
        )}

        {/* RST type manager panel */}
        {editingRst && showRstTypeManager && (
          <RstTypeManager
            customTypes={customRstTypes}
            onAdd={async (entry) => {
              const res = await fetch("/api/rst-custom-types", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry),
              });
              if (res.ok) {
                const row: RstCustomType = await res.json();
                setCustomRstTypes((prev) => [...prev, row]);
              }
            }}
            onUpdate={async (id, updates) => {
              const res = await fetch("/api/rst-custom-types", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, ...updates }),
              });
              if (res.ok) {
                const row: RstCustomType = await res.json();
                setCustomRstTypes((prev) => prev.map((entry) => entry.id === id ? row : entry));
              }
            }}
            onDelete={async (id) => {
              await fetch(`/api/rst-custom-types?id=${id}`, { method: "DELETE" });
              setCustomRstTypes((prev) => prev.filter((entry) => entry.id !== id));
            }}
          />
        )}

        {/* Word arrow hint */}
        {editingArrows && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {arrowFromWordId
              ? t("toolbar.hintArrowTarget")
              : t("toolbar.hintArrowSource")}
          </div>
        )}

        {/* Scene break hint */}
        {editingScenes && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {t("toolbar.hintSectionBreak")}
          </div>
        )}

        {/* Annotation range-selection hint */}
        {editingAnnotations && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {annotRangeStart && !annotRangeEnd
              ? t("toolbar.hintAnnotRange")
              : annotRangeStart && annotRangeEnd
              ? t("toolbar.hintAnnotFill")
              : t("toolbar.hintAnnotStart")}
          </div>
        )}

        </div>{/* end sticky control area */}

        {/* Chapter text */}
        <div
          className={`py-6 flex-1 ${hasActiveTranslations ? "" : "max-w-3xl mx-auto w-full"}`}
          onClick={editingRst && rstSegA ? () => { setRstSegA(null); setRstSegB(null); setShowRstPicker(false); } : undefined}
          style={{
            paddingLeft:  "1.5rem",
            paddingRight: "1.5rem",
            "--hebrew-font-size": `${hebrewFontSize * (presentationMode ? 2 : 1)}rem`,
            "--greek-font-size": `${greekFontSize * (presentationMode ? 2 : 1)}rem`,
            "--translation-font-size": `${translationFontSize * (presentationMode ? 2 : 1)}rem`,
            "--source-row-height": `${(isHebrew ? hebrewFontSize : greekFontSize) * (presentationMode ? 2 : 1) * 2.0}rem`,
          } as React.CSSProperties}
        >
          {verseNums.map((verseNum) => {
            const vWords   = verseGroups.get(verseNum)   ?? [];
            const prevWords = verseGroups.get(verseNum - 1) ?? [];
            const nextWords = verseGroups.get(verseNum + 1) ?? [];
            return (
              <VerseDisplay
                key={verseNum}
                verseNum={verseNum}
                words={vWords}
                displayMode={displayMode}
                grammarFilter={grammarFilter}
                colorRules={colorRules}
                onSelectWord={handleSelectWord}
                selectedWordId={selectedWord?.wordId ?? null}
                isHebrew={isHebrew}
                showTooltips={showTooltips}
                translationTexts={activeTranslationVerseMap.get(verseNum) ?? []}
                useLinguisticTerms={useLinguisticTerms}
                paragraphBreakIds={paragraphBreakIds}
                editingParagraphs={editingParagraphs}
                showAtnachBreaks={showAtnachBreaks}
                characterRefMap={characterRefMap}
                characterMap={characterMap}
                wordSpeechMap={wordSpeechMap}
                prevVerseLastWordId={prevWords[prevWords.length - 1]?.wordId ?? null}
                nextVerseFirstWordId={nextWords[0]?.wordId ?? null}
                editingRefs={editingRefs}
                editingSpeech={editingSpeech}
                activeCharId={activeCharId}
                speechRangeStartWordId={speechRangeStart?.wordId ?? null}
                book={book}
                chapter={chapter}
                onSelectTranslationWord={handleSelectTranslationWord}
                onToggleTranslationParagraphBreak={handleToggleTranslationParagraphBreak}
                highlightCharIds={highlightCharIds}
                onDeleteSpeechSection={handleDeleteSpeechSection}
                onReassignSpeechSection={handleReassignSpeechSection}
                wordTagRefMap={wordTagRefMap}
                wordTagMap={wordTagMap}
                editingWordTags={editingWordTags}
                highlightWordTagIds={highlightWordTagIds}
                searchHits={searchHits}
                lineIndentMap={lineIndentMap}
                translationIndentMap={tvLineIndentMap}
                indentsLinked={indentsLinked}
                wordToParaStart={wordToParaStart}
                editingIndents={editingIndents}
                onSetSegmentIndent={handleSetIndent}
                onSetSegmentTvIndent={handleSetTvIndent}
                wordFormattingMap={wordFormattingMap}
                editingFormatting={editingBold || editingItalic}
                interlinearSubMode={interlinearSubMode}
                constituentLabelMap={constituentLabelMap}
                datasetEntryMap={datasetEntryMap}
                onSaveConstituentLabel={handleSaveConstituentLabel}
                onSaveDatasetEntry={handleSaveDatasetEntry}
                onLemmaClick={displayMode === "interlinear" && interlinearSubMode === "lemma" ? handleLemmaClick : undefined}
                hideSourceText={hideSourceText}
                editingTranslation={editingTranslation}
                onUpdateTranslationVerse={handleUpdateTranslationVerse}
                onCancelTranslationVerse={handleCancelTranslationVerse}
                editingArrows={editingArrows}
                onSelectArrowWordById={handleSelectArrowWordById}
                sceneBreakMap={sceneBreakMap}
                editingScenes={editingScenes}
                onToggleSceneBreak={handleToggleSceneBreak}
                onUpdateSceneHeading={handleUpdateSceneHeading}
                onUpdateSceneOutOfSequence={handleUpdateSceneOutOfSequence}
                onUpdateSceneExtendedThrough={handleUpdateSceneExtendedThrough}
                onChangeSceneBreakLevel={handleChangeSceneBreakLevel}
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
                showAnnotationCol={editingAnnotations || lineAnnotations.length > 0}
                onVerseClick={(v) => {
                  setNotesOpen(true);
                  setNotesScrollVerse(v);
                }}
                rstSourcePad={(rstRelations.length > 0 || editingRst) ? 48 : 0}
                presentationMode={presentationMode}
              />
            );
          })}
        </div>
      </div>
      </div> {/* end outerRef wrapper */}

      {/* Notes pane */}
      {notesOpen && !presentationMode && (
        <ResizablePane storageKey="pane-notes-width" defaultWidth={320} minWidth={200} maxWidth={700}>
          <NotesPane
            book={book}
            chapter={chapter}
            verses={verseNums}
            scrollToVerse={notesScrollVerse}
            onScrollHandled={() => setNotesScrollVerse(null)}
            onClose={() => setNotesOpen(false)}
          />
        </ResizablePane>
      )}

      {/* Search pane */}
      {searchOpen && !presentationMode && (
        <ResizablePane storageKey="pane-search-width" defaultWidth={340} minWidth={260} maxWidth={800}>
          <SearchPane
            book={book}
            textSource={textSource}
            onClose={() => { setSearchOpen(false); setSearchHits(new Set()); }}
            onResultsChange={handleSearchResults}
            onSaveComplete={handleSearchSaved}
            searchRequest={searchRequest}
          />
        </ResizablePane>
      )}

      {/* Morphology panel — flex sibling so it pushes content left instead of overlaying */}
      {panelOpen && !presentationMode && (
          <ResizablePane storageKey="pane-morphology-width" defaultWidth={288} minWidth={200} maxWidth={700}>
            <div className="flex flex-col h-full bg-[var(--background)] border-l border-[var(--border)] shadow-[-4px_0_16px_rgba(0,0,0,0.1)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
                <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                  {t("toolbar.wordAnalysis")}
                </h2>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
                  aria-label={t("toolbar.close")}
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <MorphologyPanel word={selectedWord} useLinguisticTerms={useLinguisticTerms} onSearchRequest={handleSearchFromWord} />
              </div>
            </div>
          </ResizablePane>
      )}

      {/* Clear annotations dialog */}
      {showClearDialog && (
        <ClearAnnotationsDialog
          scopeLabel={`${book} ${chapter}`}
          book={book}
          textSource={textSource}
          startChapter={chapter}
          endChapter={chapter}
          onClose={() => setShowClearDialog(false)}
          onCleared={handleAnnotationsCleared}
        />
      )}

      {/* Hidden file input for dataset upload */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && uploadDatasetId != null) {
            await handleUploadDatasetFile(uploadDatasetId, file);
          }
          // Reset so the same file can be re-uploaded if needed
          e.target.value = "";
        }}
      />
    </div>
  );
}
