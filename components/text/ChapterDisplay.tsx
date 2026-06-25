"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { getMtToKjvInstructions, getKjvVerseLabel } from "@/lib/versification/mt-kjv-mapping";
import { useRouter } from "next/navigation";
import type { Word, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, RstRelation, WordArrow, LineAnnotation } from "@/lib/db/schema";
import type { Translation, TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry, InterlinearSubMode } from "@/lib/morphology/types";
import VerseDisplay from "./VerseDisplay";
import FindBar from "./FindBar";
import MorphologyPanel from "./MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import InterlinearSubModePicker from "@/components/controls/InterlinearSubModePicker";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel from "@/components/controls/WordTagPanel";
import ChapterOverlays from "./ChapterOverlays";
import ClearAnnotationsDialog, { type ClearCategory } from "@/components/controls/ClearAnnotationsDialog";
import TranslationPicker from "@/components/controls/TranslationPicker";
import NotesPane from "@/components/notes/NotesPane";
import SearchPane from "@/components/search/SearchPane";
import OutlinePane from "@/components/text/OutlinePane";
import BibleLookupPane from "@/components/bible/BibleLookupPane";
import IntertextualPanel from "@/components/text/IntertextualPanel";
import ResizablePane from "@/components/ResizablePane";
import RstTypeManager from "@/components/controls/RstTypeManager";
import ToolbarCustomizer, { DEFAULT_TOOLBAR_VIS, type ToolbarVisibility } from "@/components/controls/ToolbarCustomizer";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";
import type { RstCustomType } from "@/lib/db/schema";
import { useWordArrows } from "@/lib/hooks/useWordArrows";
import { useAnnotationRange } from "@/lib/hooks/useAnnotationRange";
import { useRstRelations } from "@/lib/hooks/useRstRelations";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import { computeSectionRanges } from "@/lib/utils/sectionRanges";
import { generateOutline } from "@/lib/utils/outlineExport";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import { CONTIGUOUS_BOOK_PAIRS, CONTIGUOUS_BOOK_PREV, OSIS_BOOK_NAMES, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import AddressBar from "@/components/ui/AddressBar";
import { APPLY_BOOKMARK_VIEW_EVENT, type BookmarkView } from "@/components/navigation/BookmarkButton";

/** Normalize text for diacritic-insensitive find-in-page matching.
 *  Strips Hebrew cantillation/vowel marks and Greek/Latin combining diacritics
 *  so users can type bare consonants and still get hits. */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[֑-ׇ]/g, "")  // Hebrew cantillation (U+0591–U+05AF) + niqqud (U+05B0–U+05C7)
    .replace(/[̀-ͯ]/g, "")  // Greek/Latin combining diacritics
    .replace(/\//g, "")               // OSHB morpheme separators
    .toLowerCase();
}

/** Returns true if the word's surface text is entirely punctuation and should
 *  be skipped during character / word-tag selection. */
function isPunctuationWord(word: Word): boolean {
  const text = (word.surfaceText ?? "").replace(/\//g, "").trim();
  // Match common ASCII and Unicode punctuation: quotes, period, comma, colon, semicolon, middle dot
  return text.length > 0 && /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u05C3\u05BE\u05C0]+$/.test(text);
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
  initialSceneBreaks: { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }[];
  initialLineAnnotations: LineAnnotation[];
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }[];
  bookMaxVerses: Map<number, number>;
  /** Base verse text from data/ult.db (empty if not imported). */
  ultBaseVerses?: { verse: number; text: string }[];
  /** The Translation record for ULT in user.db (null if not imported). */
  ultTranslation?: Translation | null;
  /** Base verse text from data/vcb.db (empty if not imported). */
  vcbBaseVerses?: { verse: number; text: string }[];
  /** The Translation record for VCB in user.db (null if not imported). */
  vcbTranslation?: Translation | null;
  /** Reconstructed verse texts from lxx.db for showing LXX in the translation column. */
  lxxBaseVerses?: { verse: number; text: string }[];
  /** Per-verse LXX Word arrays for word-token rendering and TC marking. */
  lxxVerseWords?: Map<number, import("@/lib/db/source-schema").Word[]>;
  /** The Translation record for LXX in user.db (null if lxx.db unavailable). */
  lxxTranslation?: Translation | null;
  /** Pre-fetched text critical marks for this chapter. */
  initialTextCriticalMarks?: { wordId: string; markType: string; textSource: string }[];
  /** Optional heading strip (book title, chapter number, word count) rendered
   *  above the toolbar; hidden automatically in presentation mode. */
  headingSlot?: React.ReactNode;
  /** Footnotes keyed by translationId for the current chapter. */
  initialTranslationFootnotes?: Record<number, TranslationFootnote[]>;
  /** When true (workspace "Translation only" mode), the chapter view defaults to
   *  hiding the source text and auto-activating the locale-appropriate translation. */
  translationOnly?: boolean;
  /** Ordered list of OSIS book codes for this text source (for F9 book navigation). */
  sortedBooks?: string[];
  /** When true, start in presentation mode (driven by ?present URL param). */
  initialPresentationMode?: boolean;
  /** When true, hide the sticky toolbar entirely (for clean iframe embeds). */
  hideToolbar?: boolean;
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
  vcbBaseVerses = [],
  vcbTranslation = null,
  lxxBaseVerses = [],
  lxxVerseWords,
  lxxTranslation = null,
  initialTextCriticalMarks = [],
  headingSlot,
  initialTranslationFootnotes = {},
  translationOnly = false,
  sortedBooks = [],
  initialPresentationMode = false,
  hideToolbar = false,
}: ChapterDisplayProps) {
  const { t, locale } = useTranslation();
  const router = useRouter();

  // Translation footnotes keyed by translationId → verse → footnotes[]
  const [localFootnotes, setLocalFootnotes] = useState<Record<number, TranslationFootnote[]>>(
    initialTranslationFootnotes
  );

  // Footnote dialog state (shared between create and edit)
  const [fnDialogOpen, setFnDialogOpen] = useState(false);
  const [fnDialogVerse, setFnDialogVerse] = useState(1);
  const [fnDialogAbbr, setFnDialogAbbr] = useState("");
  const [fnDialogType, setFnDialogType] = useState<"f" | "x">("f");
  const [fnDialogContent, setFnDialogContent] = useState("");
  const [fnEditId, setFnEditId] = useState<number | null>(null); // null = create, number = edit
  const fnAnchorRef = useRef<{ el: HTMLTextAreaElement; pos: number } | null>(null);

  // Footnote visibility
  const [showFootnotes, setShowFootnotes] = useState(true);
  // Editing-mode gate for destructive footnote operations (deletion).
  // When false the × delete button is hidden; edit (✎) remains always accessible.
  const [editingFootnotes, setEditingFootnotes] = useState(false);
  // Anchor-move mode: ID of the footnote whose \fn \fn* is being repositioned.
  const [fnAnchorMoveId, setFnAnchorMoveId] = useState<number | null>(null);

  // Version history panel state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAbbr, setHistoryAbbr] = useState("");
  const [historyVerse, setHistoryVerse] = useState(1);
  const [historyVersions, setHistoryVersions] = useState<Array<{ id: number; text: string; createdAt: string; label: string | null }>>([]);

  // Use fallback defaults for SSR — localStorage values are loaded in useEffect after hydration
  const [displayMode, setDisplayMode] = useState<DisplayMode>("clean");
  const [interlinearSubMode, setInterlinearSubMode] = useState<InterlinearSubMode>("lemma");
  const [constituentLabelMap, setConstituentLabelMap] = useState<Map<string, string>>(new Map());
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([]);
  const [datasetEntryMap, setDatasetEntryMap] = useState<Map<string, string>>(new Map());
  const [transliterationFormatMap, setTransliterationFormatMap] = useState<Map<string, string>>(new Map());
  // Upload dialog state
  const [uploadDatasetId, setUploadDatasetId] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesSynced, setNotesSynced] = useState(() => {
    try { const v = localStorage.getItem("structura:notesSynced"); return v === null ? true : v === "true"; } catch { return true; }
  });
  const visibleVersesRef = useRef(new Set<number>());
  const notesSyncedRef   = useRef(notesSynced);
  const syncTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [intertextualOpen, setIntertextualOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const [searchRequest, setSearchRequest] = useState<{ query: string; source: string; nonce: number } | null>(null);
  const [notesScrollVerse, setNotesScrollVerse] = useState<number | null>(null);

  // ── Text Critical Markup ─────────────────────────────────────────────────────
  const [tcMarkMap, setTcMarkMap] = useState<Map<string, string>>(
    () => new Map(initialTextCriticalMarks.map(m => [m.wordId, m.markType]))
  );
  const [editingTc, setEditingTc] = useState(false);
  const [activeTcMark, setActiveTcMark] = useState<"lxx_unique" | "mt_unique" | "same_different">("lxx_unique");

  // RST source-pad: dynamically sized so group chips never overlap verse labels
  const [rstSourcePad, setRstSourcePad] = useState(0);

  // Find-in-page bar
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findFocusIdx, setFindFocusIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Auto-open search pane if a previous search was persisted in sessionStorage
  useEffect(() => {
    try {
      if (sessionStorage.getItem("structura.search")) setSearchOpen(true);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showTooltips, setShowTooltips] = useState(false);
  const [showAtnachBreaks, setShowAtnachBreaks] = useState(false);
  const [showVowels, setShowVowels] = useState(true);
  const [showCantillation, setShowCantillation] = useState(true);
  // Store active translations by abbreviation so they survive cross-book navigation
  const [activeTranslationAbbrs, setActiveTranslationAbbrs] = useState<Set<string>>(new Set());
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [useLinguisticTerms, setUseLinguisticTerms] = useState(false);
  const [hebrewFontSize, setHebrewFontSize] = useState(1.375);
  const [greekFontSize, setGreekFontSize] = useState(1.25);
  const [translationFontSize, setTranslationFontSize] = useState(0.875);
  const [lineHeightMultiplier, setLineHeightMultiplier] = useState(1.0);
  const [editingParagraphs, setEditingParagraphs] = useState(false);
  const [paragraphBreakIds, setParagraphBreakIds] = useState<Set<string>>(
    () => new Set(initialParagraphBreakIds)
  );

  // ── Section break state ──────────────────────────────────────────────────────
  // Map of wordId → Array<{ heading, level, verse, outOfSequence, extendedThrough, thematic, thematicLetter }>.
  // Multiple levels may exist at the same wordId; toggling also mirrors into paragraphBreakIds.
  const [sceneBreakMap, setSceneBreakMap] = useState<Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }>>>(
    () => {
      // Build verse → first source word map to resolve tv:-prefixed scene break ids
      const verseFirstWord = new Map<number, string>();
      for (const w of words) {
        if (!verseFirstWord.has(w.verse)) verseFirstWord.set(w.verse, w.wordId);
      }
      const m = new Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }>>();
      for (const sb of initialSceneBreaks) {
        let key = sb.wordId;
        if (key.startsWith("tv:")) {
          // "tv:ABBR:Book.ch.v" → first source word of that verse
          const verseNum = parseInt(key.split(".")[2] ?? "0", 10);
          key = verseFirstWord.get(verseNum) ?? key;
        }
        const arr = m.get(key) ?? [];
        arr.push({ heading: sb.heading, level: sb.level, verse: sb.verse, outOfSequence: sb.outOfSequence, extendedThrough: sb.extendedThrough, thematic: sb.thematic, thematicLetter: sb.thematicLetter, transitional: sb.transitional ?? false });
        m.set(key, arr);
      }
      return m;
    }
  );
  const [editingScenes, setEditingScenes] = useState(false);

  // ── Line annotation hook is called below, after paragraphFirstWordIds useMemo ─

  // ── Character tagging state ────────────────────────────────────────────────
  const [highlightCharIds, setHighlightCharIds] = useState<Set<number>>(new Set());
  const [editingRefs, setEditingRefs] = useState(false);
  const [refRangeStart, setRefRangeStart] = useState<string | null>(null);
  const [wordTagRangeStart, setWordTagRangeStart] = useState<string | null>(null);
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
  const [pendingWordTagCorpusGroupingId, setPendingWordTagCorpusGroupingId] = useState<number | null>(null);
  // When set, the next source-word click adds its canonical lemma to a cluster being built
  const [clusterLemmaCallback, setClusterLemmaCallback] = useState<((lemma: string) => void) | null>(null);

  const wordTagMap = useMemo(
    () => new Map(wordTags.map((t) => [t.id, t])),
    [wordTags]
  );

  // ── Search hit highlighting ──────────────────────────────────────────────────
  /** Called by SearchPane whenever results change. Filters to words in this chapter. */
  const toggleNotesSync = useCallback(() => {
    setNotesSynced((prev) => {
      const next = !prev;
      try { localStorage.setItem("structura:notesSynced", String(next)); } catch {}
      return next;
    });
  }, []);

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
    const newTag: WordTag = { id: tagId, workspaceId: 1, book: "*", name, color, type: "search", createdAt: new Date().toISOString(), sortOrder: null, corpusGroupingId: null, lemmas: null };
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

  // ── RST relations (hook) ──────────────────────────────────────────────────
  // ChapterDisplay is always a single chapter, so getChapterForWord always returns
  // the chapter prop.  The hook handles all state, handlers, and localStorage for
  // the rstLinked setting.
  const {
    rstRelations, setRstRelations,
    tvRstRelations, setTvRstRelations,
    rstRelationsLinked, setRstRelationsLinked,
    rstEditingSide, setRstEditingSide,
    editingRst, setEditingRst,
    rstSegA, setRstSegA,
    rstSegAGroupId, setRstSegAGroupId,
    rstSegB, setRstSegB,
    rstRolesSwapped, setRstRolesSwapped,
    showRstPicker, setShowRstPicker,
    rstEditGroupId, setRstEditGroupId,
    handleSelectRstSegment,
    handleSelectRstGroup,
    handleCreateRstRelation,
    handleCancelRstPicker,
    handleEditRstGroup,
    handleUpdateRstGroupType,
    handleDeleteRstGroup,
    handleUpdateRstIntersectPoint,
  } = useRstRelations({
    initialRstRelations,
    initialTvRstRelations,
    book,
    textSource,
    getChapterForWord: () => chapter,
    supportsLinkedTrees: true,
  });

  // Custom RST label types (local to ChapterDisplay — not part of hook)
  const [customRstTypes, setCustomRstTypes] = useState<RstCustomType[]>([]);
  const [showRstTypeManager, setShowRstTypeManager] = useState(false);

  // ── Word arrows (hook) ────────────────────────────────────────────────────
  const {
    wordArrowsState, setWordArrowsState,
    editingArrows, setEditingArrows,
    arrowFromWordId, setArrowFromWordId,
    handleSelectArrowWordById,
    handleDeleteWordArrow,
    handleUpdateWordArrow,
  } = useWordArrows({
    initialWordArrows,
    book,
    textSource,
    getChapterForWord: () => chapter,
  });

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
  const [presentationMode, setPresentationMode] = useState(initialPresentationMode);
  const [addressBarOpen, setAddressBarOpen] = useState(false);

  // ── Toolbar visibility (customizer) ───────────────────────────────────────
  const [toolbarVis, setToolbarVis] = useState<ToolbarVisibility>(DEFAULT_TOOLBAR_VIS);
  const [showToolbarCustomizer, setShowToolbarCustomizer] = useState(false);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  function setToolbarItemVis(key: keyof ToolbarVisibility, val: boolean) {
    setToolbarVis(prev => ({ ...prev, [key]: val }));
  }

  // ── Copy-link button ──────────────────────────────────────────────────────
  const [linkCopied, setLinkCopied] = useState(false);
  function handleCopyPresentLink() {
    const url = `${window.location.origin}${window.location.pathname}?present`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  // ── Toolbar tooltip ───────────────────────────────────────────────────────
  const [tbTooltip, setTbTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  function handleToolbarMouseMove(e: React.MouseEvent) {
    const btn = (e.target as Element).closest("[data-tip]") as HTMLElement | null;
    if (btn) {
      const text = btn.getAttribute("data-tip") ?? "";
      if (text) setTbTooltip({ text, x: e.clientX, y: e.clientY });
      else setTbTooltip(null);
    } else {
      setTbTooltip(null);
    }
  }

  // ── Outline pane ──────────────────────────────────────────────────────────
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineCopied, setOutlineCopied] = useState(false);

  // ── Cross-book outline extension ──────────────────────────────────────────
  // These live here (not in OutlinePane) so they survive the pane being closed/reopened.
  const continuationBook     = CONTIGUOUS_BOOK_PAIRS[book] ?? null;
  const continuationBookName = continuationBook ? (OSIS_REF_BOOK_NAMES[continuationBook] ?? continuationBook) : null;
  const [outlineExtended,  setOutlineExtended]  = useState(false);
  const [contBreaks,       setContBreaks]       = useState<{ wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[]>([]);
  const [contMaxVerses,    setContMaxVerses]    = useState<Map<number, number>>(new Map());
  const [contDataLoaded,   setContDataLoaded]   = useState(false);
  const [loadingCont,      setLoadingCont]      = useState(false);

  useEffect(() => {
    if (!outlineExtended || !continuationBook || contDataLoaded) return;
    setLoadingCont(true);
    Promise.all([
      fetch(`/api/book-scene-breaks?book=${encodeURIComponent(continuationBook)}&source=${encodeURIComponent(textSource)}`).then((r) => r.json()),
      fetch(`/api/book-info?book=${encodeURIComponent(continuationBook)}&source=${encodeURIComponent(textSource)}`).then((r) => r.json()),
    ])
      .then(([breakData, infoData]) => {
        setContBreaks(breakData.breaks ?? []);
        const mv = new Map<number, number>();
        for (const [ch, v] of Object.entries(
          (infoData.chapterMaxVerses ?? {}) as Record<string, number>
        )) {
          mv.set(Number(ch), v);
        }
        setContMaxVerses(mv);
        setContDataLoaded(true);
      })
      .catch(() => setContDataLoaded(true))
      .finally(() => setLoadingCont(false));
  }, [outlineExtended, continuationBook, contDataLoaded, textSource]);

  // ── Cross-book outline predecessor (e.g. 1 Sam when viewing 2 Sam) ───────
  const predecessorBook     = CONTIGUOUS_BOOK_PREV[book] ?? null;
  const predecessorBookName = predecessorBook ? (OSIS_REF_BOOK_NAMES[predecessorBook] ?? predecessorBook) : null;
  const [outlinePredecessorShown, setOutlinePredecessorShown] = useState(false);
  const [predBreaks,    setPredBreaks]    = useState<{ wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[]>([]);
  const [predDataLoaded, setPredDataLoaded] = useState(false);
  const [loadingPred,    setLoadingPred]    = useState(false);

  useEffect(() => {
    if (!outlinePredecessorShown || !predecessorBook || predDataLoaded) return;
    setLoadingPred(true);
    fetch(`/api/book-scene-breaks?book=${encodeURIComponent(predecessorBook)}&source=${encodeURIComponent(textSource)}`)
      .then((r) => r.json())
      .then((data) => { setPredBreaks(data.breaks ?? []); setPredDataLoaded(true); })
      .catch(() => setPredDataLoaded(true))
      .finally(() => setLoadingPred(false));
  }, [outlinePredecessorShown, predecessorBook, predDataLoaded, textSource]);

  // ── Translation text editing ───────────────────────────────────────────────
  // Local mutable copy of translationVerseData so edits can be reflected immediately.
  // If ULT/VCB base verses are provided, merge them in: user edits (from user.db) take
  // precedence; verses not yet edited fall back to the immutable base text from the source DB.
  const initialTranslationVerseData = useMemo(() => {
    let data = translationVerseData;

    if (ultTranslation && ultBaseVerses.length > 0) {
      const ultId = ultTranslation.id;
      const editedMap = new Map(
        (data[ultId] ?? []).map((v) => [v.verse, v])
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
      data = { ...data, [ultId]: merged };
    }

    if (vcbTranslation && vcbBaseVerses.length > 0) {
      const vcbId = vcbTranslation.id;
      const editedMap = new Map(
        (data[vcbId] ?? []).map((v) => [v.verse, v])
      );
      const merged: TranslationVerse[] = vcbBaseVerses.map((base, i) => {
        return editedMap.get(base.verse) ?? {
          id: -(i + 1),                    // synthetic — not yet saved to user.db
          workspaceId: vcbTranslation.workspaceId,
          translationId: vcbId,
          osisRef: `${book}.${chapter}.${base.verse}`,
          bookId: 0, chapter,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [vcbId]: merged };
    }

    if (lxxTranslation && lxxBaseVerses.length > 0) {
      const lxxId = lxxTranslation.id;
      const editedMap = new Map(
        (data[lxxId] ?? []).map((v) => [v.verse, v])
      );
      const merged: TranslationVerse[] = lxxBaseVerses.map((base, i) => {
        return editedMap.get(base.verse) ?? {
          id: -(i + 1),
          workspaceId: lxxTranslation.workspaceId,
          translationId: lxxId,
          osisRef: `${book}.${chapter}.${base.verse}`,
          bookId: 0, chapter,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [lxxId]: merged };
    }

    return data;
  // Only recalculate when book/chapter/translation IDs change (navigation); not on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, ultTranslation?.id, vcbTranslation?.id, lxxTranslation?.id]);

  const [localTranslationVerseData, setLocalTranslationVerseData] = useState(initialTranslationVerseData);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editingTranslationSource, setEditingTranslationSource] = useState(false);
  const [chapterUsfmOpen, setChapterUsfmOpen] = useState(false);
  const [chapterUsfmText, setChapterUsfmText] = useState("");
  const [chapterUsfmLoading, setChapterUsfmLoading] = useState(false);
  const [chapterUsfmSaving, setChapterUsfmSaving] = useState(false);
  const [chapterUsfmError, setChapterUsfmError] = useState<string | null>(null);
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

  // ── Line annotations (hook) ──────────────────────────────────────────────
  // Called here (after paragraphFirstWordIds) so the hook always closes over the
  // latest segment list.  React rules allow useMemo and custom hooks in any order
  // as long as the call order is stable across renders.
  const {
    lineAnnotations, setLineAnnotations,
    editingAnnotations, setEditingAnnotations,
    annotRangeStart, setAnnotRangeStart,
    annotRangeEnd, setAnnotRangeEnd,
    handleSelectAnnotationSegment,
    handleCancelAnnotation,
    handleSaveAnnotation,
    handleDeleteAnnotation,
    handleUpdateAnnotation,
    handleExpandAnnotationRange,
  } = useAnnotationRange({
    initialLineAnnotations,
    book,
    textSource,
    getChapterForWord: () => chapter,
    paragraphFirstWordIds,
  });

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

  // Refs that let the static keydown listener read current state without stale closures
  const findOpenRef = useRef(false);
  const findHitIdsRef = useRef<string[]>([]);
  const findFocusIdRef = useRef<string | null>(null);
  const editingRefsRef = useRef(false);
  const editingWordTagsRef = useRef(false);
  const wordsRef = useRef<Word[]>(words);
  // Navigation refs (props are stable per mount; refs let the static listener read them)
  const bookRef = useRef(book);
  const chapterRef = useRef(chapter);
  const textSourceRef = useRef(textSource);
  const bookMaxVersesRef = useRef(bookMaxVerses);
  const sortedBooksRef = useRef(sortedBooks);
  const wordPositionMap = useMemo(
    () => new Map(words.map((w) => [w.wordId, w.positionInVerse])),
    [words]
  );
  // handleSelectWord is defined below; we use a ref so the listener can call it
  const handleSelectWordRef = useRef<(word: Word, shiftHeld?: boolean) => void>(() => {});
  // tagFocusedFindWord is assigned each render with fresh state closures
  const tagFocusedFindWordRef = useRef<() => void>(() => {});

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
      // Ctrl/Cmd+F — open find bar
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.select(), 0);
        return;
      }
      // Ctrl/Cmd+L — open address bar
      if ((e.metaKey || e.ctrlKey) && e.key === "l" && !e.shiftKey) {
        e.preventDefault();
        setAddressBarOpen(true);
        return;
      }
      // Ctrl/Cmd+G — next hit
      if ((e.metaKey || e.ctrlKey) && e.key === "g" && !e.shiftKey) {
        if (!findOpenRef.current || findHitIdsRef.current.length === 0) return;
        e.preventDefault();
        setFindFocusIdx((i) => (i + 1) % findHitIdsRef.current.length);
        return;
      }
      // Ctrl/Cmd+Shift+G — previous hit
      if ((e.metaKey || e.ctrlKey) && e.key === "g" && e.shiftKey) {
        if (!findOpenRef.current || findHitIdsRef.current.length === 0) return;
        e.preventDefault();
        setFindFocusIdx((i) => (i - 1 + findHitIdsRef.current.length) % findHitIdsRef.current.length);
        return;
      }
      // Ctrl/Cmd+E — tag focused word with active annotation tool
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        if (!findOpenRef.current || !findFocusIdRef.current) return;
        if (!editingRefsRef.current && !editingWordTagsRef.current) return;
        e.preventDefault();
        tagFocusedFindWordRef.current();
        return;
      }
      // Escape — cancel anchor-move mode first; then close find bar
      if (e.key === "Escape" && fnAnchorMoveId !== null) {
        setFnAnchorMoveId(null);
        return;
      }
      if (e.key === "Escape" && findOpenRef.current) {
        setFindOpen(false);
        setFindQuery("");
        return;
      }
      // Navigation shortcuts — skip when focus is inside a text input
      const inTextInput =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;
      // F8 — next chapter; Ctrl/Cmd+F8 — previous chapter
      if (e.key === "F8" && !e.altKey) {
        if (inTextInput) return;
        e.preventDefault();
        const bk = bookRef.current;
        const ch = chapterRef.current;
        const src = textSourceRef.current;
        const maxCh = bookMaxVersesRef.current.size > 0
          ? Math.max(...bookMaxVersesRef.current.keys()) : ch;
        if (e.metaKey || e.ctrlKey) {
          if (ch > 1) router.push(`/${encodeURIComponent(bk)}/${src}/${ch - 1}`);
        } else {
          if (ch < maxCh) router.push(`/${encodeURIComponent(bk)}/${src}/${ch + 1}`);
        }
        return;
      }
      // F9 — next book; Ctrl/Cmd+F9 — previous book
      if (e.key === "F9" && !e.altKey) {
        if (inTextInput) return;
        e.preventDefault();
        const bk = bookRef.current;
        const src = textSourceRef.current;
        const books = sortedBooksRef.current;
        if (books.length > 0) {
          const idx = books.indexOf(bk);
          if (e.metaKey || e.ctrlKey) {
            if (idx > 0) router.push(`/${encodeURIComponent(books[idx - 1])}/${src}/1`);
          } else {
            if (idx >= 0 && idx < books.length - 1) router.push(`/${encodeURIComponent(books[idx + 1])}/${src}/1`);
          }
        }
        return;
      }
      // Ctrl/Cmd+↓ / Ctrl/Cmd+↑ — next/previous verse
      if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const inTranslationTextarea =
          document.activeElement instanceof HTMLTextAreaElement &&
          (document.activeElement as HTMLTextAreaElement).dataset.translationTextarea === "true";
        // Allow when in a translation textarea; block for all other inputs
        if (inTextInput && !inTranslationTextarea) return;
        e.preventDefault();
        const bk = bookRef.current;
        const ch = chapterRef.current;
        const src = textSourceRef.current;
        const maxVerse = bookMaxVersesRef.current.get(ch) ?? 1;
        // Determine current verse: prefer DOM when inside a textarea (URL param may be stale)
        let startVerse: number;
        if (inTranslationTextarea) {
          const verseEl = (document.activeElement as HTMLElement).closest("[id^='verse-']");
          startVerse = verseEl ? parseInt(verseEl.id.replace("verse-", ""), 10) : 1;
          (document.activeElement as HTMLTextAreaElement).blur(); // save
        } else {
          const urlParams = new URLSearchParams(window.location.search);
          startVerse = parseInt(urlParams.get("v") ?? "1", 10);
        }
        const nextVerse = Math.max(1, Math.min(
          e.key === "ArrowDown" ? startVerse + 1 : startVerse - 1,
          maxVerse
        ));
        router.replace(
          `/${encodeURIComponent(bk)}/${src}/${ch}?v=${nextVerse}`,
          { scroll: false }
        );
        setTimeout(() => {
          const verseEl = document.getElementById(`verse-${nextVerse}`);
          verseEl?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (inTranslationTextarea) {
            verseEl?.querySelector<HTMLTextAreaElement>("[data-translation-textarea='true']")?.focus();
          }
        }, 50);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  // Keep live-value refs in sync for the static keydown listener (non-find ones only;
  // findHitIds/findFocusId refs are updated below, after those values are declared)
  useEffect(() => { findOpenRef.current = findOpen; }, [findOpen]);
  useEffect(() => { editingRefsRef.current = editingRefs; }, [editingRefs]);
  useEffect(() => { editingWordTagsRef.current = editingWordTags; }, [editingWordTags]);
  useEffect(() => { wordsRef.current = words; }, [words]);
  useEffect(() => { bookRef.current = book; }, [book]);
  useEffect(() => { chapterRef.current = chapter; }, [chapter]);
  useEffect(() => { textSourceRef.current = textSource; }, [textSource]);
  useEffect(() => { notesSyncedRef.current = notesSynced; }, [notesSynced]);

  // Keep localFootnotes in sync when navigation brings a new chapter.
  // ChapterDisplay is keyed by workspaceId so React may reuse the same
  // component instance across chapter navigations — the useState initial
  // value is only applied on the very first mount, leaving localFootnotes
  // stale for subsequent chapters.  Re-sync here whenever book or chapter
  // changes so footnotes from server always reflect the current chapter.
  useEffect(() => {
    setLocalFootnotes(initialTranslationFootnotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);
  useEffect(() => { bookMaxVersesRef.current = bookMaxVerses; }, [bookMaxVerses]);
  useEffect(() => { sortedBooksRef.current = sortedBooks; }, [sortedBooks]);

  // Restore all persisted settings after hydration — avoids SSR/client HTML mismatch.
  // Font sizes are included here (not in lazy initializers) for the same reason.
  // Write effects for font sizes were removed; adjustFontSize writes directly instead.
  useEffect(() => {
    setDisplayMode(readLocal<DisplayMode>("structura:displayMode", "clean"));
    setInterlinearSubMode(readLocal<InterlinearSubMode>("structura:interlinearSubMode", "lemma"));
    const storedAbbrs = readLocal<string[]>("structura:activeTranslations", []);
    if (storedAbbrs.length > 0) {
      setActiveTranslationAbbrs(new Set(storedAbbrs));
    } else if (translationOnly) {
      // Auto-activate the locale-appropriate built-in translation so the column
      // is visible immediately without any manual setup.
      const autoAbbr = locale === "vi" && vcbTranslation ? "VCB"
        : ultTranslation ? "ULT"
        : null;
      if (autoAbbr) setActiveTranslationAbbrs(new Set([autoAbbr]));
    }
    setShowVowels(readLocal<boolean>("structura:showVowels", true));
    setShowCantillation(readLocal<boolean>("structura:showCantillation", true));
    setUseLinguisticTerms(readLocal<boolean>("structura:useLinguisticTerms", false));
    setHebrewFontSize(readLocal<number>("structura:hebrewFontSize", 1.375));
    setGreekFontSize(readLocal<number>("structura:greekFontSize", 1.25));
    setTranslationFontSize(readLocal<number>("structura:translationFontSize", 0.875));
    setLineHeightMultiplier(readLocal<number>("structura:lineHeightMultiplier", 1.0));
    // In translation-only mode, default to hiding source text (use stored pref if set).
    setHideSourceText(readLocal<boolean>("structura:hideSourceText", translationOnly));
    setToolbarVis({ ...DEFAULT_TOOLBAR_VIS, ...readLocal<Partial<ToolbarVisibility>>("structura:toolbarVisibility", {}) });
    setNotesOpen(readLocal<boolean>("structura:notesOpen", false));
    setSearchOpen(readLocal<boolean>("structura:searchOpen", false));
    setOutlineOpen(readLocal<boolean>("structura:outlineOpen", false));
    setIntertextualOpen(readLocal<boolean>("structura:intertextualOpen", false));
    setOutlineExtended(readLocal<boolean>("structura:outlineExtended", false));
    setOutlinePredecessorShown(readLocal<boolean>("structura:outlineIncludePaired", false));
    setEditingScenes(readLocal<boolean>("structura:editingScenes", false));
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
  useEffect(() => { writeLocal("structura:showVowels", showVowels); }, [showVowels]);
  useEffect(() => { writeLocal("structura:showCantillation", showCantillation); }, [showCantillation]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);
  // structura:rstLinked is now persisted inside useRstRelations hook.
  useEffect(() => { writeLocal("structura:toolbarVisibility", toolbarVis); }, [toolbarVis]);
  useEffect(() => { writeLocal("structura:notesOpen", notesOpen); }, [notesOpen]);
  useEffect(() => { writeLocal("structura:searchOpen", searchOpen); }, [searchOpen]);
  useEffect(() => { writeLocal("structura:outlineOpen", outlineOpen); }, [outlineOpen]);
  useEffect(() => { writeLocal("structura:intertextualOpen", intertextualOpen); }, [intertextualOpen]);
  useEffect(() => { writeLocal("structura:outlineExtended", outlineExtended); }, [outlineExtended]);
  useEffect(() => { writeLocal("structura:outlineIncludePaired", outlinePredecessorShown); }, [outlinePredecessorShown]);
  useEffect(() => { writeLocal("structura:editingScenes", editingScenes); }, [editingScenes]);

  // Apply view state from bookmark navigation (ChapterDisplay may not remount between pages)
  useEffect(() => {
    function onApplyBookmarkView(e: Event) {
      const { translations, displayMode, interlinearSubMode: subMode } = (e as CustomEvent<BookmarkView>).detail;
      if (translations.length > 0) setActiveTranslationAbbrs(new Set(translations));
      if (displayMode) setDisplayMode(displayMode as DisplayMode);
      if (subMode) setInterlinearSubMode(subMode as InterlinearSubMode);
    }
    window.addEventListener(APPLY_BOOKMARK_VIEW_EVENT, onApplyBookmarkView);
    return () => window.removeEventListener(APPLY_BOOKMARK_VIEW_EVENT, onApplyBookmarkView);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load datasets list on mount ───────────────────────────────────────────
  useEffect(() => {
    fetch("/api/interlinear/datasets?workspaceId=1")
      .then((r) => r.json())
      .then((rows: { id: number; name: string }[]) => setDatasets(rows))
      .catch(() => {});
  }, []);

  // ── Load book groupings (for corpus selector in word tag panel) ───────────
  const [bookGroupings, setBookGroupings] = useState<import("@/lib/db/schema").BookGrouping[]>([]);
  useEffect(() => {
    fetch("/api/book-groupings")
      .then((r) => r.json())
      .then((d: { groupings?: import("@/lib/db/schema").BookGrouping[] }) => setBookGroupings(d.groupings ?? []))
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

  // ── Load transliteration formats for current chapter ─────────────────────
  useEffect(() => {
    if (displayMode !== "interlinear" || interlinearSubMode !== "transliteration") return;
    fetch(
      `/api/interlinear/transliteration-formats?workspaceId=1&book=${encodeURIComponent(book)}&chapter=${chapter}&textSource=${encodeURIComponent(textSource)}`
    )
      .then((r) => r.json())
      .then((rows: { wordId: string; format: string }[]) =>
        setTransliterationFormatMap(new Map(rows.map((r) => [r.wordId, r.format])))
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

  // Track topmost visible verse via IntersectionObserver and sync the notes
  // pane when notesSynced is on. Uses a ref for the synced flag to avoid
  // recreating the observer on every toggle.
  // Placed after verseNums so the dependency is in scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notesOpen) return;
    visibleVersesRef.current.clear();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const m = entry.target.id.match(/^verse-(\d+)$/);
        if (!m) return;
        const v = parseInt(m[1]);
        if (entry.isIntersecting) visibleVersesRef.current.add(v);
        else visibleVersesRef.current.delete(v);
      });
      if (!notesSyncedRef.current || visibleVersesRef.current.size === 0) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        if (!notesSyncedRef.current || visibleVersesRef.current.size === 0) return;
        setNotesScrollVerse(Math.min(...visibleVersesRef.current));
      }, 300);
    }, { threshold: 0.1 });
    document.querySelectorAll("[id^='verse-']").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [notesOpen, verseNums]);

  // Find-in-page: source word hits (ordered by position in chapter)
  // Find-in-page: source word hits (ordered by position in chapter).
  // TV hits and derived values are computed after activeTranslationVerseMap (declared below).
  const findHitIds = useMemo<string[]>(() => {
    if (!findQuery.trim()) return [];
    const q = normalizeForSearch(findQuery);
    if (!q) return [];
    return words
      .filter((w) => !isPunctuationWord(w))
      .filter((w) => normalizeForSearch(w.surfaceText ?? "").includes(q))
      .map((w) => w.wordId);
  }, [words, findQuery]);

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

  // When the outline is extended into the continuation book, post-process sectionRanges:
  // any break whose range ends at the very last verse of this book gets its end extended
  // into the continuation book (up to the first same-or-higher-level break there, or the
  // end of the continuation book).
  const { extendedSectionRanges, crossBookRangeKeys } = useMemo<{
    extendedSectionRanges: typeof sectionRanges;
    crossBookRangeKeys: Set<string>;
  }>(() => {
    const empty = { extendedSectionRanges: sectionRanges, crossBookRangeKeys: new Set<string>() };
    if (!outlineExtended || !contDataLoaded) return empty;

    const lastCh    = bookMaxVerses.size ? Math.max(...bookMaxVerses.keys()) : 0;
    const lastVerse = bookMaxVerses.get(lastCh) ?? 0;
    if (!lastCh || !lastVerse) return empty;

    const contLastCh    = contMaxVerses.size ? Math.max(...contMaxVerses.keys()) : 0;
    const contLastVerse = contMaxVerses.get(contLastCh) ?? 0;

    // Continuation breaks sorted by chapter/verse/level for finding the closing break
    const sortedContBreaks = [...contBreaks].sort((a, b) =>
      a.chapter !== b.chapter ? a.chapter - b.chapter :
      a.verse   !== b.verse   ? a.verse   - b.verse   : a.level - b.level
    );

    const result    = new Map(sectionRanges);
    const crossKeys = new Set<string>();

    for (const [key, range] of sectionRanges) {
      if (range.endChapter !== lastCh || range.endVerse !== lastVerse) continue;

      // Extract level from key (format: "${wordId}:${level}", wordIds never contain ':')
      const lastColon = key.lastIndexOf(":");
      const level     = parseInt(key.slice(lastColon + 1), 10);
      if (isNaN(level)) continue;

      // Find the first continuation-book break that closes this section
      const closing = sortedContBreaks.find((b) => b.level <= level);

      let newEndCh: number;
      let newEndVerse: number;

      if (closing) {
        const prev = closing.verse - 1;
        if (prev < 1) {
          const prevCh = closing.chapter - 1;
          newEndCh    = prevCh >= 1 ? prevCh : closing.chapter;
          newEndVerse = prevCh >= 1 ? (contMaxVerses.get(prevCh) ?? 0) : closing.verse;
        } else {
          newEndCh    = closing.chapter;
          newEndVerse = prev;
        }
      } else {
        newEndCh    = contLastCh;
        newEndVerse = contLastVerse;
      }

      result.set(key, { endChapter: newEndCh, endVerse: newEndVerse });
      crossKeys.add(key);
    }

    return { extendedSectionRanges: result, crossBookRangeKeys: crossKeys };
  }, [outlineExtended, contDataLoaded, contBreaks, contMaxVerses, sectionRanges, bookMaxVerses]);

  // Character id → Character
  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  // Merge ULT and VCB into availableTranslations.  Normally they're included only
  // when they have base verses for this chapter.  In translationOnly mode we include
  // them whenever they're imported (even for empty chapters) so the placeholder column
  // is still visible and the user knows to start translating.
  const allAvailableTranslations = useMemo(() => {
    let list = availableTranslations;
    const includeUlt = ultTranslation && (translationOnly || ultBaseVerses.length > 0);
    if (includeUlt && !list.some((t) => t.id === ultTranslation!.id)) {
      list = [ultTranslation!, ...list];
    }
    const includeVcb = vcbTranslation && (translationOnly || vcbBaseVerses.length > 0);
    if (includeVcb && !list.some((t) => t.id === vcbTranslation!.id)) {
      list = [...list, vcbTranslation!];
    }
    const includeLxx = lxxTranslation && lxxBaseVerses.length > 0;
    if (includeLxx && !list.some((t) => t.id === lxxTranslation!.id)) {
      list = [...list, lxxTranslation!];
    }
    return list;
  }, [availableTranslations, ultTranslation, ultBaseVerses.length, vcbTranslation, vcbBaseVerses.length, lxxTranslation, lxxBaseVerses.length, translationOnly]);

  // Set of system translation IDs — shown with a "built-in" badge in the picker
  const systemTranslationIds = useMemo(
    () => new Set([
      ...(ultTranslation ? [ultTranslation.id] : []),
      ...(vcbTranslation ? [vcbTranslation.id] : []),
      ...(lxxTranslation ? [lxxTranslation.id] : []),
    ]),
    [ultTranslation, vcbTranslation, lxxTranslation]
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
      // Deduplicate by verse number (DB has no unique constraint on translationId+verse).
      // Keep the highest-id row, which is the most recent insert.
      const deduped = new Map<number, typeof verses[0]>();
      for (const tv of verses) {
        const prev = deduped.get(tv.verse);
        if (!prev || tv.id > prev.id) deduped.set(tv.verse, tv);
      }
      for (const tv of deduped.values()) {
        const existing = map.get(tv.verse) ?? [];
        const entry: TranslationTextEntry = { abbr: t.abbreviation, text: tv.text, translationId: t.id };
        // Attach LXX word tokens so the translation column can render them individually.
        if (t.abbreviation === "LXX" && lxxVerseWords) {
          entry.words = lxxVerseWords.get(tv.verse);
        }
        existing.push(entry);
        map.set(tv.verse, existing);
      }
    }
    return map;
  }, [activeTranslationIds, allAvailableTranslations, localTranslationVerseData, lxxVerseWords]);

  // When editing, every verse gets entries for all active translations (empty where no data yet).
  const editingTranslationVerseMap = useMemo(() => {
    if (!editingTranslation) return activeTranslationVerseMap;
    const activeList = allAvailableTranslations.filter((t) => activeTranslationIds.has(t.id));
    const map = new Map<number, TranslationTextEntry[]>();
    for (const verseNum of verseNums) {
      const existing = activeTranslationVerseMap.get(verseNum) ?? [];
      const existingAbbrs = new Set(existing.map((e) => e.abbr));
      const empties = activeList
        .filter((t) => !existingAbbrs.has(t.abbreviation))
        .map((t) => ({ abbr: t.abbreviation, text: "", translationId: t.id }));
      map.set(verseNum, [...existing, ...empties]);
    }
    return map;
  }, [editingTranslation, activeTranslationVerseMap, allAvailableTranslations, activeTranslationIds, verseNums]);

  // Build abbr → ordered list of TV word IDs for shift-click range selection
  const tvWordIdLists = useMemo(() => {
    const map = new Map<string, string[]>();
    const verseNums = [...activeTranslationVerseMap.keys()].sort((a, b) => a - b);
    for (const verseNum of verseNums) {
      const entries = activeTranslationVerseMap.get(verseNum) ?? [];
      for (const { abbr, text, words: tvWords } of entries) {
        let list = map.get(abbr);
        if (!list) { list = []; map.set(abbr, list); }
        if (tvWords && tvWords.length > 0) {
          // LXX: use the actual word array rather than text tokens
          for (let wi = 0; wi < tvWords.length; wi++) {
            list.push(`tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`);
          }
        } else {
          const tokens = text
            .split(/\s+/)
            .filter(Boolean)
            .flatMap((t) => t.split(/(?<=\u2014)(?=.)/));
          for (let wi = 0; wi < tokens.length; wi++) {
            list.push(`tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`);
          }
        }
      }
    }
    return map;
  }, [activeTranslationVerseMap, book, chapter]);

  const hasActiveTranslations = activeTranslationIds.size > 0;

  // Verse number offset for Psalm superscriptions: ULT/VCB don't count the
  // superscription heading as verse 1, so MT verse N = ULT verse (N − offset).
  // When > 0 VerseDisplay shows the translation verse number in brackets below
  // the MT verse number (e.g. "2" with "[1]" below it for Ps 22 in ULT).
  const translationVerseOffset = useMemo(() => {
    if (book !== "Ps") return 0;
    // Only apply when at least one of the active translations is ULT or VCB.
    const hasUltOrVcb = [...activeTranslationIds].some((id) => {
      const t = allAvailableTranslations.find((t) => t.id === id);
      return t?.abbreviation === "ULT" || t?.abbreviation === "VCB";
    });
    if (!hasUltOrVcb) return 0;
    // getMtToKjvInstructions returns a single-instruction array for Psalm offset
    // chapters: { kjvChapter: N, kjvVerseStart: 1, kjvVerseEnd: 999, mtVerseOffset: 1|2 }
    const instrs = getMtToKjvInstructions(book, chapter);
    if (!instrs || instrs.length !== 1) return 0;
    return instrs[0].mtVerseOffset; // 1 or 2
  }, [book, chapter, activeTranslationIds, allAvailableTranslations]);

  // Per-verse KJV cross-chapter reference label (e.g. "1:17" for MT Jonah 2:1).
  // Only active for Jonah ch2, Joel ch3-4, Malachi ch3 tail — books where the
  // chapter boundary differs between MT and KJV.  Returns undefined (no function)
  // when no active translation exists or when the chapter has no cross-chapter remap.
  const translationVerseLabelFn = useMemo<((v: number) => string | null) | undefined>(() => {
    if (!hasActiveTranslations) return undefined;
    const instrs = getMtToKjvInstructions(book, chapter);
    if (!instrs || !instrs.some((i) => i.kjvChapter !== chapter)) return undefined;
    return (v: number) => getKjvVerseLabel(book, chapter, v);
  }, [book, chapter, hasActiveTranslations]);

  // ── Find-in-page: TV hits + combined navigation list ──────────────────────
  // Declared after activeTranslationVerseMap to avoid TDZ errors.

  const findTvHitIds = useMemo<string[]>(() => {
    if (!findQuery.trim()) return [];
    const q = normalizeForSearch(findQuery);
    if (!q) return [];
    const hits: string[] = [];
    const verseNums = [...activeTranslationVerseMap.keys()].sort((a, b) => a - b);
    for (const verseNum of verseNums) {
      for (const { abbr, text } of activeTranslationVerseMap.get(verseNum) ?? []) {
        const tokens = text.split(/\s+/).filter(Boolean).flatMap((t) => t.split(/(?<=—)(?=.)/));
        tokens.forEach((token, wi) => {
          if (normalizeForSearch(token).includes(q)) {
            hits.push(`tv:${abbr}:${book}.${chapter}.${verseNum}.${wi}`);
          }
        });
      }
    }
    return hits;
  }, [activeTranslationVerseMap, book, chapter, findQuery]);

  // Combined hit set for highlighting (source + translation)
  const findHitSet = useMemo(() => {
    const s = new Set(findHitIds);
    for (const id of findTvHitIds) s.add(id);
    return s;
  }, [findHitIds, findTvHitIds]);

  // Merged navigation list: for each verse, source hits then TV hits
  const findAllHitIds = useMemo<string[]>(() => {
    const srcByVerse = new Map<number, string[]>();
    const findHitIdSet = new Set(findHitIds);
    for (const w of words) {
      if (findHitIdSet.has(w.wordId)) {
        const arr = srcByVerse.get(w.verse) ?? [];
        arr.push(w.wordId);
        srcByVerse.set(w.verse, arr);
      }
    }
    const tvByVerse = new Map<number, string[]>();
    for (const id of findTvHitIds) {
      const dotParts = id.split(":")[2]?.split(".") ?? [];
      const verse = parseInt(dotParts[dotParts.length - 2], 10);
      if (!isNaN(verse)) {
        const arr = tvByVerse.get(verse) ?? [];
        arr.push(id);
        tvByVerse.set(verse, arr);
      }
    }
    const allVerses = [...new Set([...srcByVerse.keys(), ...tvByVerse.keys()])].sort((a, b) => a - b);
    const result: string[] = [];
    for (const verse of allVerses) {
      result.push(...(srcByVerse.get(verse) ?? []));
      result.push(...(tvByVerse.get(verse) ?? []));
    }
    return result;
  }, [words, findHitIds, findTvHitIds]);

  const findFocusId = findAllHitIds[findFocusIdx] ?? null;

  // Sync find refs (after findAllHitIds/findFocusId are initialized)
  useEffect(() => { findHitIdsRef.current = findAllHitIds; }, [findAllHitIds]);
  useEffect(() => { findFocusIdRef.current = findFocusId; }, [findFocusId]);

  // Reset focus index when total hit count changes
  useEffect(() => { setFindFocusIdx(0); }, [findAllHitIds.length]);

  // Scroll to focused hit whenever it changes
  useEffect(() => {
    if (!findFocusId) return;
    document
      .querySelector(`[data-word-id="${CSS.escape(findFocusId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findFocusId]);

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

  function adjustLineHeight(delta: number) {
    setLineHeightMultiplier((prev) => {
      const next = Math.min(2.0, Math.max(0.75, Math.round((prev + delta) * 100) / 100));
      writeLocal("structura:lineHeightMultiplier", next);
      return next;
    });
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
      handleSelectArrowWordById(word.wordId);
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
      handleToggleCharacterRef(word, shiftHeld);
      return;
    }
    if (editingSpeech) {
      if (activeCharId === null) return;
      handleToggleSpeechSection(word, shiftHeld);
      return;
    }
    if (editingWordTags) {
      handleToggleWordTagRef(word, shiftHeld);
      return;
    }
    if (editingTc) {
      handleToggleTcMark(word);
      return;
    }
    setSelectedWord(word);
    setPanelOpen(true);
  }
  // Keep the ref current so the static keydown listener can call it
  handleSelectWordRef.current = handleSelectWord;

  // Directly applies the active annotation to the focused find word, bypassing
  // handleSelectWord's routing guards (editingSpeech, editingArrows, etc.) so
  // Ctrl+E always reaches the annotation toggle regardless of other editing modes.
  tagFocusedFindWordRef.current = function tagFocusedFindWord() {
    const focusId = findFocusIdRef.current;
    if (!focusId) return;
    const abbr = focusId.startsWith("tv:") ? focusId.split(":")[1] : null;
    const source = abbr ?? textSource;
    if (editingRefs && activeCharId !== null) {
      handleToggleCharacterRefById(focusId, source);
    } else if (editingWordTags && activeWordTagId !== null && !pendingWordTag) {
      handleToggleWordTagRefById(focusId, source);
    }
  };

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
        arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null, thematic: false, thematicLetter: null, transitional: false });
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
          arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null, thematic: false, thematicLetter: null, transitional: false });
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

  function applySceneHeadingLocally(wordId: string, level: number, heading: string) {
    const trimmed = heading.trim() || null;
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, heading: trimmed } : b
      );
      next.set(wordId, arr);
      return next;
    });
  }

  async function handleUpdateSceneHeading(wordId: string, level: number, heading: string) {
    applySceneHeadingLocally(wordId, level, heading);
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, heading: heading.trim() || null }),
      });
    } catch {
      // Non-critical; leave optimistic state
    }
  }

  async function handleDeleteCurrentBreak(wordId: string, level: number) {
    const existingArr = sceneBreakMap.get(wordId) ?? [];
    // Optimistic remove from sceneBreakMap
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const filtered = (prev.get(wordId) ?? []).filter((b) => b.level !== level);
      if (filtered.length === 0) next.delete(wordId);
      else next.set(wordId, filtered);
      return next;
    });
    // Remove paragraph break if this was the only section break at this word
    if (existingArr.length === 1) {
      setParagraphBreakIds((prev) => { const next = new Set(prev); next.delete(wordId); return next; });
    }
    try {
      await fetch("/api/scene-breaks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level }),
      });
    } catch {
      // Rollback on error
      setSceneBreakMap((prev) => {
        const next = new Map(prev);
        const arr = [...(prev.get(wordId) ?? []), ...existingArr.filter(b => b.level === level)];
        arr.sort((a, b) => a.level - b.level);
        next.set(wordId, arr);
        return next;
      });
      if (existingArr.length === 1) {
        setParagraphBreakIds((prev) => { const next = new Set(prev); next.add(wordId); return next; });
      }
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
    // Read DOM input values while inputs are still mounted: flush any pending
    // heading text that was typed but not yet blurred, and remove breaks left blank.
    const emptyBreaks: { wordId: string; level: number; verse: number }[] = [];
    for (const [wordId, breaks] of sceneBreakMap) {
      for (const br of breaks) {
        const inputEl = document.getElementById(`scene-heading-${wordId}-${br.level}`) as HTMLInputElement | null;
        const currentValue = inputEl ? inputEl.value.trim() : (br.heading?.trim() ?? "");
        if (!currentValue) {
          emptyBreaks.push({ wordId, level: br.level, verse: br.verse });
        } else if (inputEl && currentValue !== (br.heading?.trim() ?? "")) {
          handleUpdateSceneHeading(wordId, br.level, currentValue);
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

  async function handleUpdateSceneThematic(wordId: string, level: number, thematic: boolean, thematicLetter: string | null) {
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, thematic, thematicLetter: thematic ? thematicLetter : null } : b
      );
      next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, thematic, thematicLetter }),
      });
    } catch {
      // Non-critical; leave optimistic state
    }
  }

  async function handleUpdateSceneTransitional(wordId: string, level: number, transitional: boolean) {
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).map((b) =>
        b.level === level ? { ...b, transitional } : b
      );
      next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level, transitional }),
      });
    } catch {
      // Non-critical; leave optimistic state
    }
  }

  // Line annotation handlers (handleSelectAnnotationSegment, handleCancelAnnotation,
  // handleSaveAnnotation, handleDeleteAnnotation, handleUpdateAnnotation,
  // handleExpandAnnotationRange) are provided by useAnnotationRange above.

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

  function handleToggleCharacterRef(word: Word, shiftHeld = false) {
    if (isPunctuationWord(word)) return;
    if (shiftHeld && refRangeStart !== null) {
      // Apply active character to all words in the range that don't already have it
      const posMap = new Map(words.map((w, i) => [w.wordId, i]));
      const startPos = posMap.get(refRangeStart) ?? 0;
      const endPos   = posMap.get(word.wordId)   ?? 0;
      const [lo, hi] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];
      for (const w of words.slice(lo, hi + 1)) {
        if (isPunctuationWord(w)) continue;
        const existing = characterRefMap.get(w.wordId);
        if (!existing || (existing.character1Id !== activeCharId && existing.character2Id !== activeCharId)) {
          handleToggleCharacterRefById(w.wordId, textSource);
        }
      }
      setRefRangeStart(null);
    } else {
      setRefRangeStart(word.wordId);
      handleToggleCharacterRefById(word.wordId, textSource);
    }
  }

  // Called when a translation word is clicked in refs-editing, word-tag-editing,
  // or formatting mode.
  function handleSelectTranslationWord(wordId: string, abbr: string, shiftHeld = false) {
    if (editingBold || editingItalic) {
      handleToggleFormattingById(wordId, abbr);
      return;
    }
    if (editingRefs && activeCharId !== null) {
      if (shiftHeld && refRangeStart?.startsWith(`tv:${abbr}:`)) {
        const tvList = tvWordIdLists.get(abbr) ?? [];
        const startPos = tvList.indexOf(refRangeStart);
        const endPos   = tvList.indexOf(wordId);
        if (startPos !== -1 && endPos !== -1) {
          const [lo, hi] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];
          for (const id of tvList.slice(lo, hi + 1)) {
            const existing = characterRefMap.get(id);
            if (!existing || (existing.character1Id !== activeCharId && existing.character2Id !== activeCharId)) {
              handleToggleCharacterRefById(id, abbr);
            }
          }
        }
        setRefRangeStart(null);
      } else {
        setRefRangeStart(wordId);
        handleToggleCharacterRefById(wordId, abbr);
      }
    } else if (editingWordTags && activeWordTagId !== null && !pendingWordTag) {
      if (shiftHeld && wordTagRangeStart?.startsWith(`tv:${abbr}:`)) {
        const tvList = tvWordIdLists.get(abbr) ?? [];
        const startPos = tvList.indexOf(wordTagRangeStart);
        const endPos   = tvList.indexOf(wordId);
        if (startPos !== -1 && endPos !== -1) {
          const [lo, hi] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];
          for (const id of tvList.slice(lo, hi + 1)) {
            if (wordTagRefMap.get(id)?.tagId !== activeWordTagId) {
              handleToggleWordTagRefById(id, abbr);
            }
          }
        }
        setWordTagRangeStart(null);
      } else {
        setWordTagRangeStart(wordId);
        handleToggleWordTagRefById(wordId, abbr);
      }
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

  async function handleToggleWordTagRef(word: Word, shiftHeld = false) {
    if (isPunctuationWord(word)) return;
    // Cluster lemma pick mode: route click to callback without creating/toggling a tag
    if (clusterLemmaCallback !== null) {
      const canonicalLemma = word.language === "hebrew"
        ? (word.strongNumber ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      clusterLemmaCallback(canonicalLemma);
      return;
    }
    if (pendingWordTag && pendingWordTagColor !== null) {
      // "Word" type: create a tag named after the lemma and auto-tag ALL matching words
      // in the current chapter via the cluster endpoint.
      const displayName = word.language === "hebrew"
        ? ((hebrewLemmas as Record<string, string>)[word.strongNumber ?? ""]
            ?? word.surfaceText?.replace(/\//g, "")
            ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      const canonicalLemma = word.language === "hebrew"
        ? (word.strongNumber ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      const color = pendingWordTagColor;
      const corpusGroupingId = pendingWordTagCorpusGroupingId;
      setPendingWordTag(false);
      setPendingWordTagColor(null);
      setPendingWordTagCorpusGroupingId(null);
      await handleCreateClusterTag(displayName, [canonicalLemma], color, corpusGroupingId, [book], "word");
      return;
    }
    if (activeWordTagId === null) return;
    if (shiftHeld && wordTagRangeStart !== null) {
      // Apply active tag to all words in the range that don't already have it
      const posMap = new Map(words.map((w, i) => [w.wordId, i]));
      const startPos = posMap.get(wordTagRangeStart) ?? 0;
      const endPos   = posMap.get(word.wordId)       ?? 0;
      const [lo, hi] = startPos <= endPos ? [startPos, endPos] : [endPos, startPos];
      for (const w of words.slice(lo, hi + 1)) {
        if (isPunctuationWord(w)) continue;
        if (wordTagRefMap.get(w.wordId)?.tagId !== activeWordTagId) {
          handleToggleWordTagRefById(w.wordId, textSource);
        }
      }
      setWordTagRangeStart(null);
    } else {
      setWordTagRangeStart(word.wordId);
      await handleToggleWordTagRefById(word.wordId, textSource);
    }
  }

  async function handleCreateTag(
    type: "word" | "concept",
    name: string,
    color: string,
    firstWordId?: string,
    firstWordSource?: string,
    corpusGroupingId?: number | null,
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpusGroupingId ?? null, lemmas: null,
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, type, book, corpusGroupingId: corpusGroupingId ?? null }),
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

  async function handleCreateClusterTag(
    name: string,
    lemmas: string[],
    color: string,
    corpusGroupingId: number | null,
    corpusBooks: string[],
    type: "cluster" | "word" = "cluster",
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpusGroupingId ?? null, lemmas: JSON.stringify(lemmas),
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, book, lemmas, corpusBooks,
          textSource, corpusGroupingId, currentChapter: chapter, type,
        }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

      // Apply chapter refs returned from the server
      const chapterRefs = (data.chapterRefs ?? []) as Array<{ wordId: string; book: string; chapter: number; textSource: string }>;
      if (chapterRefs.length > 0) {
        setWordTagRefMap((prev) => {
          const next = new Map(prev);
          for (const r of chapterRefs) {
            if (!next.has(r.wordId)) {
              next.set(r.wordId, { id: -1, wordId: r.wordId, tagId: realTag.id, textSource: r.textSource, book: r.book, chapter: r.chapter, workspaceId: 0 });
            }
          }
          return next;
        });
      }
    } catch {
      setWordTags((prev) => prev.filter((t) => t.id !== tempTag.id));
      setActiveWordTagId(wordTags[0]?.id ?? null);
    }
  }

  function handleCreateConceptTag(name: string, color: string, corpusGroupingId: number | null) {
    return handleCreateTag("concept", name, color, undefined, undefined, corpusGroupingId);
  }

  function handleCreatePendingWordTag(color: string, corpusGroupingId: number | null) {
    setPendingWordTag(true);
    setPendingWordTagColor(color);
    setPendingWordTagCorpusGroupingId(corpusGroupingId);
  }

  function handleRequestWordClick(cb: (lemma: string) => void) {
    setClusterLemmaCallback(() => cb);
  }

  function handleCancelWordClick() {
    setClusterLemmaCallback(null);
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

  async function handleUpdateWordTag(id: number, name: string, color: string, corpusGroupingId?: number | null, lemmas?: string[] | null) {
    const prev = wordTags.find((t) => t.id === id);
    const lemmasJson = lemmas?.length ? JSON.stringify(lemmas) : null;
    setWordTags((ts) => ts.map((t) => t.id === id ? {
      ...t, name, color,
      corpusGroupingId: corpusGroupingId !== undefined ? corpusGroupingId : t.corpusGroupingId,
      lemmas: lemmas !== undefined ? lemmasJson : t.lemmas,
    } : t));
    try {
      await fetch(`/api/word-tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, corpusGroupingId, lemmas }),
      });
    } catch {
      if (prev) setWordTags((ts) => ts.map((t) => t.id === id ? prev : t));
    }
  }

  async function handleReorderWordTags(orderedIds: number[]) {
    const prev = [...wordTags];
    setWordTags(orderedIds.map((id, i) => {
      const t = prev.find((x) => x.id === id)!;
      return { ...t, sortOrder: i };
    }));
    try {
      await fetch("/api/word-tags/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, sortOrder: i })) }),
      });
    } catch {
      setWordTags(prev);
    }
  }

  async function handleCreateBookGrouping(name: string, books: string[], features: string[]): Promise<import("@/lib/db/schema").BookGrouping> {
    const res = await fetch("/api/book-groupings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, books, features }),
    });
    const data = await res.json();
    const grouping: import("@/lib/db/schema").BookGrouping = data.grouping;
    setBookGroupings((prev) => [...prev, grouping]);
    return grouping;
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
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
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

  async function handleReorderCharacters(orderedIds: number[]) {
    const prev = [...characters];
    setCharacters(orderedIds.map((id, i) => {
      const c = prev.find((x) => x.id === id)!;
      return { ...c, sortOrder: i };
    }));
    try {
      await fetch("/api/characters/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderedIds.map((id, i) => ({ id, sortOrder: i })) }),
      });
    } catch {
      setCharacters(prev);
    }
  }

  // RST relation handlers (handleSelectRstSegment, handleSelectRstGroup,
  // handleCreateRstRelation, handleCancelRstPicker, handleEditRstGroup,
  // handleUpdateRstGroupType, handleDeleteRstGroup, handleUpdateRstIntersectPoint)
  // are provided by useRstRelations above.

  // Word arrow handlers (handleSelectArrowWordById, handleDeleteWordArrow)
  // are provided by useWordArrows above.

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
        case "rstRelations":       setRstRelations([]); break;
        case "wordFormatting":     setWordFormattingMap(new Map()); break;
        case "lineAnnotations":    setLineAnnotations([]); break;
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

  async function handleCopyTransliteration(opts: { format: "interlinear" | "running"; startVerse: number; endVerse: number }) {
    const { buildTransliterationClipboard } = await import("@/lib/utils/transliteration-export");
    const { html, plain } = buildTransliterationClipboard(words, transliterationFormatMap, {
      ...opts,
      book,
      chapter,
    });
    if (!html) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html":  new Blob([html],  { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      // Fallback for browsers that don't support ClipboardItem
      await navigator.clipboard.writeText(plain);
    }
  }

  async function handleSaveTransliterationFormat(wordId: string, format: string | null) {
    setTransliterationFormatMap((prev) => {
      const next = new Map(prev);
      if (format === null) next.delete(wordId);
      else next.set(wordId, format);
      return next;
    });
    try {
      if (format === null) {
        await fetch("/api/interlinear/transliteration-formats", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId }),
        });
      } else {
        await fetch("/api/interlinear/transliteration-formats", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId, format, textSource, book, chapter }),
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

  // ── Text Critical Mark handlers ────────────────────────────────────────────
  async function handleToggleTcMark(word: Word) {
    const { wordId, textSource: wordTextSource } = word;
    const current = tcMarkMap.get(wordId);
    if (current === activeTcMark) {
      // Remove mark
      setTcMarkMap((prev) => { const m = new Map(prev); m.delete(wordId); return m; });
      fetch("/api/text-critical-marks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId }),
      }).catch(() => {});
    } else {
      // Assign active mark
      setTcMarkMap((prev) => new Map(prev).set(wordId, activeTcMark));
      fetch("/api/text-critical-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, markType: activeTcMark, textSource: wordTextSource, book, chapter }),
      }).catch(() => {});
    }
  }

  // Called from VerseDisplay when user clicks an LXX word token in the translation column.
  function handleTcMarkLxxWord(wordId: string, wordTextSource: string) {
    if (!editingTc) return;
    const current = tcMarkMap.get(wordId);
    if (current === activeTcMark) {
      setTcMarkMap((prev) => { const m = new Map(prev); m.delete(wordId); return m; });
      fetch("/api/text-critical-marks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId }),
      }).catch(() => {});
    } else {
      setTcMarkMap((prev) => new Map(prev).set(wordId, activeTcMark));
      fetch("/api/text-critical-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, markType: activeTcMark, textSource: wordTextSource, book, chapter }),
      }).catch(() => {});
    }
  }

  // ── Translation verse text edit handler ────────────────────────────────────
  async function handleUpdateTranslationVerse(abbr: string, verse: number, newText: string, record = true) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);

    // ── Create new record when verse has no existing translation ─────────
    if (!tvRecord) {
      if (!newText.trim()) return; // nothing to save
      try {
        const res = await fetch("/api/translation-verses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            translationId: translation.id,
            book,
            chapter,
            verse,
            text: newText,
          }),
        });
        const { id } = await res.json() as { id: number };
        setLocalTranslationVerseData((prev) => ({
          ...prev,
          [translation.id]: [
            ...(prev[translation.id] ?? []),
            { id, workspaceId: 1, translationId: translation.id, osisRef: `${book}.${chapter}.${verse}`, bookId: 0, chapter, verse, text: newText },
          ],
        }));
      } catch {
        // ignore — verse simply won't appear until next reload
      }
      return;
    }

    const oldText = tvRecord.text;
    if (record && newText !== oldText) {
      pushUndo({
        label: `Edit translation ${abbr} ${verse}`,
        undo: () => handleUpdateTranslationVerse(abbr, verse, oldText, false),
      });
      // Fire-and-forget server-side version snapshot
      fetch("/api/translation-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationId: translation.id,
          osisRef: `${book}.${chapter}.${verse}`,
          text: oldText,
        }),
      }).catch(() => {});
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

  // ── Inline USFM marker insertion ─────────────────────────────────────────────
  // Wraps the current textarea selection with \marker...\marker* (or inserts
  // empty markers with cursor placed inside when there is no selection).
  function applyInlineMarker(marker: string) {
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (!el || el.tagName !== "TEXTAREA" || !el.dataset.translationTextarea) return;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const val = el.value;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (s === e) {
      // No selection — insert empty markers and place cursor inside
      const inserted = `\\${marker} \\${marker}*`;
      const newVal = val.slice(0, s) + inserted + val.slice(s);
      nativeSetter?.call(el, newVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.selectionStart = s + marker.length + 2; // after "\marker "
      el.selectionEnd = s + marker.length + 2;
    } else {
      const selected = val.slice(s, e);
      const inserted = `\\${marker} ${selected}\\${marker}*`;
      const newVal = val.slice(0, s) + inserted + val.slice(e);
      nativeSetter?.call(el, newVal);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.selectionStart = s;
      el.selectionEnd = s + inserted.length;
    }
    el.focus();
  }

  function applyNdMarker() { applyInlineMarker("nd"); }

  // ── Footnote CRUD ────────────────────────────────────────────────────────────

  /**
   * Remove the nth occurrence (0-based) of a `\fn \fn*` marker from a verse
   * text string.  Handles two forms:
   *   "word \fn \fn* more"   → "word more"   (attached-to-preceding-word form)
   *   "\fn \fn* word"        → "word"         (standalone form / fn at start)
   * Collapses any resulting double-spaces to a single space.
   */
  function removeNthFnMarker(text: string, n: number): string {
    const FN_RE = /\s*\\fn\s+\\fn\*/g;
    let count = 0;
    let result = text.replace(FN_RE, (match) => {
      if (count++ === n) return "";
      return match;
    });
    // Collapse double-spaces left behind
    result = result.replace(/  +/g, " ").trim();
    return result;
  }

  /**
   * Returns footnotes for a given (translationId, verse) sorted by wordIndex asc,
   * then id asc — the same order as the `\fn \fn*` markers in the verse text.
   */
  function sortedVerseFootnotes(translationId: number, verse: number): TranslationFootnote[] {
    return (localFootnotes[translationId] ?? [])
      .filter((fn) => fn.verse === verse)
      .sort((a, b) => a.wordIndex - b.wordIndex || a.id - b.id);
  }

  async function handleCreateFootnote() {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === fnDialogAbbr);
    if (!translation || !fnDialogContent.trim()) return;
    try {
      const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === fnDialogVerse);
      const existingText = tvRecord?.text ?? "";
      const anchor = fnAnchorRef.current;
      const insertPos = anchor ? Math.min(anchor.pos, existingText.length) : existingText.length;
      const wordIndex = existingText.slice(0, insertPos).trim().split(/\s+/).filter(Boolean).length;

      const res = await fetch("/api/translation-footnotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationId: translation.id,
          osisRef: `${book}.${chapter}.${fnDialogVerse}`,
          type: fnDialogType,
          content: fnDialogContent.trim(),
          wordIndex,
          book,
          chapter,
          verse: fnDialogVerse,
        }),
      });
      if (res.ok) {
        const { footnote: created }: { footnote: TranslationFootnote } = await res.json();
        setLocalFootnotes((prev) => ({
          ...prev,
          [translation.id]: [...(prev[translation.id] ?? []), created],
        }));
        // Insert \fn \fn* anchor at cursor position (or end if no cursor captured)
        if (tvRecord) {
          const newText = anchor
            ? existingText.slice(0, insertPos) + "\\fn \\fn*" + existingText.slice(insertPos)
            : existingText.trimEnd() + " \\fn \\fn*";
          fnAnchorRef.current = null;
          await handleUpdateTranslationVerse(fnDialogAbbr, fnDialogVerse, newText);
        }
        setFnDialogOpen(false);
        setFnDialogContent("");
      }
    } catch { /* ignore */ }
  }

  async function handleUpdateFootnote() {
    if (fnEditId === null || !fnDialogContent.trim()) return;
    try {
      const res = await fetch("/api/translation-footnotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fnEditId, content: fnDialogContent.trim(), type: fnDialogType }),
      });
      if (res.ok) {
        setLocalFootnotes((prev) => {
          const updated = { ...prev };
          for (const tid of Object.keys(updated)) {
            updated[Number(tid)] = (updated[Number(tid)] ?? []).map((fn) =>
              fn.id === fnEditId ? { ...fn, content: fnDialogContent.trim(), type: fnDialogType } : fn
            );
          }
          return updated;
        });
        setFnDialogOpen(false);
        setFnEditId(null);
        setFnDialogContent("");
      }
    } catch { /* ignore */ }
  }

  function openEditFootnote(fn: TranslationFootnote) {
    const translation = allAvailableTranslations.find((t) => t.id === fn.translationId);
    setFnEditId(fn.id);
    setFnDialogAbbr(translation?.abbreviation ?? "");
    setFnDialogVerse(fn.verse);
    setFnDialogType(fn.type as "f" | "x");
    setFnDialogContent(fn.content);
    setFnAnchorMoveId(null); // clear any pending move
    setFnDialogOpen(true);
  }

  /** Called from VerseDisplay when the user clicks a word during anchor-move mode. */
  async function handleMoveFootnoteAnchor(fnId: number, newWordIndex: number) {
    // Find the footnote record
    let targetFn: TranslationFootnote | undefined;
    for (const fns of Object.values(localFootnotes)) {
      targetFn = fns.find((fn) => fn.id === fnId);
      if (targetFn) break;
    }
    if (!targetFn) { setFnAnchorMoveId(null); return; }

    const { translationId, verse } = targetFn;
    const translation = allAvailableTranslations.find((t) => t.id === translationId);
    if (!translation) { setFnAnchorMoveId(null); return; }

    // Rank of this footnote among same-verse footnotes (sorted order)
    const siblings = sortedVerseFootnotes(translationId, verse);
    const rank = siblings.findIndex((fn) => fn.id === fnId);
    if (rank < 0) { setFnAnchorMoveId(null); return; }

    // Current verse text
    const tvRecord = localTranslationVerseData[translationId]?.find((tv) => tv.verse === verse);
    if (!tvRecord) { setFnAnchorMoveId(null); return; }

    // Remove the nth \fn \fn* from the verse text
    let newText = removeNthFnMarker(tvRecord.text, rank);

    // Re-insert \fn \fn* after the word at newWordIndex.
    // Split into tokens (preserving spacing).  IMPORTANT: skip raw USFM command tokens
    // (those starting with \) when counting toward newWordIndex.  After removeNthFnMarker
    // the remaining \fn \fn* markers are still present as raw tokens, and globalWi from
    // VerseDisplay counts only visible/encoded words (never \fn, \fn*, \nd*, etc.).
    const tokens = newText.split(/(\s+)/);
    let wordCount = 0;
    let insertPos = tokens.length; // default: append at end
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].trim() && !tokens[i].startsWith("\\")) {
        if (wordCount === newWordIndex) { insertPos = i; break; }
        wordCount++;
      }
    }
    tokens.splice(insertPos + 1, 0, " \\fn \\fn*");
    newText = tokens.join("").replace(/  +/g, " ").trim();

    try {
      // Save updated verse text
      await handleUpdateTranslationVerse(translation.abbreviation, verse, newText);

      // Persist new wordIndex
      await fetch("/api/translation-footnotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fnId, content: targetFn.content, wordIndex: newWordIndex }),
      });

      // Update local state
      setLocalFootnotes((prev) => {
        const updated = { ...prev };
        updated[translationId] = (updated[translationId] ?? []).map((fn) =>
          fn.id === fnId ? { ...fn, wordIndex: newWordIndex } : fn
        );
        return updated;
      });
    } catch { /* ignore */ }

    setFnAnchorMoveId(null);
  }

  async function openChapterUsfm() {
    const t = allAvailableTranslations.find((t) => activeTranslationAbbrs.has(t.abbreviation));
    if (!t) return;
    setChapterUsfmOpen(true);
    setChapterUsfmError(null);
    setChapterUsfmLoading(true);
    try {
      const res = await fetch(`/api/export/usfm?translationId=${t.id}&book=${book}&chapter=${chapter}`);
      const text = await res.text();
      setChapterUsfmText(text);
    } catch {
      setChapterUsfmError("Failed to load chapter USFM.");
    } finally {
      setChapterUsfmLoading(false);
    }
  }

  async function saveChapterUsfm() {
    const t = allAvailableTranslations.find((tr) => activeTranslationAbbrs.has(tr.abbreviation));
    if (!t) return;
    setChapterUsfmSaving(true);
    setChapterUsfmError(null);
    try {
      const res = await fetch("/api/chapter-usfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translationId: t.id, book, chapter, usfm: chapterUsfmText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setChapterUsfmOpen(false);
      // Reload the page to reflect updated verse data
      window.location.reload();
    } catch (e: unknown) {
      setChapterUsfmError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setChapterUsfmSaving(false);
    }
  }

  async function handleDeleteFootnote(translationId: number, fnId: number) {
    // First remove the \fn \fn* anchor from the verse text so no ghost marker remains.
    const targetFn = (localFootnotes[translationId] ?? []).find((fn) => fn.id === fnId);
    if (targetFn) {
      const translation = allAvailableTranslations.find((t) => t.id === translationId);
      if (translation) {
        const siblings = sortedVerseFootnotes(translationId, targetFn.verse);
        const rank = siblings.findIndex((fn) => fn.id === fnId);
        const tvRecord = localTranslationVerseData[translationId]?.find((tv) => tv.verse === targetFn.verse);
        if (tvRecord && rank >= 0) {
          const newText = removeNthFnMarker(tvRecord.text, rank);
          if (newText !== tvRecord.text) {
            await handleUpdateTranslationVerse(translation.abbreviation, targetFn.verse, newText);
          }
        }
      }
    }
    try {
      await fetch(`/api/translation-footnotes?id=${fnId}`, { method: "DELETE" });
      setLocalFootnotes((prev) => ({
        ...prev,
        [translationId]: (prev[translationId] ?? []).filter((fn) => fn.id !== fnId),
      }));
    } catch { /* ignore */ }
  }

  // ── Version history ──────────────────────────────────────────────────────────
  async function openHistory(abbr: string, verse: number) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    setHistoryAbbr(abbr);
    setHistoryVerse(verse);
    setHistoryOpen(true);
    try {
      const res = await fetch(
        `/api/translation-versions?translationId=${translation.id}&osisRef=${encodeURIComponent(`${book}.${chapter}.${verse}`)}`
      );
      if (res.ok) setHistoryVersions((await res.json()).versions ?? []);
    } catch { /* ignore */ }
  }

  async function handleRestoreVersion(versionText: string) {
    await handleUpdateTranslationVerse(historyAbbr, historyVerse, versionText, true);
    setHistoryOpen(false);
  }

  // ── Mode mutual-exclusivity ────────────────────────────────────────────────
  // Compatible groups (may be active simultaneously):
  //   A: indent (compatible with paragraph, speech, rst)
  //   B: bold + italic
  //   C: speech + rst + indent
  // All other combinations are mutually incompatible.
  // Modes that are mutually exclusive with each other (only one may be active):
  //   refs, speech, arrows, wordTags, paragraph
  // Each lists everything it is COMPATIBLE with — i.e., everything except the
  // other annotation-editing modes.
  const NON_ANNOTATION = ["paragraph", "scenes", "annotations", "indents", "rst"] as const;
  const COMPAT: Record<string, string[]> = {
    paragraph:   ["indents"],
    indents:     ["paragraph", "speech", "rst"],
    bold:        ["italic"],
    italic:      ["bold"],
    speech:      ["rst", "indents", "scenes", "annotations"],
    rst:         ["speech", "indents"],
    arrows:      [...NON_ANNOTATION],
    scenes:      [],
    annotations: [],
    refs:        ["annotations", "indents", "rst"],
    wordTags:    ["annotations", "indents", "rst"],
  };
  function deactivateIncompatible(mode: string) {
    const keep = new Set([mode, ...(COMPAT[mode] ?? [])]);
    if (!keep.has("paragraph"))   setEditingParagraphs(false);
    if (!keep.has("scenes"))      setEditingScenes(false);
    if (!keep.has("annotations")) { setEditingAnnotations(false); setAnnotRangeStart(null); setAnnotRangeEnd(null); }
    if (!keep.has("refs"))        { setEditingRefs(false); setRefRangeStart(null); }
    if (!keep.has("speech"))      { setEditingSpeech(false); setSpeechRangeStart(null); }
    if (!keep.has("wordTags"))    { setEditingWordTags(false); setPendingWordTag(false); setWordTagRangeStart(null); }
    if (!keep.has("indents"))     setEditingIndents(false);
    if (!keep.has("rst"))         { setEditingRst(false); setRstSegA(null); setRstSegB(null); setShowRstPicker(false); setRstEditGroupId(null); }
    if (!keep.has("arrows"))      { setEditingArrows(false); setArrowFromWordId(null); }
    if (!keep.has("bold"))        setEditingBold(false);
    if (!keep.has("italic"))      setEditingItalic(false);
    if (!keep.has("footnotes"))   { setEditingFootnotes(false); setFnAnchorMoveId(null); }
  }

  return (
    <div className="relative h-full min-h-0 flex flex-row">
      <AddressBar open={addressBarOpen} onClose={() => setAddressBarOpen(false)} textSource={textSource} />
      {/* Main text area — takes remaining width; notes pane sits to the right */}
      <div className="flex-1 min-w-0 relative min-h-0 flex flex-col" ref={outerRef}>
        {/* Scrollable text container — both overlays live INSIDE so they scroll
            with the content and use stable scroll-canvas coordinates. */}
        <div
          className="flex-1 overflow-y-auto relative flex flex-col min-h-0"
          ref={textContainerRef}
        >
          <ChapterOverlays
            rstRelations={rstRelations}
            tvRstRelations={!rstRelationsLinked ? tvRstRelations : undefined}
            editingTranslation={editingRst && !rstRelationsLinked && rstEditingSide === "translation"}
            editingRst={editingRst}
            rstSegA={rstSegA}
            rstSegB={rstSegB}
            rstSegAGroupId={rstSegAGroupId}
            rstEditGroupId={rstEditGroupId}
            paragraphFirstWordIds={paragraphFirstWordIds}
            customRstTypes={customRstTypes}
            isHebrew={isHebrew}
            hasTranslation={hasActiveTranslations}
            hideSourceTree={hideSourceText}
            onSelectRstSegment={handleSelectRstSegment}
            onSelectRstGroup={handleSelectRstGroup}
            onDeleteRstGroup={handleDeleteRstGroup}
            onEditRstGroup={handleEditRstGroup}
            onUpdateRstIntersectPoint={handleUpdateRstIntersectPoint}
            onRequiredSourcePad={setRstSourcePad}
            wordArrows={wordArrowsState}
            editingArrows={editingArrows}
            arrowFromWordId={arrowFromWordId}
            onDeleteArrow={handleDeleteWordArrow}
            onUpdateArrow={handleUpdateWordArrow}
            containerRef={textContainerRef}
            layoutRef={outerRef}
          />
        {/* Chapter heading strip — hidden in presentation mode */}
        {!presentationMode && headingSlot}

        {/* Sticky control area: toolbar + all editing panels/hints */}
        {!hideToolbar && <div className="sticky top-0 z-20 shrink-0 flex flex-col" style={{ backgroundColor: "var(--background)" }}>

        {/* Toolbar */}
        {tbTooltip && (
          <div
            className="fixed z-[200] pointer-events-none px-2 py-1 rounded bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[15px] max-w-xs shadow-lg"
            style={
              tbTooltip.x > window.innerWidth * 0.65
                ? { right: window.innerWidth - tbTooltip.x + 8, top: tbTooltip.y + 16 }
                : { left: tbTooltip.x + 12, top: tbTooltip.y + 16 }
            }
          >
            {tbTooltip.text}
          </div>
        )}
        <div
          className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4 flex-wrap"
          onMouseMove={handleToolbarMouseMove}
          onMouseLeave={() => setTbTooltip(null)}
        >

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
                setRefRangeStart(null);
                setWordTagRangeStart(null);
                setRstSegA(null);
                setRstSegB(null);
                setShowRstPicker(false);
                setArrowFromWordId(null);
                setNotesOpen(false);
                setPanelOpen(false);
              }
            }}
            data-tip={presentationMode ? t("toolbar.titlePresentationOn") : t("toolbar.titlePresentationOff")}
            className={[
              "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
              presentationMode
                ? "bg-sky-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ⊞
          </button>

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
                  minVerse={words.length ? Math.min(...words.map((w) => w.verse)) : 1}
                  maxVerse={words.length ? Math.max(...words.map((w) => w.verse)) : 1}
                  onCopyTransliteration={handleCopyTransliteration}
                />
              )}
              {toolbarVis.tooltips && <button
                onClick={() => setShowTooltips((v) => !v)}
                data-tip={showTooltips ? t("toolbar.titleTooltipsOn") : t("toolbar.titleTooltipsOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  showTooltips
                    ? "bg-blue-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                {t("toolbar.tooltips")}
              </button>}

              {/* Linguistic terms toggle — Hebrew only */}
              {isHebrew && toolbarVis.qatal && (
                <button
                  onClick={() => setUseLinguisticTerms((v) => !v)}
                  data-tip={useLinguisticTerms
                    ? t("toolbar.titleLinguisticOn")
                    : t("toolbar.titleLinguisticOff")}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    useLinguisticTerms
                      ? "bg-blue-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  Qatal
                </button>
              )}

              {/* Vowel / cantillation toggles — Hebrew only */}
              {isHebrew && (
                <button
                  onClick={() => setShowVowels((v) => !v)}
                  data-tip={showVowels ? "Hide Hebrew vowel points" : "Show Hebrew vowel points"}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showVowels
                      ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      : "bg-amber-500 text-white",
                  ].join(" ")}
                >
                  Vowels
                </button>
              )}
              {isHebrew && (
                <button
                  onClick={() => setShowCantillation((v) => !v)}
                  data-tip={showCantillation ? "Hide Hebrew cantillation marks" : "Show Hebrew cantillation marks"}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showCantillation
                      ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      : "bg-amber-500 text-white",
                  ].join(" ")}
                >
                  Cantillation
                </button>
              )}

              <div className="h-5 border-l border-[var(--border)]" />

              {/* Atnach marker — Hebrew only */}
              {isHebrew && toolbarVis.atnach && (
                <button
                  onClick={() => setShowAtnachBreaks((v) => !v)}
                  data-tip={showAtnachBreaks
                    ? "Hide atnach half-verse markers"
                    : "Show atnach accent markers (main cantillation accent dividing each verse)"}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showAtnachBreaks
                      ? "bg-violet-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  Atnach
                </button>
              )}

              {/* Scene / episode break mode */}
              {toolbarVis.scenes && <button
                onClick={() => { if (editingScenes) { handleExitSceneEditing(); } else { deactivateIncompatible("scenes"); setEditingScenes(true); } }}
                data-tip={editingScenes
                  ? t("toolbar.titleSectionOn")
                  : t("toolbar.titleSectionOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingScenes
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                §
              </button>}

              {/* Outline sidebar toggle */}
              {toolbarVis.outline && (sceneBreakMap.size > 0 || bookSceneBreaks.length > 0 || !!predecessorBook) && (
                <button
                  type="button"
                  onClick={() => setOutlineOpen((v) => !v)}
                  className={[
                    "shrink-0 text-[13px] px-3 py-1.5 rounded transition-colors",
                    outlineOpen
                      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                  data-tip={t("toolbar.titleCopyOutline")}
                >
                  {t("toolbar.outline")}
                </button>
              )}

              {/* Line annotation mode */}
              {toolbarVis.annotations && <button
                onClick={() => {
                  if (!editingAnnotations) deactivateIncompatible("annotations");
                  setEditingAnnotations((v) => !v);
                }}
                data-tip={editingAnnotations
                  ? t("toolbar.titleAnnotationOn")
                  : t("toolbar.titleAnnotationOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingAnnotations
                    ? "bg-indigo-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ≡
              </button>}

              {/* ¶ Atnach insert — Hebrew only */}
              {isHebrew && toolbarVis.atnachInsert && (
                <button
                  onClick={handleAddAtnachParagraphBreaks}
                  data-tip="Insert paragraph breaks at every atnach accent in this chapter"
                  className="px-3 py-1.5 rounded text-[13px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                >
                  ¶ Atnach
                </button>
              )}

              {/* Paragraph edit mode toggle */}
              {toolbarVis.paragraphs && <button
                onClick={() => { if (!editingParagraphs) deactivateIncompatible("paragraph"); setEditingParagraphs((v) => !v); }}
                data-tip={editingParagraphs
                  ? t("toolbar.titleParagraphOn")
                  : t("toolbar.titleParagraphOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingParagraphs
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ¶
              </button>}

              {/* Paragraph indent mode */}
              {toolbarVis.indents && <button
                onClick={() => {
                  if (!editingIndents) deactivateIncompatible("indents");
                  setEditingIndents((v) => !v);
                }}
                data-tip={editingIndents
                  ? t("toolbar.titleIndentOn")
                  : t("toolbar.titleIndentOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingIndents
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ⇥
              </button>}

              {/* Source/translation indent link toggle — visible only in indent mode */}
              {editingIndents && (
                <label
                  className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
                  data-tip={indentsLinked
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
              {toolbarVis.rst && <button
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
                data-tip={editingRst
                  ? t("toolbar.titleRstOn")
                  : t("toolbar.titleRstOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingRst
                    ? "bg-rose-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                ↳
              </button>}
              {toolbarVis.rst && editingRst && (
                <button
                  onClick={() => setShowRstTypeManager((v) => !v)}
                  data-tip={t("toolbar.titleRstLabels")}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showRstTypeManager
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  {t("toolbar.rstLabels")}
                </button>
              )}
              {toolbarVis.rst && editingRst && hasActiveTranslations && (
                <>
                  <label
                    className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
                    data-tip={rstRelationsLinked ? t("toolbar.titleRstLinked") : t("toolbar.titleRstUnlinked")}
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
                        data-tip={t("toolbar.titleRstSrcSide")}
                        className={[
                          "px-2 py-[3px] rounded text-[11px] font-medium transition-colors",
                          rstEditingSide === "source"
                            ? "bg-rose-600 text-white"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
                        ].join(" ")}
                      >
                        Src
                      </button>
                      <button
                        onClick={() => setRstEditingSide("translation")}
                        data-tip={t("toolbar.titleRstTransSide")}
                        className={[
                          "px-2 py-[3px] rounded text-[11px] font-medium transition-colors",
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
              {toolbarVis.arrows && <button
                onClick={() => {
                  const entering = !editingArrows;
                  if (entering) {
                    deactivateIncompatible("arrows");
                  } else {
                    setArrowFromWordId(null);
                  }
                  setEditingArrows(entering);
                }}
                data-tip={editingArrows
                  ? t("toolbar.titleArrowOn")
                  : t("toolbar.titleArrowOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingArrows
                    ? "bg-rose-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
                  <path d="M2,3 C2,9 18,9 18,3" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="2"  cy="3" r="2" fill="currentColor" />
                  <circle cx="18" cy="3" r="2" fill="currentColor" />
                </svg>
              </button>}

              <div className="h-5 border-l border-[var(--border)]" />

              {/* Bold formatting mode */}
              {toolbarVis.bold && <button
                disabled={editingWordTags}
                onClick={() => {
                  if (!editingBold) deactivateIncompatible("bold");
                  setEditingBold((v) => !v);
                }}
                data-tip={editingWordTags ? t("toolbar.titleBoldDisabled") : editingBold ? t("toolbar.titleBoldOn") : t("toolbar.titleBoldOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-bold transition-colors",
                  editingBold
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                B
              </button>}

              {/* Italic formatting mode */}
              {toolbarVis.italic && <button
                disabled={editingWordTags}
                onClick={() => {
                  if (!editingItalic) deactivateIncompatible("italic");
                  setEditingItalic((v) => !v);
                }}
                data-tip={editingWordTags ? t("toolbar.titleItalicDisabled") : editingItalic ? t("toolbar.titleItalicOn") : t("toolbar.titleItalicOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] italic transition-colors",
                  editingItalic
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                I
              </button>}

              {/* Text Critical markup mode */}
              <button
                onClick={() => setEditingTc((v) => !v)}
                data-tip={editingTc ? "Exit text-critical mode" : "Text critical markup (MT/LXX)"}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-bold transition-colors",
                  editingTc
                    ? "bg-indigo-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                TC
              </button>
              {editingTc && (
                <>
                  <button
                    onClick={() => setActiveTcMark("lxx_unique")}
                    data-tip="LXX Unique (green)"
                    className={[
                      "w-7 h-7 rounded transition-colors border-2",
                      activeTcMark === "lxx_unique"
                        ? "border-green-600 bg-green-600"
                        : "border-green-600 bg-transparent hover:bg-green-100 dark:hover:bg-green-900",
                    ].join(" ")}
                    style={{ color: "#16a34a" }}
                    title="LXX Unique (green)"
                  >
                    <span className="sr-only">LXX Unique</span>
                  </button>
                  <button
                    onClick={() => setActiveTcMark("mt_unique")}
                    data-tip="MT Unique (red)"
                    className={[
                      "w-7 h-7 rounded transition-colors border-2",
                      activeTcMark === "mt_unique"
                        ? "border-red-600 bg-red-600"
                        : "border-red-600 bg-transparent hover:bg-red-100 dark:hover:bg-red-900",
                    ].join(" ")}
                    title="MT Unique (red)"
                  >
                    <span className="sr-only">MT Unique</span>
                  </button>
                  <button
                    onClick={() => setActiveTcMark("same_different")}
                    data-tip="Same meaning, different form (yellow)"
                    className={[
                      "w-7 h-7 rounded transition-colors border-2",
                      activeTcMark === "same_different"
                        ? "border-yellow-500 bg-yellow-500"
                        : "border-yellow-500 bg-transparent hover:bg-yellow-100 dark:hover:bg-yellow-900",
                    ].join(" ")}
                    title="Same meaning, different form (yellow)"
                  >
                    <span className="sr-only">Same Meaning</span>
                  </button>
                </>
              )}

              {/* Character reference tag mode */}
              {toolbarVis.refs && <button
                onClick={() => {
                  if (!editingRefs) deactivateIncompatible("refs");
                  setEditingRefs((v) => !v);
                }}
                data-tip={editingRefs ? t("toolbar.titleRefsOn") : t("toolbar.titleRefsOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingRefs
                    ? "bg-violet-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                👤
              </button>}

              {/* Speech section tag mode */}
              {toolbarVis.speech && <button
                onClick={() => {
                  if (!editingSpeech) deactivateIncompatible("speech");
                  setEditingSpeech((v) => !v);
                }}
                data-tip={editingSpeech
                  ? t("toolbar.titleSpeechOn")
                  : t("toolbar.titleSpeechOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingSpeech
                    ? "bg-violet-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                💬
              </button>}

              {/* Word / concept tag mode */}
              {toolbarVis.wordTags && <button
                onClick={() => {
                  if (!editingWordTags) deactivateIncompatible("wordTags");
                  setEditingWordTags((v) => !v);
                }}
                data-tip={editingWordTags
                  ? t("toolbar.titleWordTagOn")
                  : t("toolbar.titleWordTagOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingWordTags
                    ? "bg-yellow-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                🏷
              </button>}

              <div className="h-5 border-l border-[var(--border)]" />

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
                  data-tip={t("toolbar.titleUndo", { label: undoStack[undoStack.length - 1].label })}
                  className="px-3 py-1.5 rounded text-[13px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  ↩ {undoStack[undoStack.length - 1].label}
                </button>
              )}

              {/* Clear annotations */}
              {toolbarVis.clear && <button
                onClick={() => setShowClearDialog(true)}
                data-tip={t("toolbar.titleClear")}
                className="px-3 py-1.5 rounded text-[13px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                🗑
              </button>}

              <div className="h-5 border-l border-[var(--border)]" />

              {/* Notes panel toggle */}
              {toolbarVis.notes && <button
                onClick={() => setNotesOpen((v) => !v)}
                data-tip={notesOpen ? t("toolbar.titleNotesOn") : t("toolbar.titleNotesOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  notesOpen
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                📝
              </button>}

              {/* Search panel toggle */}
              {toolbarVis.search && <button
                onClick={() => setSearchOpen((v) => !v)}
                data-tip={searchOpen ? "Close Search" : "Search corpus"}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  searchOpen
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                🔍
              </button>}

              {/* Bible lookup panel toggle */}
              {toolbarVis.bible && <button
                onClick={() => setBibleOpen((v) => !v)}
                data-tip={bibleOpen ? "Close Bible Lookup" : "Bible Lookup"}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  bibleOpen
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                📖
              </button>}

              {/* Intertextual links panel toggle */}
              {toolbarVis.intertextual && <button
                onClick={() => setIntertextualOpen((v) => !v)}
                data-tip={intertextualOpen ? "Close Intertextual Links" : "Intertextual Links"}
                className={[
                  "px-[14px] py-[7px] rounded font-medium transition-colors",
                  intertextualOpen
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <line x1="8" y1="8" x2="8" y2="1" stroke="currentColor" strokeWidth="0.8"/>
                  <line x1="8" y1="8" x2="14.1" y2="4.5" stroke="currentColor" strokeWidth="0.8"/>
                  <line x1="8" y1="8" x2="14.1" y2="11.5" stroke="currentColor" strokeWidth="0.8"/>
                  <line x1="8" y1="8" x2="8" y2="15" stroke="currentColor" strokeWidth="0.8"/>
                  <line x1="8" y1="8" x2="1.9" y2="11.5" stroke="currentColor" strokeWidth="0.8"/>
                  <line x1="8" y1="8" x2="1.9" y2="4.5" stroke="currentColor" strokeWidth="0.8"/>
                  <path d="M8 5.7 L9.99 6.85 L9.99 9.15 L8 10.3 L6.01 9.15 L6.01 6.85 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
                  <path d="M8 3.4 L11.98 5.7 L11.98 10.3 L8 12.6 L4.02 10.3 L4.02 5.7 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
                  <path d="M8 1 L14.06 4.5 L14.06 11.5 L8 15 L1.94 11.5 L1.94 4.5 Z" stroke="currentColor" strokeWidth="0.75" fill="none"/>
                </svg>
              </button>}

              <div className="h-5 border-l border-[var(--border)]" />

              {/* Translation picker + source visibility toggle + translation edit */}
              {toolbarVis.translations && allAvailableTranslations.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">
                    {t("toolbar.trLabel")}
                  </span>
                  <TranslationPicker
                    availableTranslations={allAvailableTranslations}
                    activeTranslationIds={activeTranslationIds}
                    systemTranslationIds={systemTranslationIds}
                    onToggle={toggleTranslation}
                    currentBook={book}
                  />
                  {hasActiveTranslations && (
                    <button
                      onClick={() => setHideSourceText((v) => !v)}
                      data-tip={hideSourceText ? t("toolbar.titleShowSource", { source: textSource }) : t("toolbar.titleHideSource", { source: textSource })}
                      className={[
                        "px-3 py-1.5 rounded text-[13px] font-medium font-mono transition-colors",
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
                      onClick={() => { setEditingTranslation((v) => !v); setEditingTranslationSource(false); }}
                      data-tip={editingTranslation ? t("toolbar.titleEditTranslationOn") : t("toolbar.titleEditTranslationOff")}
                      className={[
                        "px-4 py-2 rounded text-[17px] font-medium transition-colors",
                        editingTranslation
                          ? "bg-sky-600 text-white"
                          : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                      ].join(" ")}
                    >
                      ✏
                    </button>
                  )}
                  {hasActiveTranslations && (
                    <button
                      onClick={openChapterUsfm}
                      data-tip="View / edit USFM source"
                      className="px-3 py-2 rounded text-[16px] font-mono font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    >
                      {"‹›"}
                    </button>
                  )}
                  {/* Translation editing sub-toolbar — only shown when edit mode is active */}
                  {hasActiveTranslations && editingTranslation && (
                    <>
                      {/* Divine Name: wraps textarea selection in \nd...\nd* */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); applyNdMarker(); }}
                        data-tip="Wrap selection as Divine Name (small caps) — \nd...\nd*"
                        className="px-3 py-2 rounded text-[14px] font-bold font-mono tracking-wider transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900 dark:hover:text-amber-300"
                        style={{ fontVariant: "small-caps" }}
                      >
                        nd
                      </button>
                      {/* Bold: wraps selection in \bd...\bd* */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); applyInlineMarker("bd"); }}
                        data-tip="Wrap selection as bold text — \bd...\bd*"
                        className="px-3 py-2 rounded text-[14px] font-bold transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      >
                        B
                      </button>
                      {/* Italic: wraps selection in \it...\it* */}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); applyInlineMarker("it"); }}
                        data-tip="Wrap selection as italic text — \it...\it*"
                        className="px-3 py-2 rounded text-[14px] italic transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      >
                        I
                      </button>
                      {/* Add Footnote button */}
                      <button
                        onMouseDown={() => {
                          const el = document.activeElement as HTMLTextAreaElement | null;
                          const isTA = el?.tagName === "TEXTAREA" && el.dataset.translationTextarea === "true";
                          fnAnchorRef.current = isTA ? { el, pos: el.selectionStart ?? el.value.length } : null;
                        }}
                        onClick={() => {
                          const anchor = fnAnchorRef.current;
                          const activeVerse = anchor ? (parseInt(anchor.el.dataset.verse ?? "") || chapter) : chapter;
                          const activeAbbr = anchor?.el.dataset.abbr ?? "";
                          const firstAbbr = activeAbbr || ([...activeTranslationIds]
                            .map((id) => allAvailableTranslations.find((tr) => tr.id === id))
                            .find((tr) => tr)?.abbreviation ?? "");
                          setFnEditId(null);
                          setFnDialogAbbr(firstAbbr);
                          setFnDialogVerse(activeVerse);
                          setFnDialogType("f");
                          setFnDialogContent("");
                          setFnDialogOpen(true);
                        }}
                        data-tip="Add a footnote or cross-reference to a verse"
                        className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      >
                        fn+
                      </button>
                      {/* History button */}
                      <button
                        onClick={() => {
                          const firstAbbr = [...activeTranslationIds]
                            .map((id) => allAvailableTranslations.find((tr) => tr.id === id))
                            .find((tr) => tr)?.abbreviation ?? "";
                          openHistory(firstAbbr, 1);
                        }}
                        data-tip="View version history for a verse"
                        className={[
                          "px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors",
                          historyOpen
                            ? "bg-violet-600 text-white"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                        ].join(" ")}
                      >
                        ⏱
                      </button>
                    </>
                  )}
                  {/* Show/hide footnotes — visible whenever a translation is active */}
                  {hasActiveTranslations && (
                    <button
                      onClick={() => setShowFootnotes((v) => !v)}
                      data-tip={showFootnotes ? "Hide footnotes" : "Show footnotes"}
                      className={[
                        "px-3 py-2 rounded text-[14px] font-medium transition-colors",
                        showFootnotes
                          ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                          : "bg-stone-300 dark:bg-stone-600 text-stone-500 dark:text-stone-400",
                      ].join(" ")}
                    >
                      fn
                    </button>
                  )}
                  {/* Edit-footnotes mode — reveals the × delete button on footnotes */}
                  {hasActiveTranslations && showFootnotes && (
                    <button
                      onClick={() => setEditingFootnotes((v) => !v)}
                      data-tip={editingFootnotes ? "Exit footnote editing" : "Edit footnotes (enable delete)"}
                      className={[
                        "px-3 py-2 rounded text-[14px] font-medium transition-colors",
                        editingFootnotes
                          ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 ring-1 ring-amber-400"
                          : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                      ].join(" ")}
                    >
                      fn✎
                    </button>
                  )}
                  {/* Anchor-move mode — cancel chip */}
                  {fnAnchorMoveId !== null && (
                    <button
                      onClick={() => setFnAnchorMoveId(null)}
                      className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 ring-1 ring-sky-400 animate-pulse"
                    >
                      Click word to place anchor · Esc to cancel
                    </button>
                  )}
                </div>
              )}

              {/* Font size controls */}
              {(() => {
                const sizeBtn = "w-[26px] h-[26px] flex items-center justify-center rounded text-[13px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors select-none";
                return (
                  <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                    <span className="text-xs text-stone-400 dark:text-stone-500 select-none">
                      {isHebrew ? t("toolbar.sourceLabel") : t("toolbar.sourceLabelGk")}
                    </span>
                    <button className={sizeBtn} onClick={() => adjustFontSize("source", -0.125)} data-tip={t("toolbar.titleDecreaseSource")}>A−</button>
                    <button className={sizeBtn} onClick={() => adjustFontSize("source", +0.125)} data-tip={t("toolbar.titleIncreaseSource")}>A+</button>
                    {hasActiveTranslations && (
                      <>
                        <span className="text-xs text-stone-400 dark:text-stone-500 select-none ml-1">{t("toolbar.trSizeLabel")}</span>
                        <button className={sizeBtn} onClick={() => adjustFontSize("translation", -0.0625)} data-tip={t("toolbar.titleDecreaseTr")}>A−</button>
                        <button className={sizeBtn} onClick={() => adjustFontSize("translation", +0.0625)} data-tip={t("toolbar.titleIncreaseTr")}>A+</button>
                      </>
                    )}
                    <span className="text-xs text-stone-400 dark:text-stone-500 select-none ml-1">↕</span>
                    <button className={sizeBtn} onClick={() => adjustLineHeight(-0.1)} data-tip="Decrease line spacing">−</button>
                    <button className={sizeBtn} onClick={() => adjustLineHeight(+0.1)} data-tip="Increase line spacing">+</button>
                  </div>
                );
              })()}

          </>

          {/* Copy-link button — copies a ?present URL for browser / Reveal.js use */}
          <button
            onClick={handleCopyPresentLink}
            data-tip={linkCopied ? "Copied!" : "Copy link for browser / iframe (localhost URL with ?present)"}
            className="px-3 py-1.5 rounded text-[13px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
          >
            {linkCopied ? "✓" : "🔗"}
          </button>

          {/* Gear button — toolbar customizer, always visible */}
          <div className="ml-auto">
            <button
              ref={gearBtnRef}
              onClick={() => setShowToolbarCustomizer((v) => !v)}
              data-tip="Customize toolbar"
              className={[
                "px-4 py-2 rounded text-[17px] font-medium transition-colors",
                showToolbarCustomizer
                  ? "bg-stone-300 dark:bg-stone-600 text-stone-700 dark:text-stone-200"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >
              ⚙
            </button>
            {showToolbarCustomizer && (
              <ToolbarCustomizer
                visibility={toolbarVis}
                onChange={setToolbarItemVis}
                onClose={() => setShowToolbarCustomizer(false)}
                anchorRef={gearBtnRef}
              />
            )}
          </div>
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
            onReorder={handleReorderCharacters}
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
            currentBook={book}
            bookGroupings={bookGroupings}
            clusterPickingActive={clusterLemmaCallback !== null}
            onSelectTag={(id) => {
              setActiveWordTagId(id);
              setPendingWordTag(false);
            }}
            onCreateConceptTag={handleCreateConceptTag}
            onCreatePendingWordTag={handleCreatePendingWordTag}
            onCreateClusterTag={handleCreateClusterTag}
            onDeleteTag={handleDeleteWordTag}
            onUpdateTag={handleUpdateWordTag}
            onReorder={handleReorderWordTags}
            onToggleHighlight={handleToggleWordTagHighlight}
            onCreateGrouping={handleCreateBookGrouping}
            onRequestWordClick={handleRequestWordClick}
            onCancelWordClick={handleCancelWordClick}
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
            style={{ backgroundColor: "var(--nav-bg)", flexDirection: "column" }}
          >
            {/* Coordinate row */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium w-14 shrink-0" style={{ color: "var(--nav-fg-muted)" }}>
                {t("toolbar.rstCoord")}
              </span>
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
            </div>
            {/* Subordinate row */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium w-14 shrink-0" style={{ color: "var(--nav-fg-muted)" }}>
                {t("toolbar.rstSub")}
              </span>
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
              <span className={`px-1.5 py-0.5 rounded font-medium ${!rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"}`}>
                {t("toolbar.rstSegA")} {rstRolesSwapped ? t("toolbar.rstSatellite") : t("toolbar.rstNucleus")}
              </span>
              <span>→</span>
              <span className={`px-1.5 py-0.5 rounded font-medium ${rstRolesSwapped ? "bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300" : "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"}`}>
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
            className="border-b border-[var(--border)] px-4 py-2 flex flex-col gap-2 shrink-0"
            style={{ backgroundColor: "var(--nav-bg)", flexDirection: "column" }}
          >
            {/* Coordinate row */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium w-14 shrink-0" style={{ color: "var(--nav-fg-muted)" }}>
                {t("toolbar.rstCoord")}
              </span>
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
            </div>
            {/* Subordinate row */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium w-14 shrink-0" style={{ color: "var(--nav-fg-muted)" }}>
                {t("toolbar.rstSub")}
              </span>
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

        </div>}{/* end sticky control area */}

        {/* Chapter text */}
        <div
          className={`py-6 flex-1 ${hasActiveTranslations ? "" : "max-w-3xl mx-auto w-full"}`}
          onClick={editingRst && (rstSegA || rstSegAGroupId) ? () => { setRstSegA(null); setRstSegAGroupId(null); setRstSegB(null); setShowRstPicker(false); } : undefined}
          style={{
            paddingLeft:  "1.5rem",
            paddingRight: "1.5rem",
            "--hebrew-font-size": `${hebrewFontSize * (presentationMode ? 2 : 1)}rem`,
            "--greek-font-size": `${greekFontSize * (presentationMode ? 2 : 1)}rem`,
            "--translation-font-size": `${translationFontSize * (presentationMode ? 3 : 1)}rem`,
            "--source-row-height": `${(isHebrew ? hebrewFontSize : greekFontSize) * (presentationMode ? 1.0 : 2.0) * lineHeightMultiplier}rem`,
            "--translation-line-height": presentationMode ? `calc(${1.5 * lineHeightMultiplier} * var(--translation-font-size))` : `calc(${2.0 * lineHeightMultiplier} * var(--${isHebrew ? "hebrew" : "greek"}-font-size))`,
            "--translation-half-leading": "calc((var(--translation-line-height) - var(--translation-font-size)) / 2)",
            "--source-lh": String(isHebrew ? 2.5 * lineHeightMultiplier : 2.25 * lineHeightMultiplier),
            "--source-half-leading": isHebrew
              ? `calc(${(2.5 * lineHeightMultiplier - 1) / 2} * var(--hebrew-font-size, 1.375rem))`
              : `calc(${(2.25 * lineHeightMultiplier - 1) / 2} * var(--greek-font-size, 1.25rem))`,
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
                translationTexts={editingTranslationVerseMap.get(verseNum) ?? []}
                hasActiveTranslations={hasActiveTranslations}
                translationVerseOffset={translationVerseOffset}
                translationVerseLabelFn={translationVerseLabelFn}
                useLinguisticTerms={useLinguisticTerms}
                paragraphBreakIds={paragraphBreakIds}
                editingParagraphs={editingParagraphs}
                showAtnachBreaks={showAtnachBreaks}
                showVowels={showVowels}
                showCantillation={showCantillation}
                characterRefMap={characterRefMap}
                characterMap={characterMap}
                wordSpeechMap={wordSpeechMap}
                prevVerseLastWordId={prevWords[prevWords.length - 1]?.wordId ?? null}
                nextVerseFirstWordId={nextWords[0]?.wordId ?? null}
                editingRefs={editingRefs}
                editingSpeech={editingSpeech}
                activeCharId={activeCharId}
                speechRangeStartWordId={speechRangeStart?.wordId ?? null}
                tagRangeStartWordId={refRangeStart ?? wordTagRangeStart}
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
                findHits={findHitSet}
                findFocusId={findFocusId}
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
                transliterationFormatMap={transliterationFormatMap}
                onSaveConstituentLabel={handleSaveConstituentLabel}
                onSaveDatasetEntry={handleSaveDatasetEntry}
                onSaveTransliterationFormat={handleSaveTransliterationFormat}
                onLemmaClick={displayMode === "interlinear" && interlinearSubMode === "lemma" ? handleLemmaClick : undefined}
                hideSourceText={hideSourceText}
                editingTranslation={editingTranslation}
                editingTranslationSource={editingTranslationSource}
                onUpdateTranslationVerse={handleUpdateTranslationVerse}
                onCancelTranslationVerse={handleCancelTranslationVerse}
                editingArrows={editingArrows}
                onSelectArrowWordById={handleSelectArrowWordById}
                sceneBreakMap={sceneBreakMap}
                editingScenes={editingScenes}
                onToggleSceneBreak={handleToggleSceneBreak}
                onChangeSceneHeading={applySceneHeadingLocally}
                onUpdateSceneHeading={handleUpdateSceneHeading}
                onUpdateSceneOutOfSequence={handleUpdateSceneOutOfSequence}
                onUpdateSceneExtendedThrough={handleUpdateSceneExtendedThrough}
                onUpdateSceneThematic={handleUpdateSceneThematic}
                onUpdateSceneTransitional={handleUpdateSceneTransitional}
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
                tcMarkMap={tcMarkMap}
                editingTc={editingTc}
                onTcMarkWord={handleTcMarkLxxWord}
                onVerseClick={(v) => {
                  setNotesOpen(true);
                  setNotesScrollVerse(v);
                }}
                rstSourcePad={rstSourcePad}
                presentationMode={presentationMode}
                translationFootnotes={
                  showFootnotes
                    ? Object.entries(localFootnotes).flatMap(([tid, fns]) =>
                        fns.filter((fn) => fn.verse === verseNum && activeTranslationIds.has(Number(tid)))
                      )
                    : []
                }
                onDeleteFootnote={(translationId, fnId) => handleDeleteFootnote(translationId, fnId)}
                onEditFootnote={(fn) => openEditFootnote(fn)}
                editingFootnotes={editingFootnotes}
                anchorMoveFootnote={(() => {
                  if (fnAnchorMoveId === null) return undefined;
                  const fn = Object.values(localFootnotes).flat().find((f) => f.id === fnAnchorMoveId);
                  if (!fn || fn.verse !== verseNum) return undefined;
                  const tr = allAvailableTranslations.find((t) => t.id === fn.translationId);
                  if (!tr) return undefined;
                  return { id: fn.id, translationId: fn.translationId, verse: fn.verse, abbr: tr.abbreviation };
                })()}
                onMoveFootnoteAnchor={(fnId, wordIndex) => handleMoveFootnoteAnchor(fnId, wordIndex)}
              />
            );
          })}
        </div>
      </div>
      </div> {/* end outerRef wrapper */}

      {/* Chapter USFM source modal */}
      {chapterUsfmOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-stone-950/80 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setChapterUsfmOpen(false); }}>
          <div className="flex flex-col flex-1 m-4 rounded-lg overflow-hidden shadow-2xl border border-stone-700 bg-stone-950">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-700 shrink-0">
              <span className="font-mono text-sm font-semibold text-amber-400">‹› USFM Source</span>
              <span className="text-stone-400 text-xs">
                {allAvailableTranslations.find(t => activeTranslationAbbrs.has(t.abbreviation))?.abbreviation} · {book} {chapter}
              </span>
              <span className="flex-1" />
              {chapterUsfmError && (
                <span className="text-red-400 text-xs">{chapterUsfmError}</span>
              )}
              <button
                onClick={saveChapterUsfm}
                disabled={chapterUsfmLoading || chapterUsfmSaving}
                className="px-3 py-1.5 rounded text-xs font-medium bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50 transition-colors"
              >
                {chapterUsfmSaving ? "Saving…" : "Save & Reload"}
              </button>
              <button
                onClick={() => setChapterUsfmOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-medium bg-stone-700 hover:bg-stone-600 text-stone-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            {/* Textarea */}
            {chapterUsfmLoading ? (
              <div className="flex-1 flex items-center justify-center text-stone-400 text-sm">Loading…</div>
            ) : (
              <textarea
                value={chapterUsfmText}
                onChange={(e) => setChapterUsfmText(e.target.value)}
                className="flex-1 w-full resize-none bg-stone-950 text-amber-100 font-mono text-[13px] leading-relaxed p-4 focus:outline-none"
                spellCheck={false}
              />
            )}
          </div>
        </div>
      )}

      {/* Footnote create / edit dialog */}
      {fnDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => { setFnDialogOpen(false); setFnEditId(null); }}>
          <div
            className="rounded-lg shadow-xl border p-5 w-full max-w-md"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>
              {fnEditId !== null ? "Edit Footnote" : "Add Footnote / Cross-Reference"}
            </h3>
            <div className="flex gap-3 mb-3">
              {/* Translation picker */}
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Translation</label>
                <select
                  value={fnDialogAbbr}
                  onChange={(e) => setFnDialogAbbr(e.target.value)}
                  className="w-full text-xs rounded border px-2 py-1"
                  style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
                >
                  {[...activeTranslationIds].map((id) => {
                    const tr = allAvailableTranslations.find((t) => t.id === id);
                    return tr ? <option key={id} value={tr.abbreviation}>{tr.abbreviation}</option> : null;
                  })}
                </select>
              </div>
              {/* Verse picker */}
              <div className="w-20">
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Verse</label>
                <input
                  type="number"
                  min={1}
                  max={bookMaxVerses.get(chapter) ?? 999}
                  value={fnDialogVerse}
                  onChange={(e) => setFnDialogVerse(parseInt(e.target.value) || 1)}
                  className="w-full text-xs rounded border px-2 py-1"
                  style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
                />
              </div>
              {/* Type toggle */}
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Type</label>
                <div className="flex gap-1">
                  {(["f", "x"] as const).map((typ) => (
                    <button
                      key={typ}
                      type="button"
                      onClick={() => setFnDialogType(typ)}
                      className={[
                        "px-2 py-1 text-xs rounded border",
                        fnDialogType === typ
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-[var(--border-muted)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]",
                      ].join(" ")}
                    >
                      {typ === "f" ? "fn" : "xref"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <textarea
              value={fnDialogContent}
              onChange={(e) => setFnDialogContent(e.target.value)}
              placeholder="Footnote content (USFM inline markers allowed)"
              rows={4}
              className="w-full text-xs rounded border px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-sky-500"
              style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
            />
            <div className="flex justify-between gap-2 mt-3">
              <div>
                {fnEditId !== null && (() => {
                  const thisFn = Object.values(localFootnotes).flat().find((fn) => fn.id === fnEditId);
                  return thisFn ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFnDialogOpen(false);
                        setFnAnchorMoveId(fnEditId);
                        setFnEditId(null);
                      }}
                      className="px-3 py-1.5 text-xs rounded border border-sky-500 text-sky-500 hover:bg-sky-500/10 transition-colors"
                    >
                      ⊕ Reposition anchor
                    </button>
                  ) : null;
                })()}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setFnDialogOpen(false); setFnEditId(null); setFnDialogContent(""); }}
                  className="px-3 py-1.5 text-xs rounded border"
                  style={{ borderColor: "var(--border-muted)", color: "var(--text-muted)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={fnEditId !== null ? handleUpdateFootnote : handleCreateFootnote}
                  disabled={!fnDialogContent.trim()}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white disabled:opacity-50"
                >
                  {fnEditId !== null ? "Save" : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes pane */}
      {notesOpen && (
        <ResizablePane storageKey="pane-notes-width" defaultWidth={320} minWidth={200} maxWidth={700}>
          <NotesPane
            book={book}
            chapter={chapter}
            verses={verseNums}
            scrollToVerse={notesScrollVerse}
            onScrollHandled={() => setNotesScrollVerse(null)}
            onClose={() => setNotesOpen(false)}
            synced={notesSynced}
            onSyncToggle={toggleNotesSync}
          />
        </ResizablePane>
      )}

      {/* Search pane */}
      {searchOpen && (
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

      {/* Bible lookup pane */}
      {bibleOpen && (
        <ResizablePane storageKey="pane-bible-width" defaultWidth={320} minWidth={240} maxWidth={600}>
          <BibleLookupPane onClose={() => setBibleOpen(false)} />
        </ResizablePane>
      )}

      {/* Intertextual links pane */}
      {intertextualOpen && (
        <ResizablePane storageKey="pane-intertextual-width" defaultWidth={340} minWidth={260} maxWidth={700}>
          <IntertextualPanel
            book={book}
            chapter={chapter}
            textSource={textSource}
            onClose={() => setIntertextualOpen(false)}
          />
        </ResizablePane>
      )}

      {/* Outline pane */}
      {outlineOpen && (
        <ResizablePane storageKey="pane-outline-width" defaultWidth={320} minWidth={220} maxWidth={600}>
          <OutlinePane
            book={book}
            chapter={chapter}
            textSource={textSource}
            sceneBreakMap={sceneBreakMap}
            bookSceneBreaks={bookSceneBreaks}
            wordPositionMap={wordPositionMap}
            sectionRanges={outlineExtended ? extendedSectionRanges : sectionRanges}
            onUpdateCurrentHeading={handleUpdateSceneHeading}
            onDeleteCurrentBreak={handleDeleteCurrentBreak}
            onClose={() => setOutlineOpen(false)}
            outlineExtended={outlineExtended}
            onToggleExtended={setOutlineExtended}
            continuationBook={continuationBook}
            continuationBookName={continuationBookName}
            continuationBreaks={contBreaks}
            crossBookRangeKeys={crossBookRangeKeys}
            loadingContinuation={loadingCont}
            predecessorBook={predecessorBook}
            predecessorBookName={predecessorBookName}
            predecessorBreaks={predBreaks}
            outlinePredecessorShown={outlinePredecessorShown}
            onTogglePredecessorShown={setOutlinePredecessorShown}
            loadingPredecessor={loadingPred}
          />
        </ResizablePane>
      )}

      {/* Find-in-page bar */}
      {findOpen && (
        <FindBar
          query={findQuery}
          onChange={(q) => setFindQuery(q)}
          hitCount={findAllHitIds.length}
          focusIdx={findFocusIdx}
          onPrev={() => setFindFocusIdx((i) => (i - 1 + Math.max(findAllHitIds.length, 1)) % Math.max(findAllHitIds.length, 1))}
          onNext={() => setFindFocusIdx((i) => (i + 1) % Math.max(findAllHitIds.length, 1))}
          onClose={() => { setFindOpen(false); setFindQuery(""); }}
          inputRef={findInputRef}
          canTag={editingRefs || editingWordTags}
          onTag={() => tagFocusedFindWordRef.current()}
        />
      )}

      {/* Morphology panel — flex sibling so it pushes content left instead of overlaying */}
      {panelOpen && (
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

      {/* Version history panel */}
      {historyOpen && (
        <ResizablePane storageKey="pane-history-width" defaultWidth={360} minWidth={260} maxWidth={700}>
          <div className="flex flex-col h-full border-l" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Version History — {historyAbbr} {chapter}:{historyVerse}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={bookMaxVerses.get(chapter) ?? 999}
                  value={historyVerse}
                  onChange={(e) => openHistory(historyAbbr, parseInt(e.target.value) || 1)}
                  className="w-14 text-xs rounded border px-1.5 py-0.5"
                  style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
                  title="Verse number"
                />
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {historyVersions.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>
                  No saved versions yet. Versions are recorded automatically each time you edit a verse.
                </p>
              ) : (
                historyVersions.map((v) => (
                  <div key={v.id} className="rounded border p-2.5 text-xs space-y-1.5"
                    style={{ borderColor: "var(--border-muted)", backgroundColor: "var(--surface-muted)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                      <button
                        onClick={() => handleRestoreVersion(v.text)}
                        className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-medium hover:bg-emerald-700"
                      >
                        Restore
                      </button>
                    </div>
                    {v.label && (
                      <p className="font-semibold" style={{ color: "var(--foreground)" }}>{v.label}</p>
                    )}
                    <p className="leading-snug line-clamp-3" style={{ color: "var(--foreground)" }}>
                      {v.text}
                    </p>
                  </div>
                ))
              )}
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
