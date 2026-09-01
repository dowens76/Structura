"use client";

import { Fragment, useMemo, useState, useEffect, useRef, useCallback, useTransition } from "react";
import { getMtToKjvInstructions, getKjvVerseLabel } from "@/lib/versification/mt-kjv-mapping";
import { useRouter, useSearchParams } from "next/navigation";
import type { Word, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, RstRelation, WordArrow, LineAnnotation, PoetryNotation, PoetryLineBracketExclusion, Passage, SynopticWordMark, LineGroup } from "@/lib/db/schema";
import { usePoetryNotations } from "@/lib/hooks/usePoetryNotations";
import { POETRY_PRINCIPLE_LABELS, POETRY_PRINCIPLE_GLYPHS, POETRY_COLORS, type PoetryPrinciple } from "@/lib/poetry/constants";
import { derivePoetryDisplayMaps } from "@/lib/poetry/derivePoetryDisplayMaps";
import { computePoetryAnchorLayout, computePoetrySpacingMap, POETRY_STACK_STEP_PX, POETRY_STACK_BASE_PX } from "@/lib/poetry/computePoetryAnchorLayout";
import { useSynopticCategories } from "@/lib/hooks/useSynopticCategories";
import SynopticCategoryManager from "@/components/synoptic/SynopticCategoryManager";
import type { Translation, TranslationVerse, TranslationFootnote } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry, InterlinearSubMode } from "@/lib/morphology/types";
import { TEXT_COLOR_EXCLUDED_PUNCTUATION } from "@/lib/utils/translationTokens";
import VerseDisplay from "./VerseDisplay";
import FindBar from "./FindBar";
import MorphologyPanel from "./MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import InterlinearSubModePicker from "@/components/controls/InterlinearSubModePicker";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel, { TAG_PALETTE } from "@/components/controls/WordTagPanel";
import ChapterOverlays from "./ChapterOverlays";
import ClearAnnotationsDialog, { type ClearCategory } from "@/components/controls/ClearAnnotationsDialog";
import TranslationPicker from "@/components/controls/TranslationPicker";
import PassageNotesPane from "@/components/notes/PassageNotesPane";
import SearchPane from "@/components/search/SearchPane";
import OutlinePane from "@/components/text/OutlinePane";
import BibleLookupPane from "@/components/bible/BibleLookupPane";
import PassagePreviewPane from "@/components/text/PassagePreviewPane";
import IntertextualPanel from "@/components/text/IntertextualPanel";
import ResizablePane from "@/components/ResizablePane";
import RstTypeManager from "@/components/controls/RstTypeManager";
import LineGroupColorPanel from "@/components/controls/LineGroupColorPanel";
import ToolbarCustomizer, { DEFAULT_TOOLBAR_VIS, type ToolbarVisibility } from "@/components/controls/ToolbarCustomizer";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";
import type { RstCustomType } from "@/lib/db/schema";
import { useWordArrows } from "@/lib/hooks/useWordArrows";
import { useAnnotationRange } from "@/lib/hooks/useAnnotationRange";
import { useRstRelations } from "@/lib/hooks/useRstRelations";
import { useLineGroups } from "@/lib/hooks/useLineGroups";
import { buildLineGroupTree, getMaxNestingLevel } from "@/lib/lineGroups/buildLineGroupTree";
import { MAX_CONFIGURABLE_LEVELS } from "@/lib/lineGroups/colors";
import { computeLineSpacing } from "@/lib/lineGroups/computeLineSpacing";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import { computeSectionRanges, formatVerseRange } from "@/lib/utils/sectionRanges";
import { chapterFallsInPassage } from "@/lib/utils/passageRange";
import { chapterKey } from "@/lib/utils/chapterKey";
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
  /** Numeric book id of `book`. Used together with `endBookId` to disambiguate
   *  cross-book chapter-number collisions when `words` spans more than one
   *  chapter (e.g. both "1 Samuel 1" and "2 Samuel 1" have chapter === 1). */
  startBookId: number;
  /** OSIS code of the book `words` extends into, when rendering a cross-book
   *  passage. Undefined for the ordinary single-chapter/single-book case. */
  endBook?: string;
  /** Numeric book id of `endBook`, when this is a cross-book passage. */
  endBookId?: number;
  /** Total chapter count of `book`. Used to offset end-book chapter numbers
   *  onto one monotonic sequence for computeSectionRanges' internal chapter
   *  arithmetic (see lib/utils/chapterKey.ts) when endBookId is set, and as
   *  the passage range header's "can extend end" bound when `passage` is set. */
  startBookChapterCount?: number;
  /** Present only when rendering a saved passage (multi-chapter, possibly
   *  cross-book) rather than a plain single chapter — gates the passage-only
   *  range header (extend/shrink, delete, new-passage prompt, cross-book
   *  label), rendered in place of `headingSlot`. */
  passage?: Passage;
  /** Max verse of passage.startChapter (for shrink-start cross-chapter). */
  maxVerseOfStartChapter?: number;
  /** Max verse of passage.endChapter (for extend-end cross-chapter). */
  maxVerseOfEndChapter?: number;
  /** Max verse of (startChapter − 1), 0 if startChapter === 1. */
  maxVerseOfPrevStartChapter?: number;
  /** Max verse of (endChapter − 1), 0 if endChapter === 1. */
  maxVerseOfPrevEndChapter?: number;
  availableTranslations: Translation[];
  translationVerseData: Record<number, TranslationVerse[]>;
  initialParagraphBreakIds: string[];
  initialCharacters: Character[];
  initialCharacterRefs: CharacterRef[];
  initialSpeechSections: SpeechSection[];
  initialWordTags: WordTag[];
  initialWordTagRefs: WordTagRef[];
  initialLineIndents: { wordId: string; indentLevel: number }[];
  initialSyllableStressOverrides: { wordId: string; stresses: number; syllables: number }[];
  initialRstRelations: RstRelation[];
  initialTvRstRelations?: RstRelation[];
  initialLineGroups: LineGroup[];
  initialWordArrows: WordArrow[];
  initialWordFormatting: {
    wordId: string; isBold: boolean; isItalic: boolean; isUnderline: boolean; textColor: string | null;
    letterColors: Record<number, string> | null; letterBold: number[] | null; letterItalic: number[] | null; letterUnderline: number[] | null;
  }[];
  initialSceneBreaks: { wordId: string; heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean }[];
  initialLineAnnotations: LineAnnotation[];
  initialPoetryNotations: PoetryNotation[];
  initialPoetryLineBracketExclusions: PoetryLineBracketExclusion[];
  // `bookId` disambiguates which book each break belongs to — required for
  // cross-book passages where two books can share raw chapter numbers.
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null; transitional: boolean; bookId: number }[];
  bookMaxVerses: Map<number, number>;
  /** Base verse text from data/ult.db (empty if not imported). `chapter` is
   *  omitted by the plain chapter page (falls back to the `chapter` prop) and
   *  set per-entry by the passage page, since a passage can span chapters. */
  ultBaseVerses?: { chapter?: number; verse: number; text: string }[];
  /** The Translation record for ULT in user.db (null if not imported). */
  ultTranslation?: Translation | null;
  /** Base verse text from data/vcb.db (empty if not imported). */
  vcbBaseVerses?: { chapter?: number; verse: number; text: string }[];
  /** The Translation record for VCB in user.db (null if not imported). */
  vcbTranslation?: Translation | null;
  /** Reconstructed verse texts from lxx.db for showing LXX in the translation column. */
  lxxBaseVerses?: { chapter?: number; verse: number; text: string }[];
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
  /** Verse to scroll to on initial load (driven by the ?v= URL param). */
  initialVerse?: number;
  /** When false, this instance's global keydown shortcut handler (undo/redo,
   *  arrow-key verse nav, book/chapter nav, etc.) is a no-op. Defaults to true
   *  (single-instance behavior, unchanged). SynopticView sets this to false on
   *  every column except the one the user last focused/clicked, so multiple
   *  ChapterDisplay instances mounted side by side don't all react to the same
   *  keypress at once. */
  active?: boolean;
  /** When true, the F8/Ctrl+F8 (chapter), F9/Ctrl+F9 (book), and Ctrl+Arrow
   *  (verse) keyboard shortcuts become no-ops instead of calling
   *  router.push/replace. Defaults to false (single-instance behavior,
   *  unchanged) — every other shortcut (undo/redo, find, etc.) is unaffected.
   *  SynopticView sets this to true on every column: those shortcuts navigate
   *  the whole browser tab to a plain chapter URL, which would silently
   *  abandon the multi-column comparison the user is looking at. A synoptic
   *  column's scope is a fixed pericope anyway, not a book to page through. */
  navigationDisabled?: boolean;
  /** localStorage key the toolbar-visibility customization is persisted under.
   *  Defaults to the app-wide "structura:toolbarVisibility" key. SynopticView
   *  passes a distinct key so a user's Synoptic View toolbar customization
   *  doesn't overwrite (or get overwritten by) their normal chapter/passage
   *  view customization — the two contexts want different defaults (see
   *  `defaultToolbarVisibility`) and shouldn't fight over one shared key. */
  toolbarVisibilityStorageKey?: string;
  /** Toolbar-visibility state used before any customization has been saved
   *  under `toolbarVisibilityStorageKey`, and used by the customizer panel's
   *  "Reset" button. Defaults to DEFAULT_TOOLBAR_VIS (everything on). */
  defaultToolbarVisibility?: ToolbarVisibility;
  /** Hands the actual scrolling DOM element up to the parent on mount (and
   *  `null` on unmount) — SynopticView uses this to proportionally sync
   *  scroll position across every column so scrolling one pane scrolls the
   *  others. No-op for every other call site. */
  onScrollContainerRef?: (el: HTMLDivElement | null) => void;
  /** When true, the Notes, Search, Bible Lookup, Intertextual Links, and Word
   *  Analysis side panels are fully disabled — their toolbar buttons don't
   *  render (regardless of toolbarVis) and the panels themselves never
   *  render even if their open-state is somehow already true. Used by
   *  SynopticView, where a side panel opening inside one narrow column
   *  wouldn't make sense. Defaults to false (single-instance behavior,
   *  unchanged). */
  disableSidePanels?: boolean;
  /** When true, narrows the verse-number label gutter from 5rem to ~3ch (a
   *  2-3 digit verse number plus a 1-2 character gap) — used by SynopticView,
   *  where every pixel of a narrow column matters. Defaults to false
   *  (unchanged in the regular chapter/passage view). */
  compactVerseLabels?: boolean;
}

const DEFAULT_FILTER: GrammarFilterState = {
  noun: true, verb: true, adjective: true, adverb: true,
  preposition: true, conjunction: true, pronoun: true,
  particle: true, article: true, interjection: true,
};

// OutlinePane receives sceneBreakMap for live in-chapter edits, but once `words`
// spans multiple chapters every break is already included in outlineBreaksForPane
// (derived from sceneBreakMap with real per-word chapters). Passing sceneBreakMap
// too would tag every live break with the constant `chapter` prop, corrupting
// entries for any other covered chapter — so it's swapped for this empty map
// (and `chapter` for -1) whenever isMultiChapter is true.
const EMPTY_SCENE_BREAK_MAP: Map<string, never[]> = new Map();

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
  startBookId,
  endBook,
  endBookId,
  startBookChapterCount,
  passage,
  maxVerseOfStartChapter,
  maxVerseOfEndChapter,
  maxVerseOfPrevStartChapter,
  maxVerseOfPrevEndChapter,
  availableTranslations,
  translationVerseData,
  initialParagraphBreakIds,
  initialCharacters,
  initialCharacterRefs,
  initialSpeechSections,
  initialWordTags,
  initialWordTagRefs,
  initialLineIndents,
  initialSyllableStressOverrides,
  initialRstRelations,
  initialTvRstRelations = [],
  initialLineGroups,
  initialWordArrows,
  initialWordFormatting,
  initialSceneBreaks,
  initialLineAnnotations,
  initialPoetryNotations,
  initialPoetryLineBracketExclusions,
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
  initialVerse,
  active = true,
  navigationDisabled = false,
  toolbarVisibilityStorageKey = "structura:toolbarVisibility",
  defaultToolbarVisibility = DEFAULT_TOOLBAR_VIS,
  onScrollContainerRef,
  disableSidePanels = false,
  compactVerseLabels = false,
}: ChapterDisplayProps) {
  const { t, locale, refBookName } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // ── Passage mode (multi-chapter / cross-book) ─────────────────────────────
  const isPassageMode = !!passage;
  const [passageState, setPassageState] = useState(passage);
  useEffect(() => { setPassageState(passage); }, [passage?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showNewPassagePrompt, setShowNewPassagePrompt] = useState(() => searchParams.get("newPassage") === "true");
  const [newPassageLevel, setNewPassageLevel] = useState(1);
  const [newPassageHeading, setNewPassageHeading] = useState("");

  // Translation footnotes keyed by translationId → verse → footnotes[]
  const [localFootnotes, setLocalFootnotes] = useState<Record<number, TranslationFootnote[]>>(
    initialTranslationFootnotes
  );

  // Footnote dialog state (shared between create and edit)
  const [fnDialogOpen, setFnDialogOpen] = useState(false);
  // Book/chapter the dialog's verse number belongs to — a passage view can span
  // multiple chapters (even multiple books) that share the same verse number, so
  // `fnDialogVerse` alone isn't enough to identify the right verse. Defaults to
  // this component's own book/chapter (the common single-chapter case).
  const [fnDialogBook, setFnDialogBook] = useState(book);
  const [fnDialogChapter, setFnDialogChapter] = useState(chapter);
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
  // Manual word groupings within constituent labeling: wordId -> shared groupId.
  const [constituentGroupMap, setConstituentGroupMap] = useState<Map<string, string>>(new Map());
  const [datasets, setDatasets] = useState<{ id: number; name: string; direction: "ltr" | "rtl" }[]>([]);
  const [datasetEntryMap, setDatasetEntryMap] = useState<Map<string, string>>(new Map());
  // Manual word groupings within a dataset: wordId -> shared groupId.
  const [datasetGroupMap, setDatasetGroupMap] = useState<Map<string, string>>(new Map());
  // User color overrides for a dataset's label values: value -> hex color.
  const [datasetLabelColors, setDatasetLabelColors] = useState<Map<string, string>>(new Map());
  // Grouping UI state shared between the dataset feature and the constituent
  // feature — only one of the two grouping-capable modes can be active at a
  // time (interlinearSubMode is a single value), so reusing this state avoids
  // duplicating the whole New/Edit/Save-grouping flow per feature.
  const [datasetGroupingMode, setDatasetGroupingMode] = useState<"off" | "new" | "edit">("off");
  const [pendingGroupWordIds, setPendingGroupWordIds] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraftValue, setGroupDraftValue] = useState("");
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
  // Keyed by "bookId:chapter:verse" (data-passage-verse-key on each verse's
  // wrapper div) — bookId disambiguates chapter/verse numbers that collide
  // across a cross-book passage boundary, e.g. both books having a "1:1".
  const visibleVersesRef = useRef(new Set<string>());
  const notesSyncedRef   = useRef(notesSynced);
  const syncTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<{ osisRef: string; lexiconSource: string; nonce: number } | null>(null);
  const [intertextualOpen, setIntertextualOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const [searchRequest, setSearchRequest] = useState<{ query: string; source: string; nonce: number } | null>(null);
  const [notesScrollVerse, setNotesScrollVerse] = useState<{ ch: number; v: number } | null>(null);

  // ── Text Critical Markup ─────────────────────────────────────────────────────
  const [tcMarkMap, setTcMarkMap] = useState<Map<string, string>>(
    () => new Map(initialTextCriticalMarks.map(m => [m.wordId, m.markType]))
  );
  const [editingTc, setEditingTc] = useState(false);
  const [activeTcMark, setActiveTcMark] = useState<"lxx_unique" | "mt_unique" | "same_different">("lxx_unique");

  // RST source-pad: dynamically sized so group chips never overlap verse labels
  const [rstSourcePad, setRstSourcePad] = useState(0);
  // Line-group bracket source-pad: same idea, combined with rstSourcePad below.
  const [lineGroupSourcePad, setLineGroupSourcePad] = useState(0);

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
  const [showSyllableStress, setShowSyllableStress] = useState(false);
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
  // Derived from wordTags' own persisted `highlighted` flag — not separate
  // state — so toggling it here or in the Word/Concept Editor stays in sync
  // and survives navigating to a different chapter.
  const highlightWordTagIds = useMemo(
    () => new Set(wordTags.filter((t) => t.highlighted).map((t) => t.id)),
    [wordTags]
  );
  // When true, the next source-word click creates a "word"-type tag using its lemma
  // When set, the next source-word click adds its canonical lemma to a cluster being built
  const [clusterLemmaCallback, setClusterLemmaCallback] = useState<((lemma: string, displayLabel?: string) => void) | null>(null);

  const wordTagMap = useMemo(
    () => new Map(wordTags.map((t) => [t.id, t])),
    [wordTags]
  );

  // ── Synoptic word-level comparison marking ──────────────────────────────────
  // Unlike line annotations (paragraph-segment granularity), this marks an
  // arbitrary contiguous word range — start/end can fall mid-sentence — and
  // renders as an inline background tint directly on the words (see
  // WordToken's synopticMarkColor prop), not a margin badge.
  const { categories: synopticCategories } = useSynopticCategories();
  const [editingWordCompare, setEditingWordCompare] = useState(false);
  const [wordCompareCategoryKey, setWordCompareCategoryKey] = useState<string | null>(null);
  const [wordCompareRangeStart, setWordCompareRangeStart] = useState<string | null>(null);
  const [synopticWordMarks, setSynopticWordMarks] = useState<SynopticWordMark[]>([]);
  const [showSynopticCategoryManager, setShowSynopticCategoryManager] = useState(false);

  // Default the active category once the (async-fetched) list loads.
  useEffect(() => {
    if (!wordCompareCategoryKey && synopticCategories.length > 0) {
      setWordCompareCategoryKey(synopticCategories[0].key);
    }
  }, [wordCompareCategoryKey, synopticCategories]);

  // Client-fetched (not part of the server-rendered initial props) since this
  // is a new, self-contained feature — refetches whenever the chapter/source
  // being displayed changes.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/synoptic-word-marks?book=${encodeURIComponent(book)}&chapter=${chapter}&source=${textSource}`)
      .then((r) => (r.ok ? r.json() : { marks: [] }))
      .then((d: { marks?: SynopticWordMark[] }) => { if (!cancelled) setSynopticWordMarks(d.marks ?? []); })
      .catch(() => { if (!cancelled) setSynopticWordMarks([]); });
    return () => { cancelled = true; };
  }, [book, chapter, textSource]);

  /** Global (chapter-wide) word order index — used to order an arbitrary
   *  word-compare range regardless of which word was clicked first. */
  const wordIndexMap = useMemo(
    () => new Map(words.map((w, i) => [w.wordId, i])),
    [words]
  );

  async function handleToggleWordCompareMark(word: Word) {
    if (!wordCompareCategoryKey) return;

    // Clicking a word that's already covered by a mark (with no pending range
    // start) removes that mark — same "click to toggle" simplicity as scene
    // breaks/paragraph breaks.
    if (!wordCompareRangeStart) {
      const covering = synopticWordMarks.find((m) => {
        const lo = wordIndexMap.get(m.startWordId);
        const hi = wordIndexMap.get(m.endWordId);
        const pos = wordIndexMap.get(word.wordId);
        if (lo === undefined || hi === undefined || pos === undefined) return false;
        return pos >= Math.min(lo, hi) && pos <= Math.max(lo, hi);
      });
      if (covering) {
        setSynopticWordMarks((prev) => prev.filter((m) => m.id !== covering.id));
        fetch("/api/synoptic-word-marks", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: covering.id }),
        }).catch(() => {});
        return;
      }
      setWordCompareRangeStart(word.wordId);
      return;
    }

    // Second click — order the two endpoints by their position in the chapter.
    const startPos = wordIndexMap.get(wordCompareRangeStart) ?? 0;
    const endPos = wordIndexMap.get(word.wordId) ?? 0;
    const [startWordId, endWordId] = startPos <= endPos
      ? [wordCompareRangeStart, word.wordId]
      : [word.wordId, wordCompareRangeStart];
    const category = synopticCategories.find((c) => c.key === wordCompareCategoryKey);
    const color = category?.color ?? "#6b7280";
    setWordCompareRangeStart(null);

    const tempId = -Date.now();
    setSynopticWordMarks((prev) => [
      ...prev,
      { id: tempId, workspaceId: 1, categoryKey: wordCompareCategoryKey, color, startWordId, endWordId, textSource, book, chapter, createdAt: null },
    ]);
    try {
      const res = await fetch("/api/synoptic-word-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryKey: wordCompareCategoryKey, color, startWordId, endWordId, book, chapter, source: textSource }),
      });
      if (res.ok) {
        const { mark } = await res.json();
        setSynopticWordMarks((prev) => prev.map((m) => (m.id === tempId ? mark : m)));
      } else {
        setSynopticWordMarks((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch {
      setSynopticWordMarks((prev) => prev.filter((m) => m.id !== tempId));
    }
  }

  /** Per-word inline highlight color for the Synoptic word-compare marks,
   *  keyed by wordId — a range covers every word between its start/end
   *  (inclusive) by chapter-wide position, not just the two endpoints. */
  const synopticWordMarkColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const mark of synopticWordMarks) {
      const lo = wordIndexMap.get(mark.startWordId);
      const hi = wordIndexMap.get(mark.endWordId);
      if (lo === undefined || hi === undefined) continue;
      const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
      for (let i = from; i <= to; i++) {
        const w = words[i];
        if (w) map.set(w.wordId, mark.color);
      }
    }
    return map;
  }, [synopticWordMarks, wordIndexMap, words]);

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
    const newTag: WordTag = {
      id: tagId, workspaceId: 1, book: "*", name, color, type: "search",
      createdAt: new Date().toISOString(), sortOrder: null,
      corpusGroupingId: null, corpusType: "book", corpusChapter: null, corpusPassageId: null,
      lemmas: null, highlighted: false,
    };
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
            next.set(r.wordId, { id: -1, workspaceId: 1, versionId: 1, wordId: r.wordId, tagId, textSource: r.textSource, book: r.book, chapter: r.chapter });
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

  /** Called by MorphologyPanel/LexiconPane when the user clicks a scripture
   *  citation embedded in a lexicon entry (e.g. BDB's "Jb 8:12"). */
  const handleScriptureRefClick = useCallback((osisRef: string, lexiconSource: string) => {
    setPreviewOpen(true);
    setPreviewRequest({ osisRef, lexiconSource, nonce: Date.now() });
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

  // ── Syllable/stress override state ──────────────────────────────────────────
  // Reader-supplied corrections to the heuristic syllable/stress counter,
  // keyed by the first wordId of the poetic line they apply to. Absent from
  // the map → the line falls back to the computed heuristic count.
  const [syllableStressOverrideMap, setSyllableStressOverrideMap] = useState<Map<string, { stresses: number; syllables: number }>>(
    () => new Map(initialSyllableStressOverrides.map((o) => [o.wordId, { stresses: o.stresses, syllables: o.syllables }]))
  );
  const [editingSyllableStress, setEditingSyllableStress] = useState(false);

  // getChapterForWord resolves a wordId → chapter number, handling both regular
  // word IDs (via wordToChapter map, populated below once `words` is processed)
  // and tv: token IDs (parsed from the ID). The hooks below are called before
  // that useMemo exists in declaration order, so a ref keeps the callbacks
  // seeing the latest map without requiring a reorder of calls. Degenerates to
  // always returning `chapter` for the ordinary single-chapter case (map is
  // trivially {wordId → chapter} for every word).
  const wordToChapterRef = useRef<Map<string, number>>(new Map());
  function getChapterForWord(wordId: string): number {
    let ch = wordToChapterRef.current.get(wordId);
    if (ch === undefined && wordId.startsWith("tv:")) {
      const dotParts = wordId.split(":")[2]?.split(".");
      const parsed = dotParts ? parseInt(dotParts[1]) : NaN;
      ch = isNaN(parsed) ? chapter : parsed;
    }
    return ch ?? chapter;
  }

  // ── RST relations (hook) ──────────────────────────────────────────────────
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
    getChapterForWord,
    supportsLinkedTrees: true,
  });

  // Custom RST label types (local to ChapterDisplay — not part of hook)
  const [customRstTypes, setCustomRstTypes] = useState<RstCustomType[]>([]);
  const [showRstTypeManager, setShowRstTypeManager] = useState(false);

  // Line-group bracket color-by-level panel (local to ChapterDisplay — not part of the hook)
  const [showLineGroupColors, setShowLineGroupColors] = useState(false);
  // Poetry Notation's "bracket every poetic line" toggle — draws one level-1
  // bracket per line automatically (no LineGroup rows involved), reusing
  // LineGroupOverlay's own drawing code. Real user-created line groups nest
  // outside these (shifted to level 2+) whenever this is on.
  const [showPoetryLineBrackets, setShowPoetryLineBrackets] = useState(false);
  // Reveals a small note-indicator badge on any word/glyph anchoring a Poetry
  // Notation mark that has a note — works in read mode too, not just while
  // actively editing marks, since that's the point (casual reading, not
  // just authoring).
  const [showPoetryNotes, setShowPoetryNotes] = useState(false);
  // Which feature occupies the shared right-side margin column — clause labels
  // or poetry notation (Balance/Imbalance + Symmetry) — never both at once.
  // Explicit (not derived) so toggling one off doesn't also hide the other's
  // already-saved marks; entering either edit mode below sets this to match.
  const [panelDisplayMode, setPanelDisplayMode] = useState<"annotations" | "poetry">("annotations");

  // ── Word arrows (hook) ────────────────────────────────────────────────────
  const {
    wordArrowsState, setWordArrowsState,
    editingArrows, setEditingArrows,
    arrowFromWordId, setArrowFromWordId,
    handleSelectArrowWordById,
    handleDeleteWordArrow,
    handleUpdateWordArrow,
    createDirectArrow,
  } = useWordArrows({
    initialWordArrows,
    book,
    textSource,
    getChapterForWord,
  });

  // ── Word formatting (bold / italic / underline / color) state ─────────────
  const [wordFormattingMap, setWordFormattingMap] = useState<Map<string, {
    isBold: boolean; isItalic: boolean; isUnderline: boolean; textColor: string | null;
    letterColors: Record<number, string> | null; letterBold: number[] | null; letterItalic: number[] | null; letterUnderline: number[] | null;
  }>>(
    () => new Map(initialWordFormatting.map((f) => [f.wordId, {
      isBold: f.isBold, isItalic: f.isItalic, isUnderline: f.isUnderline, textColor: f.textColor,
      letterColors: f.letterColors, letterBold: f.letterBold, letterItalic: f.letterItalic, letterUnderline: f.letterUnderline,
    }]))
  );
  const [editingBold, setEditingBold]     = useState(false);
  const [editingItalic, setEditingItalic] = useState(false);
  const [editingUnderline, setEditingUnderline] = useState(false);
  const [editingTextColor, setEditingTextColor] = useState(false);
  // Whether any letter-level-capable formatting mode is active — a translation
  // word's letters become individually clickable whenever any of these is on.
  const editingLetterFormatting = editingBold || editingItalic || editingUnderline || editingTextColor;
  // Letter-level selection (shared by bold/italic/underline/color, whichever
  // mode(s) are currently active): while editingLetterFormatting, a translation
  // word's letters are always individually clickable. A plain click formats
  // the whole word (same as before); a shift-click anchors a letter, and a
  // second shift-click on the same word formats the whole span between them
  // (a "series") — decided per-click from the click event's own shiftKey,
  // not a separately-tracked held-key state (which can miss a keyup between
  // two quick clicks and silently drop the second click's commit). The
  // keyup listener below just clears a lingering pending anchor visually if
  // the user releases Shift without a second click.
  const [letterFormatAnchor, setLetterFormatAnchor] = useState<{ wordId: string; graphemeIndex: number; coreText: string } | null>(null);
  useEffect(() => {
    if (!editingLetterFormatting) {
      setLetterFormatAnchor(null);
      return;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Shift") setLetterFormatAnchor(null);
    }
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, [editingLetterFormatting]);
  // Starts at the SSR-safe default and syncs from localStorage post-mount
  // (rather than reading it in the useState initializer) — this value renders
  // directly into an inline style on first paint (the "A" toolbar button), so
  // reading localStorage during the client's hydration render would produce a
  // color that mismatches whatever the server rendered, triggering a
  // hydration-mismatch warning for any user with a previously-saved color.
  const [activeTextColor, setActiveTextColor] = useState("#DC2626");
  useEffect(() => {
    setActiveTextColor(readLocal("structura:activeTextColor", "#DC2626"));
  }, []);
  function updateActiveTextColor(color: string) {
    setActiveTextColor(color);
    writeLocal("structura:activeTextColor", color);
  }
  const [showClearDialog, setShowClearDialog] = useState(false);

  // ── Source text visibility ─────────────────────────────────────────────────
  // When true, source text columns are hidden so the user works with translation only.
  const [hideSourceText, setHideSourceText] = useState(false);

  // ── Presentation mode ─────────────────────────────────────────────────────
  const [presentationMode, setPresentationMode] = useState(initialPresentationMode);
  const [addressBarOpen, setAddressBarOpen] = useState(false);

  // ── Toolbar visibility (customizer) ───────────────────────────────────────
  const [toolbarVis, setToolbarVis] = useState<ToolbarVisibility>(defaultToolbarVisibility);
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

  // Raw chapter number → bookId, for tagging the synthetic ULT/VCB/LXX records
  // below with a real bookId (instead of a constant placeholder) so they key
  // consistently with activeTranslationVerseMap's (bookId, chapter, verse)
  // lookup. Ambiguous only in the rare case where a cross-book passage's two
  // books share a raw chapter number — same accepted-limitation class as
  // outlineBreaksForPane's cross-book filter.
  const chapterToBookId = useMemo(
    () => new Map(words.map((w) => [w.chapter, w.bookId])),
    [words]
  );

  // ── Translation text editing ───────────────────────────────────────────────
  // Local mutable copy of translationVerseData so edits can be reflected immediately.
  // If ULT/VCB base verses are provided, merge them in: user edits (from user.db) take
  // precedence; verses not yet edited fall back to the immutable base text from the source DB.
  const initialTranslationVerseData = useMemo(() => {
    let data = translationVerseData;

    if (ultTranslation && ultBaseVerses.length > 0) {
      const ultId = ultTranslation.id;
      const editedMap = new Map(
        (data[ultId] ?? []).map((v) => [`${v.chapter}:${v.verse}`, v])
      );
      const merged: TranslationVerse[] = ultBaseVerses.map((base, i) => {
        const ch = base.chapter ?? chapter;
        return editedMap.get(`${ch}:${base.verse}`) ?? {
          id: -(i + 1),                    // synthetic — not yet saved to user.db
          workspaceId: ultTranslation.workspaceId,
          translationId: ultId,
          osisRef: `${book}.${ch}.${base.verse}`,
          bookId: chapterToBookId.get(ch) ?? startBookId, chapter: ch,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [ultId]: merged };
    }

    if (vcbTranslation && vcbBaseVerses.length > 0) {
      const vcbId = vcbTranslation.id;
      const editedMap = new Map(
        (data[vcbId] ?? []).map((v) => [`${v.chapter}:${v.verse}`, v])
      );
      const merged: TranslationVerse[] = vcbBaseVerses.map((base, i) => {
        const ch = base.chapter ?? chapter;
        return editedMap.get(`${ch}:${base.verse}`) ?? {
          id: -(i + 1),                    // synthetic — not yet saved to user.db
          workspaceId: vcbTranslation.workspaceId,
          translationId: vcbId,
          osisRef: `${book}.${ch}.${base.verse}`,
          bookId: chapterToBookId.get(ch) ?? startBookId, chapter: ch,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [vcbId]: merged };
    }

    if (lxxTranslation && lxxBaseVerses.length > 0) {
      const lxxId = lxxTranslation.id;
      const editedMap = new Map(
        (data[lxxId] ?? []).map((v) => [`${v.chapter}:${v.verse}`, v])
      );
      const merged: TranslationVerse[] = lxxBaseVerses.map((base, i) => {
        const ch = base.chapter ?? chapter;
        return editedMap.get(`${ch}:${base.verse}`) ?? {
          id: -(i + 1),
          workspaceId: lxxTranslation.workspaceId,
          translationId: lxxId,
          osisRef: `${book}.${ch}.${base.verse}`,
          bookId: chapterToBookId.get(ch) ?? startBookId, chapter: ch,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [lxxId]: merged };
    }

    return data;
  // Recalculates on navigation (book/chapter/translation IDs) and whenever the
  // server hands down fresh translationVerseData (e.g. router.refresh() after
  // importing a translation) — not on every keystroke, since local edits live
  // in localTranslationVerseData below and don't touch this prop.
  }, [book, chapter, ultTranslation?.id, vcbTranslation?.id, lxxTranslation?.id, translationVerseData]);

  const [localTranslationVerseData, setLocalTranslationVerseData] = useState(initialTranslationVerseData);
  // Re-seed local state whenever the server-derived data changes — otherwise a
  // newly imported translation's verses never appear until the chapter is
  // unmounted and remounted (e.g. by navigating away and back), since useState's
  // initial value is only applied on mount.
  useEffect(() => {
    setLocalTranslationVerseData(initialTranslationVerseData);
  }, [initialTranslationVerseData]);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editingTranslationSource, setEditingTranslationSource] = useState(false);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
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

  // Hands the actual scrolling element (textContainerRef's node) up to the
  // parent once mounted — SynopticView uses this to proportionally sync
  // scroll position across columns. No-op for every other call site.
  useEffect(() => {
    onScrollContainerRef?.(textContainerRef.current);
    return () => onScrollContainerRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    editingAnnotationId, setEditingAnnotationId,
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
    getChapterForWord,
    paragraphFirstWordIds,
  });

  // ── Line groups (poetry bracket grouping) hook ────────────────────────────
  const {
    lineGroups, setLineGroups,
    editingLineGroups, setEditingLineGroups,
    lineGroupSegA, setLineGroupSegA,
    lineGroupSegAGroupId, setLineGroupSegAGroupId,
    getBracketColor, setBracketColorForLevel,
    handleSelectLineGroupSegment,
    handleSelectLineGroupGroup,
    handleDeleteLineGroup,
  } = useLineGroups({
    initialLineGroups,
    book,
    textSource,
    getChapterForWord,
    paragraphFirstWordIds,
  });

  // ── Poetry notation (Gestalt) hook ────────────────────────────────────────
  const {
    poetryNotations,
    editingPoetryNotation, setEditingPoetryNotation,
    activePrinciple, setActivePrinciple,
    activeBalanceSubtype, setActiveBalanceSubtype,
    activeImbalanceDirection, setActiveImbalanceDirection,
    activeClosureSubtype, setActiveClosureSubtype,
    activeRequirednessSubtype, setActiveRequirednessSubtype,
    editingNotationId, setEditingNotationId,
    symmetryLineA,
    balanceLineA,
    similarityStart,
    closureRangeStart,
    requirednessRangeStart,
    requirednessResolvingForId,
    requirednessResolvingStart,
    addingToSimilarityGroupId,
    clearPending: clearPoetryPending,
    handleWordClick: handlePoetryWordClick,
    handleRequirednessArrowClick,
    handleStartRequirednessResolving,
    handleLineClick: handlePoetryLineClick,
    handleSymmetryLineClick,
    handleGraphemeClick,
    handleClosureWordClick,
    handleClosureLineClick,
    handleRequirednessWordClick,
    handleStartAddWordToGroup,
    handleCancelAddWordToGroup,
    handleUpdateNote: handleUpdatePoetryNote,
    handleSaveSimilarityNote,
    handleUngroupMark,
    handleDeleteNotation: handleDeletePoetryNotation,
  } = usePoetryNotations({
    initialPoetryNotations,
    resolveWordSource,
    wordIndexMap,
  });

  // ── Poetry line bracket exclusions (superscriptions, etc.) ─────────────────
  // Lines the "bracket every poetic line" auto-bracket toggle should skip —
  // e.g. Psalm 29:1a ("A Psalm of David"), which isn't part of the poem's own
  // line structure. Always keyed by the line's SOURCE segFirstWordId, even
  // when toggled from a translation-mirrored bracket, since both represent
  // the same line.
  const [poetryLineBracketExclusions, setPoetryLineBracketExclusions] =
    useState<PoetryLineBracketExclusion[]>(initialPoetryLineBracketExclusions);
  const excludedLineIds = useMemo(
    () => new Set(poetryLineBracketExclusions.map((e) => e.wordId)),
    [poetryLineBracketExclusions]
  );
  async function handleToggleLineBracketExclusion(segFirstWordId: string) {
    const existing = poetryLineBracketExclusions.find((e) => e.wordId === segFirstWordId);
    const { textSource: source, book: exBook, chapter: exChapter } = resolveWordSource(segFirstWordId);
    if (existing) {
      setPoetryLineBracketExclusions((prev) => prev.filter((e) => e.wordId !== segFirstWordId));
      try {
        await fetch("/api/poetry-line-bracket-exclusions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: segFirstWordId, book: exBook, chapter: exChapter }),
        });
      } catch {
        setPoetryLineBracketExclusions((prev) => [...prev, existing]);
      }
      return;
    }
    const tempId = -Date.now();
    const optimistic: PoetryLineBracketExclusion = {
      id: tempId, workspaceId: 1, versionId: 0,
      wordId: segFirstWordId, textSource: source, book: exBook, chapter: exChapter, createdAt: null,
    };
    setPoetryLineBracketExclusions((prev) => [...prev, optimistic]);
    try {
      const resp = await fetch("/api/poetry-line-bracket-exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: segFirstWordId, book: exBook, chapter: exChapter, source }),
      });
      if (!resp.ok) throw new Error("save failed");
      const { exclusion } = await resp.json();
      setPoetryLineBracketExclusions((prev) => prev.map((e) => (e.id === tempId ? exclusion : e)));
    } catch {
      setPoetryLineBracketExclusions((prev) => prev.filter((e) => e.id !== tempId));
    }
  }

  /** Dispatches a word click to the right poetry-notation handler for the
   *  currently active principle, given an explicit wordId + the line
   *  ("source paragraph segment") it belongs to. `wordId` may be a source
   *  Word.wordId or a translation `tv:ABBR:...` token id — both are valid
   *  anchors for every principle except Similarity, which is handled
   *  separately via onGraphemeClick and bypasses word-level selection.
   *  `tvSegFirstWordId`, when supplied (translation clicks only), is the
   *  translation's OWN line's first word id — Closure (complete) uses it
   *  instead of segFirstWordId so a mark created on translation text is
   *  anchored to (and later displays on) that same text, rather than always
   *  falling back to the source line like Balance/Symmetry intentionally do.
   *  `shiftHeld` drives Closure (weak)'s range picking: click the first
   *  word, shift-click the last — a plain click re-anchors the pending
   *  start instead, same as Similarity's grapheme-range picking. */
  function handlePoetryWordSelectByIds(wordId: string, segFirstWordId: string, tvSegFirstWordId?: string, shiftHeld = false) {
    // Requiredness's resolved-range pick (started from the note popover's
    // button) takes priority over whatever principle/subtype happens to be
    // selected in the toolbar — the user entered this mode explicitly and
    // shouldn't need to also have "Requiredness" highlighted for it to work.
    if (requirednessResolvingForId !== null) {
      handleRequirednessArrowClick(wordId, shiftHeld);
      return;
    }
    switch (activePrinciple) {
      case "continuation":
        handlePoetryWordClick(wordId);
        return;
      case "requiredness":
        if (activeRequirednessSubtype === "underline") handleRequirednessWordClick(wordId, shiftHeld);
        else handleRequirednessArrowClick(wordId, shiftHeld);
        return;
      case "balance":
      case "symmetry":
        // Both are picked entirely via the anchor-point dots in the margin
        // now (PoetryMarginOverlay) — a plain word click does nothing, same
        // as Similarity below.
        return;
      case "closure":
        if (activeClosureSubtype === "weak") handleClosureWordClick(wordId, shiftHeld);
        else handleClosureLineClick(tvSegFirstWordId ?? segFirstWordId);
        return;
      case "similarity":
        // Handled via onGraphemeClick — a plain word click does nothing.
        return;
    }
  }

  // Every read-side lookup map/set the poetry marks need for rendering —
  // shared with ExportTextView's read-only rendering via derivePoetryDisplayMaps
  // so the two views can't drift out of sync on this fairly intricate derivation.
  const {
    poetryWordMarkMap,
    poetryRequirednessUnderlineSet,
    poetryRequirednessUnderlineRangesByAbbr,
    poetryRequirednessConnectors,
    poetryClosureWeakSet,
    segLastWordId,
    poetryClosureCompleteSet,
    poetryClosureWeakRangesByAbbr,
    poetryClosureCompleteStartIds,
    balanceMarks,
    symmetryMarks,
    similarityMarkByWord,
    similarityGroupMembers,
    poetryNoteMap,
  } = useMemo(
    () => derivePoetryDisplayMaps(poetryNotations, words, wordToParaStart, wordIndexMap),
    [poetryNotations, words, wordToParaStart, wordIndexMap]
  );

  // The mark (if any) currently open for note-editing, resolved to the single
  // word its popover should anchor to. Balance/Symmetry are excluded — those
  // carry their own always-visible delete/note UI (PoetryMarginOverlay's label,
  // PoetryLineBadge for Symmetry), not this word-anchored popover. Every other
  // principle (including "closure — complete", which was previously and
  // wrongly excluded here — the only way to delete it was this popover, so it
  // was undeletable) opens here so its Delete button is reachable.
  const openPoetryNoteMarkByWord = useMemo(() => {
    const map = new Map<string, PoetryNotation>();
    if (editingNotationId == null) return map;
    const mark = poetryNotations.find((n) => n.id === editingNotationId);
    if (!mark || mark.principle === "balance" || mark.principle === "symmetry") return map;
    // Closure-complete's visible bar renders on the LAST word of its line
    // (poetryClosureCompleteSet, below) even though the mark's own
    // startWordId is the line's FIRST word — anchor the popover to the same
    // word as the bar so it appears where the user actually clicked.
    const anchorWordId = mark.principle === "closure" && mark.subtype === "complete"
      ? (segLastWordId.get(mark.startWordId) ?? mark.startWordId)
      : mark.startWordId;
    map.set(anchorWordId, mark);
    return map;
  }, [poetryNotations, editingNotationId, segLastWordId]);

  // Similarity's open mark, resolved to its full current group (or just
  // itself, ungrouped) — keyed the same way as openPoetryNoteMarkByWord so
  // each WordToken/VerseDisplay token can look up "is this my open mark, and
  // if so what's its group" in one place.
  const openPoetryNoteGroupMembersByWord = useMemo(() => {
    const map = new Map<string, PoetryNotation[]>();
    for (const [wordId, mark] of openPoetryNoteMarkByWord) {
      if (mark.principle !== "similarity") continue;
      const members = mark.similarityGroupId != null
        ? similarityGroupMembers.get(mark.similarityGroupId) ?? [mark]
        : [mark];
      map.set(wordId, members);
    }
    return map;
  }, [openPoetryNoteMarkByWord, similarityGroupMembers]);

  // True when any word in `arr` connects `a` and `b`, in either direction —
  // regardless of which group (if any) drew it, so we never draw a visible
  // duplicate over an arrow that's already there.
  function wordsAlreadyConnected(a: string, b: string): boolean {
    return wordArrowsState.some(
      (arr) => (arr.fromWordId === a && arr.toWordId === b) || (arr.fromWordId === b && arr.toWordId === a)
    );
  }

  // Fills in any missing consecutive connecting arrow across an ordered
  // group (word 1 -> word 2 -> word 3 -> ...), skipping any pair that's
  // already connected so this is safe to call repeatedly (Save, "Restore
  // arrow", and the mid-chain reconnect on delete all share this). Every
  // arrow it draws is yellow, per Similarity's own arrow color.
  async function ensureSimilarityGroupArrows(members: PoetryNotation[], groupId: number) {
    if (members.length < 2) return;
    const chapter = getChapterForWord(members[0].startWordId);
    for (let i = 0; i < members.length - 1; i++) {
      const a = members[i].startWordId;
      const b = members[i + 1].startWordId;
      if (!wordsAlreadyConnected(a, b)) await createDirectArrow(a, b, chapter, groupId, POETRY_COLORS.similarity);
    }
  }

  // Save writes the note to every current group member, then restores any
  // missing connecting arrow.
  async function handleSaveSimilarityGroup(mark: PoetryNotation, note: string | null) {
    const members = mark.similarityGroupId != null
      ? similarityGroupMembers.get(mark.similarityGroupId) ?? [mark]
      : [mark];
    await handleSaveSimilarityNote(members.map((m) => m.id), note);
    if (mark.similarityGroupId != null) await ensureSimilarityGroupArrows(members, mark.similarityGroupId);
  }

  // "Restore arrow" — same arrow-filling step as Save, without touching the
  // note, for when a user has manually deleted one of the group's connecting
  // arrows (via the Word Arrow tool's own delete button) and wants it back.
  async function handleRestoreSimilarityArrows(mark: PoetryNotation) {
    if (mark.similarityGroupId == null) return;
    const members = similarityGroupMembers.get(mark.similarityGroupId) ?? [mark];
    await ensureSimilarityGroupArrows(members, mark.similarityGroupId);
  }

  // Deletes just the one mark (not its whole group), then cleans up after
  // it: any arrow this group auto-drew that touched the deleted word; if the
  // deleted word had both a previous and a next member in the chain (i.e. it
  // was a middle word, not the first or last), immediately redraws the
  // bridging arrow between them, as if it were being created fresh, rather
  // than leaving a gap until the next Save; and — if that leaves exactly one
  // member — ungroups it, so a later "Add word" on it starts a clean new
  // group instead of silently reusing a stale id.
  async function handleDeleteSimilarityWord(mark: PoetryNotation) {
    const groupId = mark.similarityGroupId;
    if (groupId == null) {
      await handleDeletePoetryNotation(mark.id);
      return;
    }
    const members = similarityGroupMembers.get(groupId) ?? [mark];
    const idx = members.findIndex((m) => m.id === mark.id);
    const prev = idx > 0 ? members[idx - 1] : null;
    const next = idx >= 0 && idx < members.length - 1 ? members[idx + 1] : null;

    await handleDeletePoetryNotation(mark.id);
    const touchingArrows = wordArrowsState.filter(
      (arr) => arr.similarityGroupId === groupId && (arr.fromWordId === mark.startWordId || arr.toWordId === mark.startWordId)
    );
    await Promise.all(touchingArrows.map((arr) => handleDeleteWordArrow(arr.id)));
    if (prev && next) {
      const chapter = getChapterForWord(prev.startWordId);
      if (!wordsAlreadyConnected(prev.startWordId, next.startWordId)) {
        await createDirectArrow(prev.startWordId, next.startWordId, chapter, groupId, POETRY_COLORS.similarity);
      }
    }
    const remaining = members.filter((m) => m.id !== mark.id);
    if (remaining.length === 1) await handleUngroupMark(remaining[0].id);
  }

  // Whether the open mark's group is missing a connecting arrow somewhere
  // along its chain — e.g. the user manually deleted one via the Word Arrow
  // tool. Drives SimilarityNotePopover's "Restore arrow" button; keyed the
  // same way as openPoetryNoteGroupMembersByWord.
  const openPoetryNoteHasMissingArrowByWord = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const [wordId, members] of openPoetryNoteGroupMembersByWord) {
      let missing = false;
      for (let i = 0; i < members.length - 1; i++) {
        if (!wordsAlreadyConnected(members[i].startWordId, members[i + 1].startWordId)) { missing = true; break; }
      }
      map.set(wordId, missing);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPoetryNoteGroupMembersByWord, wordArrowsState]);

  const pendingSimilarityAnchor = similarityStart;

  // Nesting tree + per-line vertical-spacing overrides, recomputed whenever
  // the groups or the segment order changes.
  const lineGroupTree = useMemo(
    () => buildLineGroupTree(lineGroups, paragraphFirstWordIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineGroups, paragraphFirstWordIds.join(",")]
  );
  const lineGroupSpacingMap = useMemo(
    () => computeLineSpacing(lineGroupTree, paragraphFirstWordIds),
    [lineGroupTree, paragraphFirstWordIds]
  );
  // Extra vertical room for rows where a Balance/Symmetry anchor stack would
  // otherwise be crowded — additive space instead of ever widening the
  // margin horizontally, per request. Merged with LineGroups' own spacing
  // needs by taking whichever wants more room at a given row.
  const poetryAnchorLayout = useMemo(
    () => computePoetryAnchorLayout(balanceMarks, symmetryMarks, paragraphFirstWordIds),
    [balanceMarks, symmetryMarks, paragraphFirstWordIds]
  );
  const poetrySpacingMap = useMemo(
    () => computePoetrySpacingMap(poetryAnchorLayout, paragraphFirstWordIds, POETRY_STACK_STEP_PX, POETRY_STACK_BASE_PX),
    [poetryAnchorLayout, paragraphFirstWordIds]
  );
  const lineSpacingMap = useMemo(() => {
    if (poetrySpacingMap.size === 0) return lineGroupSpacingMap;
    const merged = new Map(lineGroupSpacingMap);
    for (const [key, val] of poetrySpacingMap) {
      merged.set(key, Math.max(val, merged.get(key) ?? 0));
    }
    return merged;
  }, [lineGroupSpacingMap, poetrySpacingMap]);

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
  // Gates the global keydown listener below — see `active` prop doc comment.
  // A ref (not a dependency) so SynopticView can move focus between mounted
  // columns without tearing down/re-registering the listener each time.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  // Gates only the router.push/replace navigation shortcuts (F8/F9/Ctrl+Arrow)
  // — see `navigationDisabled` prop doc comment.
  const navigationDisabledRef = useRef(navigationDisabled);
  useEffect(() => { navigationDisabledRef.current = navigationDisabled; }, [navigationDisabled]);
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
      if (!activeRef.current) return;
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
        if (inTextInput || navigationDisabledRef.current) return;
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
        if (inTextInput || navigationDisabledRef.current) return;
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
        if ((inTextInput && !inTranslationTextarea) || navigationDisabledRef.current) return;
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

  // Scroll to the ?v= verse on initial load (e.g. arriving from a lexicon
  // citation's "Open in main view" link). The keydown-driven verse-jump above
  // only reads ?v= reactively; this handles the one-time initial deep link.
  useEffect(() => {
    if (!initialVerse) return;
    const t = setTimeout(() => {
      document.getElementById(`verse-${initialVerse}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setShowSyllableStress(readLocal<boolean>("structura:showSyllableStress", false));
    setUseLinguisticTerms(readLocal<boolean>("structura:useLinguisticTerms", false));
    setHebrewFontSize(readLocal<number>("structura:hebrewFontSize", 1.375));
    setGreekFontSize(readLocal<number>("structura:greekFontSize", 1.25));
    setTranslationFontSize(readLocal<number>("structura:translationFontSize", 0.875));
    setLineHeightMultiplier(readLocal<number>("structura:lineHeightMultiplier", 1.0));
    // In translation-only mode always hide source text; otherwise restore stored pref.
    setHideSourceText(translationOnly || readLocal<boolean>("structura:hideSourceText", false));
    setToolbarVis({ ...defaultToolbarVisibility, ...readLocal<Partial<ToolbarVisibility>>(toolbarVisibilityStorageKey, {}) });
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
  useEffect(() => { writeLocal("structura:showSyllableStress", showSyllableStress); }, [showSyllableStress]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);
  // structura:rstLinked is now persisted inside useRstRelations hook.
  useEffect(() => { writeLocal(toolbarVisibilityStorageKey, toolbarVis); }, [toolbarVis, toolbarVisibilityStorageKey]);
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
      .then((rows: { id: number; name: string; direction: "ltr" | "rtl" }[]) => setDatasets(rows))
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

  // ── Load passages overlapping the current chapter (for "current passage"
  //    corpus option in word tag panel) ──────────────────────────────────
  const [currentPassages, setCurrentPassages] = useState<import("@/components/controls/WordTagPanel").CorpusPassageOption[]>([]);
  // Full verse-range bounds for every passage in this book, keyed by id — used
  // to precisely clip a "passage"-scoped tag's visibility to its actual
  // start/end verse (chapterFallsInPassage alone would treat a boundary
  // chapter as fully in-scope even past the passage's end verse).
  const [passageBoundsById, setPassageBoundsById] = useState<Map<number, import("@/lib/utils/passageRange").PassageVerseRange>>(new Map());
  useEffect(() => {
    const predecessorBook = CONTIGUOUS_BOOK_PREV[book] ?? null;
    const params = new URLSearchParams({ book, source: textSource });
    if (predecessorBook) params.set("book2", predecessorBook);
    fetch(`/api/passages?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { passages?: import("@/lib/db/schema").Passage[] }) => {
        const all = d.passages ?? [];
        setPassageBoundsById(new Map(all.map((p) => [p.id, {
          book: p.book, startChapter: p.startChapter, startVerse: p.startVerse,
          endBook: p.endBook, endChapter: p.endChapter, endVerse: p.endVerse,
        }])));
        const list = all.filter((p) => chapterFallsInPassage(p, book, chapter));
        setCurrentPassages(
          list.map((p) => ({
            id: p.id,
            label: p.label && p.label.trim() ? p.label : formatVerseRange(p.startChapter, p.startVerse, p.endChapter, p.endVerse, p.book),
            startChapter: p.startChapter,
            startVerse: p.startVerse,
            endChapter: p.endChapter,
            endVerse: p.endVerse,
          }))
        );
      })
      .catch(() => {});
  }, [book, chapter, textSource]);

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

  // wordId → chapter / bookId lookups (for the shared annotation hooks above,
  // and for disambiguating chapter numbers that collide across a cross-book
  // boundary — see lib/utils/chapterKey.ts).
  const wordToChapter = useMemo(
    () => new Map(words.map((w) => [w.wordId, w.chapter])),
    [words]
  );
  wordToChapterRef.current = wordToChapter;
  const wordToBookId = useMemo(
    () => new Map(words.map((w) => [w.wordId, w.bookId])),
    [words]
  );
  const bookIdToOsis = useMemo(() => {
    const m = new Map<number, string>();
    m.set(startBookId, book);
    if (endBookId != null && endBook) m.set(endBookId, endBook);
    return m;
  }, [startBookId, endBookId, book, endBook]);

  // Resolves the actual (book, chapter) a given wordId lives in, falling back
  // to the outer `book`/`chapter` props for ids not present in `words` (e.g.
  // synthetic ids). Every API call that persists data for a specific wordId
  // must use this instead of the outer props directly, since those only name
  // the "current" chapter — wrong for any other chapter/book once `words`
  // spans more than one (e.g. a passage).
  function getWordLocation(wordId: string): { book: string; chapter: number } {
    const bId = wordToBookId.get(wordId) ?? startBookId;
    return {
      book: bookIdToOsis.get(bId) ?? book,
      chapter: wordToChapter.get(wordId) ?? chapter,
    };
  }

  // Like getWordLocation, but also resolves the correct `textSource` for a
  // wordId — the current source edition (e.g. "OSHB") for ordinary source
  // words, or the owning translation's abbreviation for a translation-text
  // word (`tv:ABBR:Book.Ch.V.wi`), whose book/chapter are embedded in the id
  // itself rather than looked up via `words`. Every interlinear dataset API
  // call must use this instead of the outer `textSource` prop directly, since
  // datasets can now attach values under translation words too.
  function resolveWordSource(wordId: string): { textSource: string; book: string; chapter: number } {
    if (wordId.startsWith("tv:")) {
      const [, abbr, ref] = wordId.split(":");
      const parts = ref?.split(".") ?? [];
      if (abbr && parts.length === 4) {
        return { textSource: abbr, book: parts[0], chapter: parseInt(parts[1], 10) };
      }
    }
    return { textSource, ...getWordLocation(wordId) };
  }

  // Ordered verse list for rendering & prev/next lookups. Keyed by (bookId,
  // chapter) so two books that happen to share a raw chapter number don't get
  // merged into one group. Degenerates to a single chapter/book group for the
  // ordinary case (no endBook), identical to the old verse-only grouping.
  const orderedVerses = useMemo(() => {
    const byChapter = new Map<string, { bookId: number; ch: number; verses: Map<number, Word[]> }>();
    for (const w of words) {
      const key = chapterKey(w.bookId, w.chapter);
      let entry = byChapter.get(key);
      if (!entry) {
        entry = { bookId: w.bookId, ch: w.chapter, verses: new Map() };
        byChapter.set(key, entry);
      }
      if (!entry.verses.has(w.verse)) entry.verses.set(w.verse, []);
      entry.verses.get(w.verse)!.push(w);
    }
    // Cross-book passages have two independent chapter sequences (e.g. 1Sam ch31,
    // then 2Sam ch1–5). Sorting numerically would interleave them incorrectly;
    // preserve insertion order instead. Within each chapter, verses are always
    // monotonically increasing so sorting is still safe.
    const isCrossBook = !!(endBook && endBook !== book);
    const result: { bookId: number; book: string; ch: number; v: number; words: Word[] }[] = [];
    const chapterEntries = isCrossBook
      ? byChapter.values()
      : [...byChapter.values()].sort((a, b) => a.ch - b.ch);
    for (const entry of chapterEntries) {
      const entryBook = bookIdToOsis.get(entry.bookId) ?? book;
      for (const [v, vWords] of [...entry.verses.entries()].sort(([a], [b]) => a - b))
        result.push({ bookId: entry.bookId, book: entryBook, ch: entry.ch, v, words: vWords });
    }
    return result;
  }, [words, endBook, book, bookIdToOsis]);

  // Whether the current `words` actually spans multiple chapters.
  const isMultiChapter = orderedVerses.length > 0 &&
    (orderedVerses[orderedVerses.length - 1].ch !== orderedVerses[0].ch ||
     orderedVerses[orderedVerses.length - 1].bookId !== orderedVerses[0].bookId);

  // Verse groups keyed by "bookId:chapter:verse" (for the speech-section
  // handler, which needs to grab all words sharing a clicked word's verse).
  const chapterVerseGroups = useMemo(() => {
    const map = new Map<string, Word[]>();
    for (const w of words) {
      const key = `${w.bookId}:${w.chapter}:${w.verse}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(w);
    }
    return map;
  }, [words]);

  // Distinct (book, chapter) groups actually covered by `words` — degenerates
  // to a single {book, chapter} entry for the ordinary single-chapter case.
  const coveredBookChapters = useMemo(() => {
    const seen = new Map<string, { book: string; ch: number }>();
    for (const ov of orderedVerses) {
      const key = chapterKey(ov.bookId, ov.ch);
      if (!seen.has(key)) seen.set(key, { book: ov.book, ch: ov.ch });
    }
    return [...seen.values()];
  }, [orderedVerses]);

  // ── Load constituent labels for all chapters currently loaded ─────────────
  useEffect(() => {
    if (displayMode !== "interlinear" || interlinearSubMode !== "constituent") return;
    Promise.all(coveredBookChapters.map((g) =>
      fetch(`/api/interlinear/constituent-labels?workspaceId=1&book=${encodeURIComponent(g.book)}&chapter=${g.ch}&textSource=${encodeURIComponent(textSource)}`)
        .then((r) => r.json())
        .then((rows: { wordId: string; label: string; groupId: string | null }[]) => rows)
    ))
      .then((all) => {
        const flat = all.flat();
        setConstituentLabelMap(new Map(flat.map((r) => [r.wordId, r.label])));
        setConstituentGroupMap(new Map(flat.filter((r) => r.groupId).map((r) => [r.wordId, r.groupId as string])));
      })
      .catch(() => {});
  }, [displayMode, interlinearSubMode, coveredBookChapters, textSource]);

  // Which grouping-capable feature (if any) is currently active: a specific
  // custom dataset, or the built-in constituent-labeling mode.
  const activeDatasetId = typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset"
    ? interlinearSubMode.id
    : null;
  // Explicit text direction for the active dataset's labels/inputs — these
  // sit inside Hebrew source-text spans (dir="rtl") and would otherwise
  // silently inherit that direction, so it must be set explicitly rather
  // than left to inherit.
  const activeDatasetDirection = datasets.find((d) => d.id === activeDatasetId)?.direction ?? "ltr";
  const isConstituentMode = interlinearSubMode === "constituent";
  const groupingContextKey = isConstituentMode ? "constituent" : activeDatasetId != null ? `dataset:${activeDatasetId}` : "none";

  // Reset any in-progress grouping selection when leaving/switching the active
  // grouping-capable feature (a dataset, constituent labeling, or neither).
  useEffect(() => {
    setDatasetGroupingMode("off");
    setPendingGroupWordIds(new Set());
    setEditingGroupId(null);
    setGroupDraftValue("");
  }, [groupingContextKey]);

  // ── Load label color overrides for the active dataset ─────────────────────
  useEffect(() => {
    if (activeDatasetId == null) {
      setDatasetLabelColors(new Map());
      return;
    }
    fetch(`/api/interlinear/datasets/${activeDatasetId}/label-colors`)
      .then((r) => r.json())
      .then((rows: { value: string; color: string }[]) => {
        setDatasetLabelColors(new Map(rows.map((r) => [r.value, r.color])));
      })
      .catch(() => {});
  }, [activeDatasetId]);

  // ── Load transliteration formats for all chapters currently loaded ────────
  useEffect(() => {
    if (displayMode !== "interlinear" || interlinearSubMode !== "transliteration") return;
    Promise.all(coveredBookChapters.map((g) =>
      fetch(`/api/interlinear/transliteration-formats?workspaceId=1&book=${encodeURIComponent(g.book)}&chapter=${g.ch}&textSource=${encodeURIComponent(textSource)}`)
        .then((r) => r.json())
        .then((rows: { wordId: string; format: string }[]) => rows)
    ))
      .then((all) => setTransliterationFormatMap(new Map(all.flat().map((r) => [r.wordId, r.format]))))
      .catch(() => {});
  }, [displayMode, interlinearSubMode, coveredBookChapters, textSource]);

  // PassageNotesPane's ordered-verse shape — the full loaded range, so a
  // multi-chapter passage gets a note section per chapter, not just the
  // URL-anchored one.
  const notesOrderedVerses = useMemo(
    () => orderedVerses.map((ov) => ({ ch: ov.ch, v: ov.v })),
    [orderedVerses]
  );

  // True when the loaded words cover exactly one whole chapter (verse 1
  // through the last verse) — always true for the ordinary single-chapter
  // case; for a passage, only when it happens to span exactly one full chapter.
  const isWholeChapter = !isMultiChapter && (
    !isPassageMode || (
      orderedVerses.length > 0 &&
      orderedVerses[0].v === 1 &&
      maxVerseOfStartChapter != null &&
      orderedVerses[orderedVerses.length - 1].v === maxVerseOfStartChapter
    )
  );
  const wholeChapterNum = isWholeChapter ? (orderedVerses[0]?.ch ?? chapter) : undefined;

  // Track topmost visible verse via IntersectionObserver and sync the notes
  // pane when notesSynced is on. Uses a ref for the synced flag to avoid
  // recreating the observer on every toggle. Keyed by the "bookId:chapter:verse"
  // data-passage-verse-key on each verse's wrapper div (not VerseDisplay's own
  // id="verse-N", which collides across chapters/books) so this works
  // identically whether `words` covers one chapter or a whole passage.
  // Placed after orderedVerses so the dependency is in scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notesOpen) return;
    visibleVersesRef.current.clear();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const key = (entry.target as HTMLElement).dataset.passageVerseKey;
        if (!key) return;
        if (entry.isIntersecting) visibleVersesRef.current.add(key);
        else visibleVersesRef.current.delete(key);
      });
      if (!notesSyncedRef.current || visibleVersesRef.current.size === 0) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        if (!notesSyncedRef.current || visibleVersesRef.current.size === 0) return;
        const keys = [...visibleVersesRef.current];
        // Sort by bookId, then chapter, then verse, numerically
        keys.sort((a, b) => {
          const [aBook, ac, av] = a.split(":").map(Number);
          const [bBook, bc, bv] = b.split(":").map(Number);
          if (aBook !== bBook) return aBook - bBook;
          return ac !== bc ? ac - bc : av - bv;
        });
        const parts = keys[0].split(":");
        const ch = parseInt(parts[1]);
        const v  = parseInt(parts[2]);
        if (!isNaN(ch) && !isNaN(v)) setNotesScrollVerse({ ch, v });
      }, 300);
    }, { threshold: 0.1 });
    document.querySelectorAll("[data-passage-verse-key]").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [notesOpen, orderedVerses]);

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

  // Chapters actually covered by the currently-loaded `words` (degenerates to
  // {chapter} in the ordinary single-chapter case).
  const coveredChapterSet = useMemo(() => new Set(words.map((w) => w.chapter)), [words]);

  // Flatten sceneBreakMap + book-wide breaks into sorted array for cross-chapter range computation.
  // Breaks for covered chapters come from live state (sceneBreakMap); other chapters come from the
  // static bookSceneBreaks prop fetched at page load.
  const sectionRanges = useMemo(() => {
    // computeSectionRanges() does plain chapter arithmetic (sorting by raw
    // chapter number, `nextChapter - 1`, etc.), which only makes sense within
    // a single book's numbering. For a cross-book passage, offset every
    // end-book chapter by the start book's chapter count so both books map
    // onto one monotonic sequence — matching the same offset applied to
    // bookMaxVerses server-side. Chapters from bookSceneBreaks/sceneBreakMap
    // stay in their own book's raw numbering everywhere else, so the offset
    // is applied here only, right before the computeSectionRanges call.
    const offsetChapter = (bookId: number, ch: number) =>
      endBookId != null && bookId === endBookId && startBookChapterCount != null
        ? ch + startBookChapterCount
        : ch;

    // Start with book-wide breaks, excluding chapters covered by the loaded words (live state overrides)
    const allBreaks: { wordId: string; level: number; chapter: number; verse: number; extendedThrough: number | null }[] =
      bookSceneBreaks
        .filter((b) => !coveredChapterSet.has(b.chapter))
        .map((b) => ({ ...b, chapter: offsetChapter(b.bookId, b.chapter) }));

    // Add covered-chapter breaks from live sceneBreakMap state, offset the same way.
    for (const [wordId, arr] of sceneBreakMap) {
      const rawCh = wordToChapter.get(wordId) ?? chapter;
      const bookId = wordToBookId.get(wordId) ?? startBookId;
      const ch = offsetChapter(bookId, rawCh);
      for (const br of arr) {
        allBreaks.push({ wordId, level: br.level, chapter: ch, verse: br.verse, extendedThrough: null });
      }
    }

    const rawResult = computeSectionRanges(allBreaks, bookMaxVerses, book);
    if (endBookId == null || startBookChapterCount == null) return rawResult;

    // Un-offset endChapter back to the real per-book chapter number before
    // this map is used for display — the offset above exists only to make
    // computeSectionRanges' internal arithmetic work, it must not leak into
    // rendered output.
    const result = new Map<string, { endChapter: number; endVerse: number }>();
    for (const [key, range] of rawResult) {
      const endChapter = range.endChapter > startBookChapterCount
        ? range.endChapter - startBookChapterCount
        : range.endChapter;
      result.set(key, { endChapter, endVerse: range.endVerse });
    }
    return result;
  }, [sceneBreakMap, bookSceneBreaks, bookMaxVerses, wordToChapter, wordToBookId, endBookId, startBookId, startBookChapterCount, chapter, book, coveredChapterSet]);

  // Outline pane data for the isMultiChapter case: book-wide breaks for chapters
  // outside the currently-loaded words, plus live sceneBreakMap breaks resolved
  // to their real per-word chapter (not the single `chapter` prop). Passed via
  // OutlinePane's bookSceneBreaks prop (with sceneBreakMap swapped for the empty
  // map and chapter for -1) so OutlinePane's own single-chapter merge logic is a
  // no-op.
  const outlineBreaksForPane = useMemo(() => {
    const result: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null; transitional: boolean }[] =
      bookSceneBreaks
        .filter((b) => !coveredChapterSet.has(b.chapter))
        .map((b) => ({ ...b }));
    for (const [wordId, arr] of sceneBreakMap) {
      const ch = wordToChapter.get(wordId) ?? chapter;
      for (const br of arr) {
        result.push({ wordId, heading: br.heading, level: br.level, chapter: ch, verse: br.verse, positionInVerse: wordPositionMap.get(wordId) ?? 1, thematic: br.thematic, thematicLetter: br.thematicLetter, transitional: br.transitional });
      }
    }
    result.sort((a, b) =>
      a.chapter !== b.chapter ? a.chapter - b.chapter :
      a.verse   !== b.verse   ? a.verse   - b.verse   :
      a.level   - b.level
    );
    return result;
  }, [bookSceneBreaks, sceneBreakMap, wordToChapter, chapter, coveredChapterSet, wordPositionMap]);

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

  // ── Load dataset entries for active dataset across all chapters loaded ────
  // Includes entries for both the current source text AND every currently
  // active translation — a dataset can attach values under translation words
  // too, scoped per translation via textSource = the translation's abbreviation
  // (see the `tv:` wordId branch of resolveWordSource below).
  useEffect(() => {
    if (displayMode !== "interlinear") return;
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    const activeTranslationAbbrList = allAvailableTranslations
      .filter((t) => activeTranslationIds.has(t.id))
      .map((t) => t.abbreviation);
    const textSources = [textSource, ...activeTranslationAbbrList];
    Promise.all(
      coveredBookChapters.flatMap((g) =>
        textSources.map((ts) =>
          fetch(`/api/interlinear/datasets/${dsId}/entries?book=${encodeURIComponent(g.book)}&chapter=${g.ch}&textSource=${encodeURIComponent(ts)}`)
            .then((r) => r.json())
            .then((rows: { wordId: string; value: string; groupId: string | null }[]) => rows)
        )
      )
    )
      .then((all) => {
        const flat = all.flat();
        setDatasetEntryMap(new Map(flat.map((r) => [r.wordId, r.value])));
        setDatasetGroupMap(new Map(flat.filter((r) => r.groupId).map((r) => [r.wordId, r.groupId as string])));
      })
      .catch(() => {});
  }, [displayMode, interlinearSubMode, coveredBookChapters, textSource, allAvailableTranslations, activeTranslationIds]);

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

  // Build "bookId:chapter:verse" composite key → TranslationTextEntry[] for
  // active translations. Keyed by the full composite, not verse alone, so two
  // chapters that share a raw verse number (true of nearly every multi-chapter
  // passage) don't have their translation text collide — same class of bug
  // fixed for scene breaks/sections in Phase 0/2, applied here since it's
  // directly visible in the main reading view.
  const activeTranslationVerseMap = useMemo(() => {
    const map = new Map<string, TranslationTextEntry[]>();
    for (const t of allAvailableTranslations) {
      if (!activeTranslationIds.has(t.id)) continue;
      const verses = localTranslationVerseData[t.id] ?? [];
      // Deduplicate by (bookId, chapter, verse) — DB has no unique constraint.
      // Keep the highest-id row, which is the most recent insert.
      const deduped = new Map<string, typeof verses[0]>();
      for (const tv of verses) {
        const key = `${chapterKey(tv.bookId, tv.chapter)}:${tv.verse}`;
        const prev = deduped.get(key);
        if (!prev || tv.id > prev.id) deduped.set(key, tv);
      }
      for (const tv of deduped.values()) {
        const key = `${chapterKey(tv.bookId, tv.chapter)}:${tv.verse}`;
        const existing = map.get(key) ?? [];
        const entry: TranslationTextEntry = { abbr: t.abbreviation, text: tv.text, translationId: t.id, language: t.language };
        // Attach LXX word tokens so the translation column can render them individually.
        if (t.abbreviation === "LXX" && lxxVerseWords) {
          entry.words = lxxVerseWords.get(tv.verse);
        }
        existing.push(entry);
        map.set(key, existing);
      }
    }
    return map;
  }, [activeTranslationIds, allAvailableTranslations, localTranslationVerseData, lxxVerseWords]);

  // When editing, every loaded verse gets entries for all active translations
  // (empty where no data yet) — across every chapter currently loaded, not
  // just the URL-anchored one.
  const editingTranslationVerseMap = useMemo(() => {
    if (!editingTranslation) return activeTranslationVerseMap;
    const activeList = allAvailableTranslations.filter((t) => activeTranslationIds.has(t.id));
    const map = new Map<string, TranslationTextEntry[]>();
    for (const ov of orderedVerses) {
      const key = `${chapterKey(ov.bookId, ov.ch)}:${ov.v}`;
      const existing = activeTranslationVerseMap.get(key) ?? [];
      const existingAbbrs = new Set(existing.map((e) => e.abbr));
      const empties = activeList
        .filter((t) => !existingAbbrs.has(t.abbreviation))
        .map((t) => ({ abbr: t.abbreviation, text: "", translationId: t.id, language: t.language }));
      map.set(key, [...existing, ...empties]);
    }
    return map;
  }, [editingTranslation, activeTranslationVerseMap, allAvailableTranslations, activeTranslationIds, orderedVerses]);

  // Build abbr → ordered list of TV word IDs for shift-click range selection,
  // across every chapter currently loaded.
  const tvWordIdLists = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ov of orderedVerses) {
      const key = `${chapterKey(ov.bookId, ov.ch)}:${ov.v}`;
      const entries = activeTranslationVerseMap.get(key) ?? [];
      for (const { abbr, text, words: tvWords } of entries) {
        let list = map.get(abbr);
        if (!list) { list = []; map.set(abbr, list); }
        if (tvWords && tvWords.length > 0) {
          // LXX: use the actual word array rather than text tokens
          for (let wi = 0; wi < tvWords.length; wi++) {
            list.push(`tv:${abbr}:${ov.book}.${ov.ch}.${ov.v}.${wi}`);
          }
        } else {
          const tokens = text
            .split(/\s+/)
            .filter(Boolean)
            .flatMap((t) => t.split(/(?<=\u2014)(?=.)/));
          for (let wi = 0; wi < tokens.length; wi++) {
            list.push(`tv:${abbr}:${ov.book}.${ov.ch}.${ov.v}.${wi}`);
          }
        }
      }
    }
    return map;
  }, [activeTranslationVerseMap, orderedVerses]);

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

  // Per-verse KJV reference label (e.g. "1:17" for MT Jonah 2:1, or "4:21"
  // for MT 1Kgs 5:1) — active for any book/chapter with a versification
  // remap. Note this must NOT gate on "does any instruction have a different
  // kjvChapter than the current chapter" — a chapter can shift verse numbers
  // *within* the same chapter number (e.g. Exod 22, 1Chr 6), and those still
  // need labels. getKjvVerseLabel itself decides label-vs-null per verse
  // (and separately suppresses all Psalm labels, which use the
  // translationVerseOffset mechanism above instead). Returns undefined (no
  // function) only when no active translation exists or the chapter has no
  // remap at all.
  const translationVerseLabelFn = useMemo<((v: number) => string | null) | undefined>(() => {
    if (!hasActiveTranslations) return undefined;
    const instrs = getMtToKjvInstructions(book, chapter);
    if (!instrs) return undefined;
    return (v: number) => getKjvVerseLabel(book, chapter, v);
  }, [book, chapter, hasActiveTranslations]);

  // ── Find-in-page: TV hits + combined navigation list ──────────────────────
  // Declared after activeTranslationVerseMap to avoid TDZ errors.

  const findTvHitIds = useMemo<string[]>(() => {
    if (!findQuery.trim()) return [];
    const q = normalizeForSearch(findQuery);
    if (!q) return [];
    const hits: string[] = [];
    for (const ov of orderedVerses) {
      const key = `${chapterKey(ov.bookId, ov.ch)}:${ov.v}`;
      for (const { abbr, text } of activeTranslationVerseMap.get(key) ?? []) {
        const tokens = text.split(/\s+/).filter(Boolean).flatMap((t) => t.split(/(?<=—)(?=.)/));
        tokens.forEach((token, wi) => {
          if (normalizeForSearch(token).includes(q)) {
            hits.push(`tv:${abbr}:${ov.book}.${ov.ch}.${ov.v}.${wi}`);
          }
        });
      }
    }
    return hits;
  }, [activeTranslationVerseMap, orderedVerses, findQuery]);

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
    if (editingPoetryNotation) {
      handlePoetryWordSelectByIds(word.wordId, wordToParaStart.get(word.wordId) ?? word.wordId, undefined, shiftHeld);
      return;
    }
    if (editingWordCompare) {
      handleToggleWordCompareMark(word);
      return;
    }
    if (editingWordTags) {
      handleToggleWordTagRef(word, shiftHeld);
      return;
    }
    if (editingAnnotations) {
      // Map the clicked word to its paragraph-segment first-word-id
      const segId = wordToParaStart.get(word.wordId) ?? word.wordId;
      handleSelectAnnotationSegment(segId, shiftHeld);
      return;
    }
    if (editingLetterFormatting) {
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
      if (clusterLemmaCallback === null && activeCharId === null) return;
      handleToggleCharacterRef(word, shiftHeld);
      return;
    }
    if (editingSpeech) {
      if (activeCharId === null) return;
      handleToggleSpeechSection(word, shiftHeld);
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
    } else if (editingWordTags && activeWordTagId !== null) {
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), source }),
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
            body: JSON.stringify({ wordId: id, ...getWordLocation(id), source: textSource }),
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
          body: JSON.stringify({ wordId: id, ...getWordLocation(id), source: textSource }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), verse, source: textSource, level }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level, heading: heading.trim() || null }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), verse, source: textSource, level: fromLevel }) });
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), verse, source: textSource, level: toLevel }) });
      // Restore heading on the new level
      if (existing.heading) {
        await fetch("/api/scene-breaks", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, ...getWordLocation(wordId), level: toLevel, heading: existing.heading }) });
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level, outOfSequence }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level, extendedThrough }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level, thematic, thematicLetter }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId), level, transitional }),
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
    const { book: refBook, chapter: refChapter } = getWordLocation(wordId);

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
              body: JSON.stringify({ wordId, character1Id: null, book: refBook, chapter: refChapter, source }),
            });
          } else {
            await fetch("/api/character-refs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                wordId,
                character1Id: beforeRef.character1Id,
                character2Id: beforeRef.character2Id ?? null,
                book: refBook, chapter: refChapter, source,
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
        character2Id: null, textSource: source, book: refBook, chapter: refChapter, workspaceId: 0, versionId: 0,
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
          body: JSON.stringify({ wordId, character1Id: null, book: refBook, chapter: refChapter, source }),
        });
      } else if (nextRef) {
        await fetch("/api/character-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wordId,
            character1Id: nextRef.character1Id,
            character2Id: nextRef.character2Id,
            book: refBook, chapter: refChapter, source,
          }),
        });
      }
    } catch {
      setCharacterRefMap(prevRefMap);
    }
  }

  function handleToggleCharacterRef(word: Word, shiftHeld = false) {
    if (isPunctuationWord(word)) return;
    // Cluster lemma pick mode: route click to callback without creating/toggling a ref
    if (clusterLemmaCallback !== null) {
      const canonicalLemma = word.language === "hebrew"
        ? (word.strongNumber ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      const displayLabel = word.language === "hebrew"
        ? ((hebrewLemmas as Record<string, string>)[word.strongNumber ?? ""] ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      clusterLemmaCallback(canonicalLemma, displayLabel !== canonicalLemma ? displayLabel : undefined);
      return;
    }
    if (activeCharId === null) return;
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
    if (editingLetterFormatting) {
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
    } else if (editingWordTags && activeWordTagId !== null) {
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
    const { book: refBook, chapter: refChapter } = getWordLocation(wordId);
    const existing = wordTagRefMap.get(wordId);
    const isRemove = existing?.tagId === activeWordTagId;
    const tagId = isRemove ? null : activeWordTagId;

    // Optimistic update
    setWordTagRefMap((prev) => {
      const next = new Map(prev);
      if (isRemove) next.delete(wordId);
      else next.set(wordId, { id: -1, wordId, tagId: activeWordTagId!, textSource: source, book: refBook, chapter: refChapter, workspaceId: 0, versionId: 0 });
      return next;
    });

    try {
      await fetch("/api/word-tag-refs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, tagId, book: refBook, chapter: refChapter, source }),
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
      const displayLabel = word.language === "hebrew"
        ? ((hebrewLemmas as Record<string, string>)[word.strongNumber ?? ""] ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      clusterLemmaCallback(canonicalLemma, displayLabel !== canonicalLemma ? displayLabel : undefined);
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
    corpus?: import("@/components/controls/WordTagPanel").CorpusAssignment,
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpus?.groupingId ?? null,
      corpusType: corpus?.mode ?? "book",
      corpusChapter: corpus?.chapter ?? null,
      corpusPassageId: corpus?.passageId ?? null,
      lemmas: null, highlighted: false,
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, type, book,
          corpusType: corpus?.mode ?? "book",
          corpusGroupingId: corpus?.groupingId ?? null,
          corpusChapter: corpus?.chapter ?? null,
          corpusPassageId: corpus?.passageId ?? null,
        }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

      // If a source word was provided, create the ref immediately
      if (firstWordId && firstWordSource) {
        const { book: refBook, chapter: refChapter } = getWordLocation(firstWordId);
        const ref: WordTagRef = {
          id: -1, wordId: firstWordId, tagId: realTag.id,
          textSource: firstWordSource, book: refBook, chapter: refChapter, workspaceId: 0, versionId: 0,
        };
        setWordTagRefMap((prev) => new Map(prev).set(firstWordId, ref));
        await fetch("/api/word-tag-refs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: firstWordId, tagId: realTag.id, book: refBook, chapter: refChapter, source: firstWordSource }),
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
    corpus: import("@/components/controls/WordTagPanel").CorpusAssignment,
    corpusBooks: string[],
    type: "cluster" | "word" = "cluster",
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpus.groupingId, corpusType: corpus.mode,
      corpusChapter: corpus.chapter, corpusPassageId: corpus.passageId,
      lemmas: JSON.stringify(lemmas), highlighted: false,
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, book, lemmas, corpusBooks,
          textSource, currentChapter: chapter, type,
          corpusType: corpus.mode,
          corpusGroupingId: corpus.groupingId,
          corpusChapter: corpus.chapter,
          corpusPassageId: corpus.passageId,
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
              next.set(r.wordId, { id: -1, wordId: r.wordId, tagId: realTag.id, textSource: r.textSource, book: r.book, chapter: r.chapter, workspaceId: 0, versionId: 0 });
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

  function handleCreateConceptTag(name: string, color: string, corpus: import("@/components/controls/WordTagPanel").CorpusAssignment) {
    return handleCreateTag("concept", name, color, undefined, undefined, corpus);
  }

  function handleRequestWordClick(cb: (lemma: string, displayLabel?: string) => void) {
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

  async function handleUpdateWordTag(id: number, name: string, color: string, corpus?: import("@/components/controls/WordTagPanel").CorpusAssignment, lemmas?: string[] | null, prevLemmas?: string[] | null, corpusBooks?: string[]) {
    const prev = wordTags.find((t) => t.id === id);
    const lemmasJson = lemmas?.length ? JSON.stringify(lemmas) : null;
    setWordTags((ts) => ts.map((t) => t.id === id ? {
      ...t, name, color,
      corpusGroupingId: corpus ? corpus.groupingId : t.corpusGroupingId,
      corpusType: corpus ? corpus.mode : t.corpusType,
      corpusChapter: corpus ? corpus.chapter : t.corpusChapter,
      corpusPassageId: corpus ? corpus.passageId : t.corpusPassageId,
      lemmas: lemmas !== undefined ? lemmasJson : t.lemmas,
    } : t));
    try {
      const res = await fetch(`/api/word-tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, lemmas, prevLemmas,
          corpusType: corpus?.mode,
          corpusGroupingId: corpus?.groupingId,
          corpusChapter: corpus?.chapter,
          corpusPassageId: corpus?.passageId,
          corpusBooks, textSource, currentChapter: chapter, book,
        }),
      });
      const data = await res.json();
      const chapterRefs = (data.chapterRefs ?? []) as Array<{ wordId: string; book: string; chapter: number; textSource: string }>;
      if (chapterRefs.length > 0 || (prevLemmas?.length && lemmas !== prevLemmas)) {
        setWordTagRefMap((prev) => {
          const next = new Map(prev);
          for (const [wid, ref] of next) {
            if (ref.tagId === id) next.delete(wid);
          }
          for (const r of chapterRefs) {
            next.set(r.wordId, { id: -1, wordId: r.wordId, tagId: id, textSource: r.textSource, book: r.book, chapter: r.chapter, workspaceId: 0, versionId: 0 });
          }
          return next;
        });
      }
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

  async function handleToggleWordTagHighlight(id: number) {
    const tag = wordTags.find((t) => t.id === id);
    if (!tag) return;
    const nextHighlighted = !tag.highlighted;
    setWordTags((prev) => prev.map((t) => t.id === id ? { ...t, highlighted: nextHighlighted } : t));
    try {
      await fetch(`/api/word-tags/${id}/highlight`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlighted: nextHighlighted }),
      });
    } catch {
      // Revert on failure so the UI doesn't claim a persisted state that isn't.
      setWordTags((prev) => prev.map((t) => t.id === id ? { ...t, highlighted: !nextHighlighted } : t));
    }
  }

  async function handleReassignSpeechSection(sectionId: number, newCharId: number) {
    const section = speechSections.find((s) => s.id === sectionId);
    if (!section || section.characterId === newCharId) return;
    const { book: refBook, chapter: refChapter } = getWordLocation(section.startWordId);

    const beforeSections = [...speechSections];
    pushUndo({
      label: "Reassign speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: refBook, chapter: refChapter, source: textSource, sections: beforeSections }),
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
        body: JSON.stringify({ sectionId, characterId: newCharId, book: refBook, chapter: refChapter, source: textSource }),
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
    const { book: refBook, chapter: refChapter } = getWordLocation(section.startWordId);

    const beforeSections = [...speechSections];
    pushUndo({
      label: "Delete speech",
      undo: async () => {
        setSpeechSections(beforeSections);
        try {
          await fetch("/api/speech-sections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: refBook, chapter: refChapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    setSpeechSections((prev) => prev.filter((s) => s.id !== sectionId));
    try {
      const res = await fetch("/api/speech-sections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: section.startWordId, book: refBook, chapter: refChapter, source: textSource }),
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
    const clickedVerseWords = chapterVerseGroups.get(`${word.bookId}:${word.chapter}:${word.verse}`) ?? [word];
    const clickedSeg = findSeg(word.wordId, clickedVerseWords);

    // First click: record the first word of the clicked paragraph as range start
    if (!speechRangeStart) {
      setSpeechRangeStart(clickedSeg[0]);
      return;
    }

    // Second click: snap to the paragraph segment's last word; handle reverse order
    const startVerseWords = chapterVerseGroups.get(`${speechRangeStart.bookId}:${speechRangeStart.chapter}:${speechRangeStart.verse}`) ?? [speechRangeStart];
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
    const { book: refBook, chapter: refChapter } = getWordLocation(orderedStart);

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
            body: JSON.stringify({ book: refBook, chapter: refChapter, source: textSource, sections: beforeSections }),
          });
        } catch { /* best effort */ }
      },
    });

    // Optimistic: add a temporary section
    const tempSection: SpeechSection = {
      id: Date.now(), characterId: activeCharId,
      startWordId: orderedStart, endWordId: orderedEnd,
      textSource, book: refBook, chapter: refChapter, workspaceId: 0, versionId: 0,
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
          book: refBook, chapter: refChapter, source: textSource,
        }),
      });
      const data = await res.json();
      setSpeechSections(data.sections);
    } catch {
      setSpeechSections(beforeSections);
    }
  }

  async function handleCreateCharacter(
    name: string,
    color: string,
    corpus: import("@/components/controls/WordTagPanel").CorpusAssignment,
    lemmas: string[],
    corpusBooks: string[],
  ) {
    // Optimistic: add placeholder
    const tempChar: Character = {
      id: -(Date.now()), book, name, color,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpus.groupingId, corpusType: corpus.mode,
      corpusChapter: corpus.chapter, corpusPassageId: corpus.passageId,
      lemmas: lemmas.length ? JSON.stringify(lemmas) : null,
    };
    setCharacters((prev) => [...prev, tempChar]);
    setActiveCharId(tempChar.id);

    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, book, lemmas, corpusBooks,
          textSource, currentChapter: chapter,
          corpusType: corpus.mode,
          corpusGroupingId: corpus.groupingId,
          corpusChapter: corpus.chapter,
          corpusPassageId: corpus.passageId,
        }),
      });
      const data = await res.json();
      const realChar: Character = data.character;
      setCharacters((prev) => prev.map((c) => c.id === tempChar.id ? realChar : c));
      setActiveCharId(realChar.id);

      // Apply chapter refs returned from the server (lemma-driven bulk links)
      const chapterRefs = (data.chapterRefs ?? []) as Array<{ wordId: string; book: string; chapter: number; textSource: string }>;
      if (chapterRefs.length > 0) {
        setCharacterRefMap((prev) => {
          const next = new Map(prev);
          for (const r of chapterRefs) {
            if (!next.has(r.wordId)) {
              next.set(r.wordId, { id: -1, wordId: r.wordId, character1Id: realChar.id, character2Id: null, textSource: r.textSource, book: r.book, chapter: r.chapter, workspaceId: 0, versionId: 0 });
            }
          }
          return next;
        });
      }
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
    const { book: refBook, chapter: refChapter } = getWordLocation(paraStartWordId);
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
        body: JSON.stringify({ wordId: paraStartWordId, indentLevel: level, textSource, book: refBook, chapter: refChapter }),
      });
      if (indentsLinked) {
        await fetch("/api/line-indents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book: refBook, chapter: refChapter }),
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
    const { book: refBook, chapter: refChapter } = getWordLocation(paraStartWordId);
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
        body: JSON.stringify({ wordId: `tv:${paraStartWordId}`, indentLevel: level, textSource, book: refBook, chapter: refChapter }),
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

  // ── Syllable/stress override handlers ─────────────────────────────────────

  async function handleSetSyllableStressOverride(segWordId: string, stresses: number, syllables: number) {
    const { book: refBook, chapter: refChapter } = getWordLocation(segWordId);
    const prev = syllableStressOverrideMap.get(segWordId);
    const clamped = { stresses: Math.max(0, stresses), syllables: Math.max(0, syllables) };
    setSyllableStressOverrideMap((prevMap) => {
      const next = new Map(prevMap);
      next.set(segWordId, clamped);
      return next;
    });
    try {
      await fetch("/api/syllable-stress-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: segWordId, ...clamped, textSource, book: refBook, chapter: refChapter }),
      });
    } catch {
      setSyllableStressOverrideMap((prevMap) => {
        const next = new Map(prevMap);
        if (prev) next.set(segWordId, prev);
        else next.delete(segWordId);
        return next;
      });
    }
  }

  async function handleResetSyllableStressOverride(segWordId: string) {
    const { book: refBook, chapter: refChapter } = getWordLocation(segWordId);
    const prev = syllableStressOverrideMap.get(segWordId);
    if (!prev) return;
    setSyllableStressOverrideMap((prevMap) => {
      const next = new Map(prevMap);
      next.delete(segWordId);
      return next;
    });
    try {
      await fetch("/api/syllable-stress-overrides", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: segWordId, book: refBook, chapter: refChapter }),
      });
    } catch {
      setSyllableStressOverrideMap((prevMap) => {
        const next = new Map(prevMap);
        next.set(segWordId, prev);
        return next;
      });
    }
  }

  async function handleUpdateCharacter(
    id: number,
    name: string,
    color: string,
    corpus: import("@/components/controls/WordTagPanel").CorpusAssignment,
    lemmas: string[] | null,
    prevLemmas: string[] | null,
    corpusBooks: string[],
  ) {
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
    const lemmasJson = lemmas?.length ? JSON.stringify(lemmas) : null;
    setCharacters((cs) => cs.map((c) => c.id === id ? {
      ...c, name, color,
      corpusGroupingId: corpus.groupingId,
      corpusType: corpus.mode,
      corpusChapter: corpus.chapter,
      corpusPassageId: corpus.passageId,
      lemmas: lemmasJson,
    } : c));
    try {
      const res = await fetch(`/api/characters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, color, lemmas, prevLemmas, corpusBooks,
          textSource, currentChapter: chapter, book,
          corpusType: corpus.mode,
          corpusGroupingId: corpus.groupingId,
          corpusChapter: corpus.chapter,
          corpusPassageId: corpus.passageId,
        }),
      });
      const data = await res.json();
      const chapterRefs = (data.chapterRefs ?? []) as Array<{ wordId: string; book: string; chapter: number; textSource: string }>;
      const lemmasChanged = JSON.stringify(lemmas ?? []) !== JSON.stringify(prevLemmas ?? []);
      if (lemmasChanged) {
        setCharacterRefMap((prevMap) => {
          const next = new Map(prevMap);
          for (const [wid, ref] of next) {
            if (ref.character1Id === id) next.delete(wid);
            else if (ref.character2Id === id) next.set(wid, { ...ref, character2Id: null });
          }
          for (const r of chapterRefs) {
            next.set(r.wordId, { id: -1, wordId: r.wordId, character1Id: id, character2Id: null, textSource: r.textSource, book: r.book, chapter: r.chapter, workspaceId: 0, versionId: 0 });
          }
          return next;
        });
      }
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
        case "lineGroups":         setLineGroups([]); break;
        case "wordFormatting":     setWordFormattingMap(new Map()); break;
        case "lineAnnotations":    setLineAnnotations([]); break;
      }
    }
  }

  // ── Word formatting (bold / italic) handler ────────────────────────────────

  // ── Interlinear annotation handlers ────────────────────────────────────────

  async function handleSaveConstituentLabel(wordId: string, label: string | null) {
    const gid = constituentGroupMap.get(wordId);

    // Editing the label of a word that's already part of a saved grouping
    // updates the whole grouping, so all members stay in sync.
    if (label !== null && gid) {
      const members = [...constituentGroupMap.entries()].filter(([, g]) => g === gid).map(([w]) => w);
      setConstituentLabelMap((prev) => {
        const next = new Map(prev);
        for (const w of members) next.set(w, label);
        return next;
      });
      try {
        await fetch("/api/interlinear/constituent-labels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordIds: members, label, groupId: gid, textSource, ...getWordLocation(wordId) }),
          keepalive: true,
        });
      } catch { /* ignore */ }
      return;
    }

    // Optimistic update
    setConstituentLabelMap((prev) => {
      const next = new Map(prev);
      if (label === null) next.delete(wordId);
      else next.set(wordId, label);
      return next;
    });
    if (label === null && gid) {
      // Clearing a single grouped word just removes it from the grouping.
      setConstituentGroupMap((prev) => {
        const next = new Map(prev);
        next.delete(wordId);
        return next;
      });
    }
    try {
      if (label === null) {
        await fetch("/api/interlinear/constituent-labels", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId }),
          keepalive: true,
        });
      } else {
        await fetch("/api/interlinear/constituent-labels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordId, label, textSource, ...getWordLocation(wordId) }),
          keepalive: true,
        });
      }
    } catch { /* ignore */ }
  }

  async function handleSaveDatasetEntry(wordId: string, value: string | null) {
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    const gid = datasetGroupMap.get(wordId);

    // Editing the value of a word that's already part of a saved grouping
    // updates the whole grouping, so all members stay in sync.
    if (value !== null && gid) {
      const members = [...datasetGroupMap.entries()].filter(([, g]) => g === gid).map(([w]) => w);
      setDatasetEntryMap((prev) => {
        const next = new Map(prev);
        for (const w of members) next.set(w, value);
        return next;
      });
      try {
        // keepalive: survive a page reload/navigation triggered right after
        // the user saves — otherwise the browser aborts the in-flight write.
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordIds: members, value, groupId: gid, ...resolveWordSource(wordId) }),
          keepalive: true,
        });
      } catch { /* ignore */ }
      return;
    }

    // Optimistic update
    setDatasetEntryMap((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(wordId);
      else next.set(wordId, value);
      return next;
    });
    if (value === null && gid) {
      // Clearing a single grouped word just removes it from the grouping.
      setDatasetGroupMap((prev) => {
        const next = new Map(prev);
        next.delete(wordId);
        return next;
      });
    }
    try {
      if (value === null) {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId }),
          keepalive: true,
        });
      } else {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, value, ...resolveWordSource(wordId) }),
          keepalive: true,
        });
      }
    } catch { /* ignore */ }
  }

  function handleToggleNewGrouping() {
    setDatasetGroupingMode((prev) => {
      if (prev === "new") return "off";
      setPendingGroupWordIds(new Set());
      setEditingGroupId(null);
      setGroupDraftValue("");
      return "new";
    });
  }

  function handleToggleEditGrouping() {
    setDatasetGroupingMode((prev) => {
      if (prev === "edit") return "off";
      setPendingGroupWordIds(new Set());
      setEditingGroupId(null);
      setGroupDraftValue("");
      return "edit";
    });
  }

  function handleToggleDatasetGroupMember(wordId: string) {
    if (datasetGroupingMode === "off") return;
    const groupMap = isConstituentMode ? constituentGroupMap : datasetGroupMap;
    const valueMap  = isConstituentMode ? constituentLabelMap : datasetEntryMap;

    // Edit mode: the first click (nothing pending yet) on an already-grouped
    // word loads that whole group for editing rather than starting fresh.
    if (datasetGroupingMode === "edit" && pendingGroupWordIds.size === 0) {
      const gid = groupMap.get(wordId);
      if (gid) {
        const members = [...groupMap.entries()].filter(([, g]) => g === gid).map(([w]) => w);
        setPendingGroupWordIds(new Set(members));
        setEditingGroupId(gid);
        setGroupDraftValue(valueMap.get(wordId) ?? "");
        return;
      }
    }

    setPendingGroupWordIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  }

  async function handleSaveGrouping() {
    if (groupingContextKey === "none") return;
    const value = groupDraftValue.trim();
    if (pendingGroupWordIds.size === 0 || !value) return;
    const wordIds = [...pendingGroupWordIds];
    const groupId = editingGroupId ?? crypto.randomUUID();
    const prevGroupId = editingGroupId;

    if (isConstituentMode) {
      setConstituentLabelMap((prev) => {
        const next = new Map(prev);
        for (const id of wordIds) next.set(id, value);
        return next;
      });
      setConstituentGroupMap((prev) => {
        const next = new Map(prev);
        if (prevGroupId) {
          for (const [w, g] of prev) if (g === prevGroupId && !pendingGroupWordIds.has(w)) next.delete(w);
        }
        for (const id of wordIds) next.set(id, groupId);
        return next;
      });
      try {
        await fetch("/api/interlinear/constituent-labels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, wordIds, label: value, groupId, textSource, ...getWordLocation(wordIds[0]) }),
          keepalive: true,
        });
      } catch { /* ignore */ }
    } else {
      if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
      const dsId = interlinearSubMode.id;

      setDatasetEntryMap((prev) => {
        const next = new Map(prev);
        for (const id of wordIds) next.set(id, value);
        return next;
      });
      setDatasetGroupMap((prev) => {
        const next = new Map(prev);
        if (prevGroupId) {
          for (const [w, g] of prev) if (g === prevGroupId && !pendingGroupWordIds.has(w)) next.delete(w);
        }
        for (const id of wordIds) next.set(id, groupId);
        return next;
      });

      try {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordIds, value, groupId, ...resolveWordSource(wordIds[0]) }),
          keepalive: true,
        });
      } catch { /* ignore */ }
    }

    setPendingGroupWordIds(new Set());
    setEditingGroupId(null);
    setGroupDraftValue("");
  }

  async function handleSetLabelColor(value: string, color: string | null) {
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;

    setDatasetLabelColors((prev) => {
      const next = new Map(prev);
      if (color === null) next.delete(value);
      else next.set(value, color);
      return next;
    });
    try {
      if (color === null) {
        await fetch(`/api/interlinear/datasets/${dsId}/label-colors`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
          keepalive: true,
        });
      } else {
        await fetch(`/api/interlinear/datasets/${dsId}/label-colors`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value, color }),
          keepalive: true,
        });
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteGrouping() {
    if (groupingContextKey === "none") return;
    if (!editingGroupId) return;
    const gid = editingGroupId;

    if (isConstituentMode) {
      setConstituentLabelMap((prev) => {
        const next = new Map(prev);
        for (const [w, g] of constituentGroupMap) if (g === gid) next.delete(w);
        return next;
      });
      setConstituentGroupMap((prev) => {
        const next = new Map(prev);
        for (const [w, g] of prev) if (g === gid) next.delete(w);
        return next;
      });
      try {
        await fetch("/api/interlinear/constituent-labels", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: 1, groupId: gid }),
          keepalive: true,
        });
      } catch { /* ignore */ }
    } else {
      if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
      const dsId = interlinearSubMode.id;

      setDatasetEntryMap((prev) => {
        const next = new Map(prev);
        for (const [w, g] of datasetGroupMap) if (g === gid) next.delete(w);
        return next;
      });
      setDatasetGroupMap((prev) => {
        const next = new Map(prev);
        for (const [w, g] of prev) if (g === gid) next.delete(w);
        return next;
      });
      try {
        await fetch(`/api/interlinear/datasets/${dsId}/entries`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: gid }),
          keepalive: true,
        });
      } catch { /* ignore */ }
    }

    setPendingGroupWordIds(new Set());
    setEditingGroupId(null);
    setGroupDraftValue("");
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
          body: JSON.stringify({ workspaceId: 1, wordId, format, textSource, ...getWordLocation(wordId) }),
        });
      }
    } catch { /* ignore */ }
  }

  async function handleCreateDataset(name: string, direction: "ltr" | "rtl" = "ltr"): Promise<{ id: number; name: string; direction: "ltr" | "rtl" } | null> {
    try {
      const res  = await fetch("/api/interlinear/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: 1, name, direction }),
      });
      const ds   = await res.json() as { id: number; name: string; direction: "ltr" | "rtl" };
      setDatasets((prev) => [...prev, ds]);
      return ds;
    } catch {
      return null;
    }
  }

  async function handleSetDatasetDirection(id: number, direction: "ltr" | "rtl") {
    setDatasets((prev) => prev.map((d) => d.id === id ? { ...d, direction } : d));
    try {
      await fetch(`/api/interlinear/datasets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
    } catch { /* ignore */ }
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
      if (wordId && value) entries.push({ wordId, value, textSource, ...getWordLocation(wordId) });
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

  const EMPTY_WORD_FORMATTING = { isBold: false, isItalic: false, isUnderline: false, textColor: null as string | null, letterColors: null as Record<number, string> | null, letterBold: null as number[] | null, letterItalic: null as number[] | null, letterUnderline: null as number[] | null };
  function isEmptyWordFormatting(f: typeof EMPTY_WORD_FORMATTING): boolean {
    return !f.isBold && !f.isItalic && !f.isUnderline && !f.textColor && !f.letterColors && !f.letterBold && !f.letterItalic && !f.letterUnderline;
  }
  function postWordFormatting(wordId: string, f: typeof EMPTY_WORD_FORMATTING, source: string) {
    return fetch("/api/word-formatting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId, ...f, textSource: source, ...getWordLocation(wordId) }),
    });
  }

  // Core toggle — shared by source words (source = textSource) and translation
  // words (source = translation abbreviation, e.g. "ESV").
  async function handleToggleFormattingById(wordId: string, source: string) {
    const existing = wordFormattingMap.get(wordId) ?? EMPTY_WORD_FORMATTING;
    const nextBold      = editingBold      ? !existing.isBold      : existing.isBold;
    const nextItalic    = editingItalic    ? !existing.isItalic    : existing.isItalic;
    const nextUnderline = editingUnderline ? !existing.isUnderline : existing.isUnderline;
    // Color isn't a plain boolean toggle: clicking a word that already has the
    // currently-active color removes it (back to default); otherwise it's set
    // (or replaced) to the active color — mirrors bold/italic's "click again
    // to undo" behavior while still allowing one click to switch colors.
    const nextColor  = editingTextColor
      ? (existing.textColor === activeTextColor ? null : activeTextColor)
      : existing.textColor;
    // A whole-word click for a given mode supersedes any per-letter overrides
    // of that same mode on this word.
    const next = {
      isBold: nextBold, isItalic: nextItalic, isUnderline: nextUnderline, textColor: nextColor,
      letterColors:  editingTextColor  ? null : existing.letterColors,
      letterBold:    editingBold       ? null : existing.letterBold,
      letterItalic:  editingItalic     ? null : existing.letterItalic,
      letterUnderline: editingUnderline ? null : existing.letterUnderline,
    };

    // Optimistic update
    setWordFormattingMap((prev) => {
      const map = new Map(prev);
      if (isEmptyWordFormatting(next)) map.delete(wordId);
      else map.set(wordId, next);
      return map;
    });
    try {
      await postWordFormatting(wordId, next, source);
    } catch {
      // Rollback on error
      setWordFormattingMap((prev) => {
        const map = new Map(prev);
        if (isEmptyWordFormatting(existing)) map.delete(wordId);
        else map.set(wordId, existing);
        return map;
      });
    }
  }

  async function handleToggleWordFormatting(word: Word) {
    return handleToggleFormattingById(word.wordId, textSource);
  }

  function coreTextGraphemes(coreText: string): string[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(coreText)].map((s) => s.segment);
  }

  // `hi` may exceed the cluster count (callers pass Infinity to mean "through
  // the end of the word"), so it's clamped before sizing the array.
  function nonPunctuationIndices(clusters: string[], lo: number, hi: number): number[] {
    const clampedHi = Math.min(hi, clusters.length - 1);
    return Array.from({ length: Math.max(0, clampedHi - lo + 1) }, (_, i) => lo + i)
      .filter((idx) => idx >= 0 && idx < clusters.length && !TEXT_COLOR_EXCLUDED_PUNCTUATION.test(clusters[idx]));
  }

  // ── Letter-level formatting click (translation word) — shared by whichever
  // of bold/italic/underline/color are currently active. A plain click
  // formats the whole word (same as clicking anywhere else in it); a
  // shift-click anchors a grapheme, and a second shift-click commits a range
  // between them. When the two clicks land in the same word, the range is a
  // letter span within it; when they land in different words, the range
  // covers every word in between (each formatted in full) plus the partial
  // spans in the two boundary words. Punctuation (parentheses, brackets,
  // commas, semicolons, colons, periods) is excluded even when it falls
  // between the two clicks.
  function handleFormattingGraphemeClick(wordId: string, graphemeIndex: number, source: string, coreText: string, shiftHeld: boolean) {
    if (!shiftHeld) {
      setLetterFormatAnchor(null);
      handleToggleFormattingById(wordId, source);
      return;
    }
    if (!letterFormatAnchor) {
      setLetterFormatAnchor({ wordId, graphemeIndex, coreText });
      return;
    }
    if (letterFormatAnchor.wordId === wordId) {
      const [lo, hi] = letterFormatAnchor.graphemeIndex <= graphemeIndex
        ? [letterFormatAnchor.graphemeIndex, graphemeIndex]
        : [graphemeIndex, letterFormatAnchor.graphemeIndex];
      setLetterFormatAnchor(null);
      const indices = nonPunctuationIndices(coreTextGraphemes(coreText), lo, hi);
      if (indices.length === 0) return;
      applyLetterRangeFormatting(wordId, indices, source);
      return;
    }

    // Different word — resolve chapter order to find everything in between.
    // If order can't be resolved (e.g. the two words aren't both in this
    // translation's list), just re-anchor to the new click rather than
    // silently guessing at a range.
    const tvList = tvWordIdLists.get(source) ?? [];
    const anchorPos = tvList.indexOf(letterFormatAnchor.wordId);
    const clickPos = tvList.indexOf(wordId);
    const anchor = letterFormatAnchor;
    setLetterFormatAnchor(null);
    if (anchorPos === -1 || clickPos === -1) {
      setLetterFormatAnchor({ wordId, graphemeIndex, coreText });
      return;
    }

    const [firstWordId, firstIdx, firstCoreText, lastWordId, lastIdx, lastCoreText] = anchorPos <= clickPos
      ? [anchor.wordId, anchor.graphemeIndex, anchor.coreText, wordId, graphemeIndex, coreText]
      : [wordId, graphemeIndex, coreText, anchor.wordId, anchor.graphemeIndex, anchor.coreText];

    const firstIndices = nonPunctuationIndices(coreTextGraphemes(firstCoreText), firstIdx, Infinity);
    if (firstIndices.length > 0) applyLetterRangeFormatting(firstWordId, firstIndices, source);

    const lastIndices = nonPunctuationIndices(coreTextGraphemes(lastCoreText), 0, lastIdx);
    if (lastIndices.length > 0) applyLetterRangeFormatting(lastWordId, lastIndices, source);

    const [lo, hi] = [Math.min(anchorPos, clickPos), Math.max(anchorPos, clickPos)];
    for (const midWordId of tvList.slice(lo + 1, hi)) {
      applyWholeWordFormatting(midWordId, source);
    }
  }

  // Force-sets (never toggles off) whichever mode(s) are active — used for
  // the whole words that fall between a multi-word shift-click's two
  // endpoints, since a range selection paints everything it covers rather
  // than toggling each word's pre-existing state individually.
  async function applyWholeWordFormatting(wordId: string, source: string) {
    const existing = wordFormattingMap.get(wordId) ?? EMPTY_WORD_FORMATTING;
    const next = {
      ...existing,
      isBold: editingBold ? true : existing.isBold,
      isItalic: editingItalic ? true : existing.isItalic,
      isUnderline: editingUnderline ? true : existing.isUnderline,
      textColor: editingTextColor ? activeTextColor : existing.textColor,
    };
    if (next.isBold === existing.isBold && next.isItalic === existing.isItalic && next.isUnderline === existing.isUnderline && next.textColor === existing.textColor) return;
    setWordFormattingMap((prev) => {
      const map = new Map(prev);
      map.set(wordId, next);
      return map;
    });
    try {
      await postWordFormatting(wordId, next, source);
    } catch {
      setWordFormattingMap((prev) => {
        const map = new Map(prev);
        if (isEmptyWordFormatting(existing)) map.delete(wordId);
        else map.set(wordId, existing);
        return map;
      });
    }
  }

  // Toggles `indices` within a number[] override list: if every index is
  // already present, they're all removed (mirrors the "click again to undo"
  // behavior); otherwise every missing index is added.
  function toggleLetterIndices(current: number[] | null, indices: number[]): number[] | null {
    const set = new Set(current ?? []);
    const allActive = indices.every((idx) => set.has(idx));
    for (const idx of indices) {
      if (allActive) set.delete(idx);
      else set.add(idx);
    }
    return set.size > 0 ? [...set].sort((a, b) => a - b) : null;
  }

  async function applyLetterRangeFormatting(wordId: string, indices: number[], source: string) {
    const existing = wordFormattingMap.get(wordId) ?? EMPTY_WORD_FORMATTING;
    const next = { ...existing };

    if (editingTextColor) {
      const cur = existing.letterColors ?? {};
      // Clicking a range that's already entirely the active color removes it
      // (mirrors the whole-word "click again to undo" behavior); otherwise
      // the whole range is set (or replaced) to the active color.
      const allActive = indices.every((idx) => cur[idx] === activeTextColor);
      const obj: Record<number, string> = { ...cur };
      for (const idx of indices) {
        if (allActive) delete obj[idx];
        else obj[idx] = activeTextColor;
      }
      next.letterColors = Object.keys(obj).length > 0 ? obj : null;
    }
    if (editingBold) next.letterBold = toggleLetterIndices(existing.letterBold, indices);
    if (editingItalic) next.letterItalic = toggleLetterIndices(existing.letterItalic, indices);
    if (editingUnderline) next.letterUnderline = toggleLetterIndices(existing.letterUnderline, indices);

    setWordFormattingMap((prev) => {
      const map = new Map(prev);
      if (isEmptyWordFormatting(next)) map.delete(wordId);
      else map.set(wordId, next);
      return map;
    });
    try {
      await postWordFormatting(wordId, next, source);
    } catch {
      setWordFormattingMap((prev) => {
        const map = new Map(prev);
        if (isEmptyWordFormatting(existing)) map.delete(wordId);
        else map.set(wordId, existing);
        return map;
      });
    }
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId) }),
      }).catch(() => {});
    } else {
      // Assign active mark
      setTcMarkMap((prev) => new Map(prev).set(wordId, activeTcMark));
      fetch("/api/text-critical-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, markType: activeTcMark, textSource: wordTextSource, ...getWordLocation(wordId) }),
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
        body: JSON.stringify({ wordId, ...getWordLocation(wordId) }),
      }).catch(() => {});
    } else {
      setTcMarkMap((prev) => new Map(prev).set(wordId, activeTcMark));
      fetch("/api/text-critical-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, markType: activeTcMark, textSource: wordTextSource, ...getWordLocation(wordId) }),
      }).catch(() => {});
    }
  }

  // ── Translation verse text edit handler ────────────────────────────────────
  // book/chapter identify which verse-N is meant — a passage view can span
  // multiple chapters that share a raw verse number, so matching by verse
  // alone would silently read/write the wrong chapter's text (and, worse,
  // overwrite it with content derived from a different verse entirely).
  async function handleUpdateTranslationVerse(abbr: string, vBook: string, vChapter: number, verse: number, newText: string, record = true) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.chapter === vChapter && tv.verse === verse);

    // ── Create new record when verse has no existing translation ─────────
    if (!tvRecord) {
      if (!newText.trim()) return; // nothing to save
      try {
        const res = await fetch("/api/translation-verses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            translationId: translation.id,
            book: vBook,
            chapter: vChapter,
            verse,
            text: newText,
          }),
        });
        const { id } = await res.json() as { id: number };
        setLocalTranslationVerseData((prev) => ({
          ...prev,
          [translation.id]: [
            ...(prev[translation.id] ?? []),
            { id, workspaceId: 1, translationId: translation.id, osisRef: `${vBook}.${vChapter}.${verse}`, bookId: 0, chapter: vChapter, verse, text: newText },
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
        undo: () => handleUpdateTranslationVerse(abbr, vBook, vChapter, verse, oldText, false),
      });
      // Fire-and-forget server-side version snapshot
      fetch("/api/translation-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationId: translation.id,
          osisRef: `${vBook}.${vChapter}.${verse}`,
          text: oldText,
        }),
      }).catch(() => {});
    }

    // Optimistic update
    setLocalTranslationVerseData((prev) => ({
      ...prev,
      [translation.id]: (prev[translation.id] ?? []).map((tv) =>
        tv.chapter === vChapter && tv.verse === verse ? { ...tv, text: newText } : tv
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
          tv.chapter === vChapter && tv.verse === verse ? { ...tv, text: oldText } : tv
        ),
      }));
    }
  }

  // Revert a verse back to the text it had when translation editing mode was entered
  async function handleCancelTranslationVerse(abbr: string, vBook: string, vChapter: number, verse: number) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const snapshot = translationEditSnapshotRef.current;
    const snapRecord = snapshot[translation.id]?.find((tv) => tv.chapter === vChapter && tv.verse === verse);
    if (!snapRecord) return;
    await handleUpdateTranslationVerse(abbr, vBook, vChapter, verse, snapRecord.text, false);
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
   * Returns footnotes for a given (translationId, chapter, verse) sorted by
   * wordIndex asc, then id asc — the same order as the `\fn \fn*` markers in
   * the verse text. Chapter-scoped (not verse-only) so that a passage
   * spanning multiple chapters doesn't collide footnotes that happen to
   * share a verse number in different chapters (e.g. Ps 29:7 and Ps 30:7).
   */
  function sortedVerseFootnotes(translationId: number, chapter: number, verse: number): TranslationFootnote[] {
    return (localFootnotes[translationId] ?? [])
      .filter((fn) => fn.chapter === chapter && fn.verse === verse)
      .sort((a, b) => a.wordIndex - b.wordIndex || a.id - b.id);
  }

  async function handleCreateFootnote() {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === fnDialogAbbr);
    if (!translation || !fnDialogContent.trim()) return;
    try {
      const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.chapter === fnDialogChapter && tv.verse === fnDialogVerse);
      const existingText = tvRecord?.text ?? "";
      const anchor = fnAnchorRef.current;
      const insertPos = anchor ? Math.min(anchor.pos, existingText.length) : existingText.length;
      const wordIndex = existingText.slice(0, insertPos).trim().split(/\s+/).filter(Boolean).length;

      const res = await fetch("/api/translation-footnotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationId: translation.id,
          osisRef: `${fnDialogBook}.${fnDialogChapter}.${fnDialogVerse}`,
          type: fnDialogType,
          content: fnDialogContent.trim(),
          wordIndex,
          book: fnDialogBook,
          chapter: fnDialogChapter,
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
          await handleUpdateTranslationVerse(fnDialogAbbr, fnDialogBook, fnDialogChapter, fnDialogVerse, newText);
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
    setFnDialogBook(fn.book);
    setFnDialogChapter(fn.chapter);
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

    const { translationId, book: fnBook, chapter: fnChapter, verse } = targetFn;
    const translation = allAvailableTranslations.find((t) => t.id === translationId);
    if (!translation) { setFnAnchorMoveId(null); return; }

    // Rank of this footnote among same-(chapter, verse) footnotes (sorted order)
    const siblings = sortedVerseFootnotes(translationId, fnChapter, verse);
    const rank = siblings.findIndex((fn) => fn.id === fnId);
    if (rank < 0) { setFnAnchorMoveId(null); return; }

    // Current verse text
    const tvRecord = localTranslationVerseData[translationId]?.find((tv) => tv.chapter === fnChapter && tv.verse === verse);
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
      await handleUpdateTranslationVerse(translation.abbreviation, fnBook, fnChapter, verse, newText);

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

  async function copyTranslationText() {
    if (orderedVerses.length === 0) return;
    // Build plain text: one block per (book, chapter, translation abbreviation)
    const abbrSet = new Set<string>();
    for (const entries of activeTranslationVerseMap.values()) {
      for (const e of entries) abbrSet.add(e.abbr);
    }
    const abbrs = [...abbrSet];
    const chunks: string[] = [];
    for (const abbr of abbrs) {
      let lastCh: number | null = null;
      let lastBookId: number | null = null;
      for (const ov of orderedVerses) {
        if (ov.ch !== lastCh || ov.bookId !== lastBookId) {
          chunks.push(`${t(`books.${ov.book}` as Parameters<typeof t>[0]) || ov.book} ${ov.ch} (${abbr})`);
          lastCh = ov.ch;
          lastBookId = ov.bookId;
        }
        const key = `${chapterKey(ov.bookId, ov.ch)}:${ov.v}`;
        const entry = (activeTranslationVerseMap.get(key) ?? []).find((e) => e.abbr === abbr);
        if (entry?.text) chunks.push(`${ov.v} ${entry.text}`);
      }
    }
    const plain = chunks.join("\n");
    await navigator.clipboard.writeText(plain).catch(() => {});
    setCopiedTranslation(true);
    setTimeout(() => setCopiedTranslation(false), 2000);
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
        const siblings = sortedVerseFootnotes(translationId, targetFn.chapter, targetFn.verse);
        const rank = siblings.findIndex((fn) => fn.id === fnId);
        const tvRecord = localTranslationVerseData[translationId]?.find((tv) => tv.chapter === targetFn.chapter && tv.verse === targetFn.verse);
        if (tvRecord && rank >= 0) {
          const newText = removeNthFnMarker(tvRecord.text, rank);
          if (newText !== tvRecord.text) {
            await handleUpdateTranslationVerse(translation.abbreviation, targetFn.book, targetFn.chapter, targetFn.verse, newText);
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
    await handleUpdateTranslationVerse(historyAbbr, book, chapter, historyVerse, versionText, true);
    setHistoryOpen(false);
  }

  // ── Mode mutual-exclusivity ────────────────────────────────────────────────
  // Compatible groups (may be active simultaneously):
  //   A: indent (compatible with paragraph, speech, rst)
  //   B: bold + italic + underline + textColor
  //   C: speech + rst + indent
  // All other combinations are mutually incompatible.
  // Modes that are mutually exclusive with each other (only one may be active):
  //   refs, speech, arrows, wordTags, paragraph
  // Each lists everything it is COMPATIBLE with — i.e., everything except the
  // other annotation-editing modes.
  const NON_ANNOTATION = ["paragraph", "scenes", "annotations", "indents", "rst", "lineGroups", "poetry"] as const;
  const COMPAT: Record<string, string[]> = {
    paragraph:   ["indents"],
    indents:     ["paragraph", "speech", "rst", "lineGroups"],
    bold:        ["italic", "underline", "textColor"],
    italic:      ["bold", "underline", "textColor"],
    underline:   ["bold", "italic", "textColor"],
    textColor:   ["bold", "italic", "underline"],
    speech:      ["rst", "indents", "scenes", "annotations"],
    rst:         ["speech", "indents"],
    lineGroups:  ["indents"],
    arrows:      [...NON_ANNOTATION],
    scenes:      [],
    annotations: [],
    poetry:      [],
    refs:        ["annotations", "indents", "rst"],
    wordTags:    ["indents", "rst"],
    wordCompare: [],
  };
  function deactivateIncompatible(mode: string) {
    const keep = new Set([mode, ...(COMPAT[mode] ?? [])]);
    if (!keep.has("paragraph"))   setEditingParagraphs(false);
    if (!keep.has("scenes"))      setEditingScenes(false);
    if (!keep.has("annotations")) { setEditingAnnotations(false); setAnnotRangeStart(null); setAnnotRangeEnd(null); setEditingAnnotationId(null); }
    if (!keep.has("poetry"))      { setEditingPoetryNotation(false); clearPoetryPending(); }
    if (!keep.has("refs"))        { setEditingRefs(false); setRefRangeStart(null); }
    if (!keep.has("speech"))      { setEditingSpeech(false); setSpeechRangeStart(null); }
    if (!keep.has("wordTags"))    { setEditingWordTags(false); setWordTagRangeStart(null); }
    if (!keep.has("indents"))     setEditingIndents(false);
    if (!keep.has("syllableStress")) setEditingSyllableStress(false);
    if (!keep.has("rst"))         { setEditingRst(false); setRstSegA(null); setRstSegB(null); setShowRstPicker(false); setRstEditGroupId(null); }
    if (!keep.has("lineGroups"))  { setEditingLineGroups(false); setLineGroupSegA(null); setLineGroupSegAGroupId(null); setShowLineGroupColors(false); }
    if (!keep.has("arrows"))      { setEditingArrows(false); setArrowFromWordId(null); }
    if (!keep.has("bold"))        setEditingBold(false);
    if (!keep.has("italic"))      setEditingItalic(false);
    if (!keep.has("underline"))   setEditingUnderline(false);
    if (!keep.has("textColor"))   setEditingTextColor(false);
    if (!keep.has("footnotes"))   { setEditingFootnotes(false); setFnAnchorMoveId(null); }
    if (!keep.has("wordCompare")) { setEditingWordCompare(false); setWordCompareRangeStart(null); }
  }

  // ── Passage range control logic (only meaningful when isPassageMode) ─────
  const canExtendStart = !!passageState && !(passageState.startChapter === 1 && passageState.startVerse === 1);
  const canShrinkStart = !!passageState && (passageState.startChapter < passageState.endChapter || passageState.startVerse < passageState.endVerse);
  const canShrinkEnd   = !!passageState && (passageState.startChapter < passageState.endChapter || passageState.startVerse < passageState.endVerse);
  const canExtendEnd   = !!passageState && !(passageState.endChapter === startBookChapterCount && passageState.endVerse >= (maxVerseOfEndChapter ?? 0));

  async function applyRange(
    updates: Partial<Pick<Passage, "startChapter" | "startVerse" | "endChapter" | "endVerse">>
  ) {
    if (!passageState) return;
    const next = { ...passageState, ...updates };
    setPassageState(next);
    try {
      await fetch(`/api/passages/${passageState.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      startTransition(() => router.refresh());
    } catch {
      setPassageState(passageState);
    }
  }

  function handleExtendStart() {
    if (!passageState || !canExtendStart || isPending) return;
    if (passageState.startVerse > 1) {
      applyRange({ startVerse: passageState.startVerse - 1 });
    } else {
      applyRange({ startChapter: passageState.startChapter - 1, startVerse: maxVerseOfPrevStartChapter || 1 });
    }
  }

  function handleShrinkStart() {
    if (!passageState || !canShrinkStart || isPending) return;
    if (passageState.startVerse < (maxVerseOfStartChapter ?? 0)) {
      applyRange({ startVerse: passageState.startVerse + 1 });
    } else {
      applyRange({ startChapter: passageState.startChapter + 1, startVerse: 1 });
    }
  }

  function handleShrinkEnd() {
    if (!passageState || !canShrinkEnd || isPending) return;
    if (passageState.endVerse > 1) {
      applyRange({ endVerse: passageState.endVerse - 1 });
    } else {
      applyRange({ endChapter: passageState.endChapter - 1, endVerse: maxVerseOfPrevEndChapter || 1 });
    }
  }

  function handleExtendEnd() {
    if (!passageState || !canExtendEnd || isPending) return;
    if (passageState.endVerse < (maxVerseOfEndChapter ?? 0)) {
      applyRange({ endVerse: passageState.endVerse + 1 });
    } else {
      applyRange({ endChapter: passageState.endChapter + 1, endVerse: 1 });
    }
  }

  async function handleDeletePassage() {
    if (!passageState) return;
    await fetch(`/api/passages/${passageState.id}`, { method: "DELETE" });
    router.push(`/${encodeURIComponent(book)}/${textSource}/${passageState.startChapter}`);
  }

  const passageRangeLabel = passageState ? (() => {
    const { startChapter, startVerse, endChapter, endVerse } = passageState;
    if (passageState.endBook && passageState.endBook !== passageState.book) {
      const endBkName = refBookName(passageState.endBook);
      return `${refBookName(book)} ${startChapter}:${startVerse} – ${endBkName} ${endChapter}:${endVerse}`;
    }
    return startChapter === endChapter
      ? startVerse === endVerse
        ? `${refBookName(book)} ${startChapter}:${startVerse}`
        : `${refBookName(book)} ${startChapter}:${startVerse}–${endVerse}`
      : `${refBookName(book)} ${startChapter}:${startVerse} – ${endChapter}:${endVerse}`;
  })() : "";

  function refStr(ch: number, v: number) { return `${ch}:${v}`; }

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

  // Passage range header — rendered in place of `headingSlot` when isPassageMode.
  const passageHeaderNode = isPassageMode && passageState ? (
    <div className="shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
      {/* Header row: range label + outline export + delete */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-lg font-bold flex-1" style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {passageRangeLabel}
        </span>

        {sceneBreakMap.size > 0 && (
          <button
            type="button"
            onClick={() => setOutlineOpen((v) => !v)}
            className="shrink-0 text-xs px-2 py-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
            style={{ color: outlineOpen ? "var(--accent)" : "var(--text-muted)" }}
            title="Open outline sidebar"
          >
            📋 Outline
          </button>
        )}

        {showDeleteConfirm ? (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Delete?</span>
            <button type="button" onClick={handleDeletePassage}
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
            🗑 Delete passage
          </button>
        )}
      </div>

      {isPending && <p className="text-xs mb-1 opacity-50" style={{ color: "var(--text-muted)" }}>updating…</p>}

      {/* New passage section break prompt */}
      {showNewPassagePrompt && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <span className="text-xs text-stone-600 dark:text-stone-300 shrink-0">Add section heading?</span>
          <span className="text-[10px] text-stone-400 mr-1 shrink-0">Level:</span>
          {([1, 2, 3, 4, 5, 6] as const).map((l) => (
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
          {rangeBtn(!canExtendStart, "← +1v", `Include ${passageState.startChapter === 1 && passageState.startVerse === 1 ? "(already at beginning)" : refStr(passageState.startVerse > 1 ? passageState.startChapter : passageState.startChapter - 1, passageState.startVerse > 1 ? passageState.startVerse - 1 : (maxVerseOfPrevStartChapter || 1))}`, handleExtendStart)}
          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--foreground)" }}>
            {refStr(passageState.startChapter, passageState.startVerse)}
          </span>
          {rangeBtn(!canShrinkStart, "−1v →", `Exclude ${refStr(passageState.startChapter, passageState.startVerse)} (move start forward)`, handleShrinkStart)}
        </div>
        <span style={{ color: "var(--text-muted)" }}>–</span>
        <div className="flex items-center gap-1">
          {rangeBtn(!canShrinkEnd, "← −1v", `Exclude ${refStr(passageState.endChapter, passageState.endVerse)} (move end back)`, handleShrinkEnd)}
          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--foreground)" }}>
            {refStr(passageState.endChapter, passageState.endVerse)}
          </span>
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>End:</span>
          {rangeBtn(!canExtendEnd, "+1v →", `Include ${passageState.endChapter === startBookChapterCount && passageState.endVerse >= (maxVerseOfEndChapter ?? 0) ? "(already at end)" : refStr(passageState.endVerse < (maxVerseOfEndChapter ?? 0) ? passageState.endChapter : passageState.endChapter + 1, passageState.endVerse < (maxVerseOfEndChapter ?? 0) ? passageState.endVerse + 1 : 1)}`, handleExtendEnd)}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative h-full min-h-0 flex flex-row">
      <AddressBar open={addressBarOpen} onClose={() => setAddressBarOpen(false)} textSource={textSource} />
      {/* Main text area — takes remaining width; notes pane sits to the right */}
      <div className="flex-1 min-w-0 relative min-h-0 flex flex-col" ref={outerRef}>
        {/* Scrollable text container — both overlays live INSIDE so they scroll
            with the content and use stable scroll-canvas coordinates. */}
        <div
          data-chapter-scroll-container
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
            lineGroups={lineGroups}
            editingLineGroups={editingLineGroups}
            lineGroupSegA={lineGroupSegA}
            lineGroupSegAGroupId={lineGroupSegAGroupId}
            getLineGroupColor={getBracketColor}
            onSelectLineGroupSegment={handleSelectLineGroupSegment}
            onSelectLineGroupGroup={handleSelectLineGroupGroup}
            onDeleteLineGroup={handleDeleteLineGroup}
            onRequiredLineGroupPad={setLineGroupSourcePad}
            showAutoLineBrackets={showPoetryLineBrackets}
            excludedLineIds={excludedLineIds}
            onToggleLineBracketExclusion={editingPoetryNotation ? handleToggleLineBracketExclusion : undefined}
            poetryRequirednessConnectors={poetryRequirednessConnectors}
            balanceMarks={balanceMarks}
            symmetryMarks={symmetryMarks}
            editingPoetryNotation={editingPoetryNotation}
            activePrinciple={activePrinciple}
            pendingPoetryAnchor={
              activePrinciple === "symmetry" ? symmetryLineA
              : activePrinciple === "balance" ? balanceLineA
              : null
            }
            onSelectPoetryAnchor={(anchorId) => {
              if (activePrinciple === "symmetry") handleSymmetryLineClick(anchorId);
              else if (activePrinciple === "balance") handlePoetryLineClick(anchorId);
            }}
            openPoetryNotationId={editingNotationId}
            onOpenPoetryNotation={setEditingNotationId}
            onDeletePoetryMark={handleDeletePoetryNotation}
            onSavePoetryNote={handleUpdatePoetryNote}
            showPoetryNotes={showPoetryNotes}
            poetryRemeasureKey={panelDisplayMode}
            containerRef={textContainerRef}
            layoutRef={outerRef}
          />
        {/* Chapter heading strip — hidden in presentation mode */}
        {!presentationMode && (passageHeaderNode ?? headingSlot)}

        {/* Sticky control area: toolbar + all editing panels/hints */}
        {!hideToolbar && <div data-chapter-toolbar-area className="sticky top-0 z-20 shrink-0 flex flex-col" style={{ backgroundColor: "var(--background)" }}>

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
                  onSetDatasetDirection={handleSetDatasetDirection}
                  onUploadDataset={(id) => {
                    setUploadDatasetId(id);
                    // Trigger hidden file input
                    setTimeout(() => uploadInputRef.current?.click(), 0);
                  }}
                  minVerse={words.length ? Math.min(...words.map((w) => w.verse)) : 1}
                  maxVerse={words.length ? Math.max(...words.map((w) => w.verse)) : 1}
                  onCopyTransliteration={handleCopyTransliteration}
                  groupingMode={datasetGroupingMode}
                  onToggleNewGrouping={handleToggleNewGrouping}
                  onToggleEditGrouping={handleToggleEditGrouping}
                  pendingGroupCount={pendingGroupWordIds.size}
                  isEditingExistingGroup={editingGroupId != null}
                  groupDraftValue={groupDraftValue}
                  onGroupDraftValueChange={setGroupDraftValue}
                  onSaveGrouping={handleSaveGrouping}
                  onDeleteGrouping={handleDeleteGrouping}
                  labelColor={datasetLabelColors.get(groupDraftValue.trim()) ?? null}
                  onSetLabelColor={(color) => handleSetLabelColor(groupDraftValue.trim(), color)}
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

              <div className="toolbar-spacer h-5 border-l border-[var(--border)]" />

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

              {/* Paragraph edit mode toggle */}
              {toolbarVis.paragraphs && <button
                disabled={editingWordTags}
                onClick={() => { if (!editingParagraphs) deactivateIncompatible("paragraph"); setEditingParagraphs((v) => !v); }}
                data-tip={editingParagraphs
                  ? t("toolbar.titleParagraphOn")
                  : t("toolbar.titleParagraphOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingParagraphs
                    ? "bg-amber-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                ¶
              </button>}

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
                  Show Atnach
                </button>
              )}

              {/* ¶ Atnach insert — Hebrew only */}
              {isHebrew && toolbarVis.atnachInsert && (
                <button
                  onClick={handleAddAtnachParagraphBreaks}
                  data-tip="Insert paragraph breaks at every atnach accent in this chapter"
                  className="px-3 py-1.5 rounded text-[13px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                >
                  ¶ at Atnach
                </button>
              )}

              {/* Syllable/stress count column — Hebrew only. Each paragraph
                  break defines a new poetic line; counts are recomputed live
                  unless the reader has overridden them (see the edit toggle
                  below, which appears once this column is shown). */}
              {isHebrew && toolbarVis.syllableStress && (
                <button
                  onClick={() => {
                    const next = !showSyllableStress;
                    setShowSyllableStress(next);
                    if (!next) setEditingSyllableStress(false);
                  }}
                  data-tip={showSyllableStress
                    ? "Hide stress/syllable counts"
                    : "Show stress and syllable counts per line (stresses/syllables)"}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showSyllableStress
                      ? "bg-violet-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  Stresses/Syllables
                </button>
              )}

              {/* Edit toggle for the stress/syllable counts — only offered once the
                  column above is visible. Changes save immediately as the reader
                  edits each number; turning this off just exits the editing UI. */}
              {isHebrew && toolbarVis.syllableStress && showSyllableStress && (
                <button
                  onClick={() => {
                    if (!editingSyllableStress) deactivateIncompatible("syllableStress");
                    setEditingSyllableStress((v) => !v);
                  }}
                  data-tip={editingSyllableStress
                    ? "Done editing — changes are already saved"
                    : "Edit the stress/syllable counts for each line"}
                  className={[
                    "px-2 py-1.5 rounded text-[13px] font-medium transition-colors",
                    editingSyllableStress
                      ? "bg-violet-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  ✎
                </button>
              )}

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
                disabled={editingWordTags}
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
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
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

              {/* Line group (poetry bracket) mode */}
              {toolbarVis.lineGroups && <button
                disabled={editingWordTags}
                onClick={() => {
                  const entering = !editingLineGroups;
                  if (entering) {
                    deactivateIncompatible("lineGroups");
                  } else {
                    setLineGroupSegA(null);
                    setLineGroupSegAGroupId(null);
                    setShowLineGroupColors(false);
                  }
                  setEditingLineGroups(entering);
                }}
                data-tip={editingLineGroups
                  ? t("toolbar.titleLineGroupsOn")
                  : t("toolbar.titleLineGroupsOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingLineGroups
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                ⌐
              </button>}
              {toolbarVis.lineGroups && editingLineGroups && (
                <button
                  onClick={() => setShowLineGroupColors((v) => !v)}
                  data-tip={t("toolbar.titleLineGroupsColor")}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showLineGroupColors
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                  type="button"
                >
                  🎨
                </button>
              )}

              {/* Line annotation mode */}
              {toolbarVis.annotations && <button
                disabled={editingWordTags}
                onClick={() => {
                  if (!editingAnnotations) { deactivateIncompatible("annotations"); setPanelDisplayMode("annotations"); }
                  else setEditingAnnotationId(null);
                  setEditingAnnotations((v) => !v);
                }}
                data-tip={editingAnnotations
                  ? t("toolbar.titleAnnotationOn")
                  : t("toolbar.titleAnnotationOff")}
                className={[
                  "px-3 py-1.5 rounded text-[20px] leading-none font-medium transition-colors",
                  editingAnnotations
                    ? "bg-indigo-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                ≡
              </button>}

              {/* Poetry notation (Gestalt) mode */}
              {toolbarVis.poetry && <button
                disabled={editingWordTags}
                onClick={() => {
                  const entering = !editingPoetryNotation;
                  if (entering) { deactivateIncompatible("poetry"); setPanelDisplayMode("poetry"); }
                  setEditingPoetryNotation(entering);
                }}
                data-tip="Poetry notation (Gestalt principles)"
                className={[
                  "px-3 py-1.5 rounded text-[13px] leading-none font-medium transition-colors",
                  editingPoetryNotation
                    ? "bg-orange-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                ◈
              </button>}
              {toolbarVis.poetry && editingPoetryNotation && (
                <button
                  type="button"
                  onClick={() => setShowPoetryLineBrackets((v) => !v)}
                  data-tip="Show a bracket for every poetic line (level 1 — real line groups nest outside it)"
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showPoetryLineBrackets
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  ⌐¹
                </button>
              )}
              {!editingPoetryNotation && !editingAnnotations && (lineAnnotations.length > 0 || poetryNotations.length > 0) && (
                <button
                  type="button"
                  onClick={() => setPanelDisplayMode((m) => (m === "annotations" ? "poetry" : "annotations"))}
                  data-tip="Switch the margin panel between clause labels and poetry notation"
                  className="px-2 py-1.5 rounded text-[11px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                >
                  {panelDisplayMode === "annotations" ? "≡→◈" : "◈→≡"}
                </button>
              )}
              {toolbarVis.poetry && (
                <button
                  type="button"
                  onClick={() => setShowPoetryNotes((v) => !v)}
                  data-tip={showPoetryNotes ? "Hide poetry notation notes" : "Show poetry notation notes"}
                  className={[
                    "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                    showPoetryNotes
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  📝
                </button>
              )}
              {toolbarVis.poetry && editingPoetryNotation && (
                <div className="flex items-center gap-1 pl-1 border-l border-stone-300 dark:border-stone-600">
                  {(Object.keys(POETRY_PRINCIPLE_LABELS) as PoetryPrinciple[]).map((p) => (
                    <Fragment key={p}>
                      <button
                        type="button"
                        onClick={() => { setActivePrinciple(p); clearPoetryPending(); }}
                        title={POETRY_PRINCIPLE_LABELS[p]}
                        className={[
                          "px-2 py-1 rounded text-[13px] font-medium leading-none transition-colors",
                          activePrinciple === p ? "text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                        ].join(" ")}
                        style={activePrinciple === p ? { backgroundColor: POETRY_COLORS[p] } : undefined}
                      >
                        {POETRY_PRINCIPLE_GLYPHS[p]}
                      </button>
                      {/* Each principle's subtype buttons render immediately to the
                          right of ITS OWN toggle (not at the end of the whole row),
                          so they land next to whichever toggle is actually active. */}
                      {p === "balance" && activePrinciple === "balance" && (
                        <span className="flex items-center gap-1 pl-1">
                          <button type="button" onClick={() => setActiveBalanceSubtype("balance")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeBalanceSubtype === "balance" ? "bg-sky-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>=</button>
                          <button type="button" onClick={() => setActiveBalanceSubtype("imbalance")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeBalanceSubtype === "imbalance" ? "bg-sky-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>◁▷</button>
                          {activeBalanceSubtype === "imbalance" && (
                            <>
                              <button type="button" onClick={() => setActiveImbalanceDirection("left")}
                                className={`px-1.5 py-1 rounded text-[11px] ${activeImbalanceDirection === "left" ? "bg-sky-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>◁</button>
                              <button type="button" onClick={() => setActiveImbalanceDirection("right")}
                                className={`px-1.5 py-1 rounded text-[11px] ${activeImbalanceDirection === "right" ? "bg-sky-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>▷</button>
                            </>
                          )}
                        </span>
                      )}
                      {p === "requiredness" && activePrinciple === "requiredness" && (
                        <span className="flex items-center gap-1 pl-1">
                          <button type="button" onClick={() => setActiveRequirednessSubtype("arrow")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeRequirednessSubtype === "arrow" ? "bg-gray-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>arrow</button>
                          <button type="button" onClick={() => setActiveRequirednessSubtype("underline")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeRequirednessSubtype === "underline" ? "bg-gray-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>underline</button>
                        </span>
                      )}
                      {p === "closure" && activePrinciple === "closure" && (
                        <span className="flex items-center gap-1 pl-1">
                          <button type="button" onClick={() => setActiveClosureSubtype("weak")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeClosureSubtype === "weak" ? "bg-purple-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>weak</button>
                          <button type="button" onClick={() => setActiveClosureSubtype("complete")}
                            className={`px-1.5 py-1 rounded text-[11px] ${activeClosureSubtype === "complete" ? "bg-purple-500 text-white" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"}`}>complete</button>
                        </span>
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
              {editingPoetryNotation && addingToSimilarityGroupId !== null && (
                <button
                  type="button"
                  onClick={handleCancelAddWordToGroup}
                  className="px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 ring-1 ring-sky-400 animate-pulse"
                >
                  Click a word to add to the group · Cancel
                </button>
              )}

              {/* Word arrow mode */}
              {toolbarVis.arrows && <button
                disabled={editingWordTags}
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
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
                  <path d="M2,3 C2,9 18,9 18,3" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="2"  cy="3" r="2" fill="currentColor" />
                  <circle cx="18" cy="3" r="2" fill="currentColor" />
                </svg>
              </button>}

              <div className="toolbar-spacer h-5 border-l border-[var(--border)]" />

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

              {/* Underline formatting mode */}
              {toolbarVis.underline && <button
                disabled={editingWordTags}
                onClick={() => {
                  if (!editingUnderline) deactivateIncompatible("underline");
                  setEditingUnderline((v) => !v);
                }}
                data-tip={editingWordTags ? "Not available in Word/Concept mode" : editingUnderline ? "Exit underline mode" : "Click words to toggle underline"}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-bold underline transition-colors",
                  editingUnderline
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                U
              </button>}

              {/* Text color formatting mode */}
              {toolbarVis.textColor && <button
                disabled={editingWordTags}
                onClick={() => {
                  if (!editingTextColor) deactivateIncompatible("textColor");
                  setEditingTextColor((v) => !v);
                }}
                data-tip={editingWordTags ? t("toolbar.titleTextColorDisabled") : editingTextColor ? t("toolbar.titleTextColorOn") : t("toolbar.titleTextColorOff")}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-bold transition-colors",
                  editingTextColor
                    ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
                style={{ color: editingTextColor ? undefined : activeTextColor }}
              >
                A
              </button>}
              {toolbarVis.textColor && editingTextColor && (
                <div className="flex flex-wrap items-center gap-1" style={{ maxWidth: "9rem" }} data-tip={t("toolbar.titleTextColorPicker")}>
                  {TAG_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => updateActiveTextColor(c)}
                      title={c}
                      className="w-4 h-4 rounded-full transition-transform hover:scale-110 shrink-0"
                      style={{
                        backgroundColor: c,
                        outline: activeTextColor === c ? `2px solid ${c}` : "1px solid var(--border)",
                        outlineOffset: "1px",
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Text Critical markup mode */}
              {toolbarVis.tc && (
                <>
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
                </>
              )}

              {/* Character reference tag mode */}
              {toolbarVis.refs && <button
                disabled={editingWordTags}
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
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
                ].join(" ")}
              >
                👤
              </button>}

              {/* Speech section tag mode */}
              {toolbarVis.speech && <button
                disabled={editingWordTags}
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
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-800",
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

              {/* Synoptic word-level comparison marking */}
              {toolbarVis.wordCompare && <button
                onClick={() => {
                  if (!editingWordCompare) deactivateIncompatible("wordCompare");
                  setEditingWordCompare((v) => !v);
                }}
                data-tip={editingWordCompare ? "Turn off Compare mode" : "Compare: mark word-level differences"}
                className={[
                  "px-3 py-1.5 rounded text-[13px] font-medium transition-colors",
                  editingWordCompare
                    ? "bg-emerald-600 text-white"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                ].join(" ")}
              >
                🆚
              </button>}

              <div className="toolbar-spacer h-5 border-l border-[var(--border)]" />

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

              <div className="toolbar-spacer h-5 border-l border-[var(--border)]" />

              {/* Notes panel toggle */}
              {toolbarVis.notes && !disableSidePanels && <button
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
              {toolbarVis.search && !disableSidePanels && <button
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
              {toolbarVis.bible && !disableSidePanels && <button
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
              {toolbarVis.intertextual && !disableSidePanels && <button
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

              <div className="toolbar-spacer h-5 border-l border-[var(--border)]" />

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
                      onClick={copyTranslationText}
                      data-tip={copiedTranslation ? "Copied!" : "Copy translation text"}
                      className="px-3 py-2 rounded text-[15px] font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                    >
                      {copiedTranslation ? "✓" : "⎘"}
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
                          const activeBook = anchor?.el.dataset.book || book;
                          const activeChapter = anchor ? (parseInt(anchor.el.dataset.chapter ?? "") || chapter) : chapter;
                          const activeAbbr = anchor?.el.dataset.abbr ?? "";
                          const firstAbbr = activeAbbr || ([...activeTranslationIds]
                            .map((id) => allAvailableTranslations.find((tr) => tr.id === id))
                            .find((tr) => tr)?.abbreviation ?? "");
                          setFnEditId(null);
                          setFnDialogAbbr(firstAbbr);
                          setFnDialogBook(activeBook);
                          setFnDialogChapter(activeChapter);
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
                defaultVisibility={defaultToolbarVisibility}
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
            currentBook={book}
            currentChapter={chapter}
            currentPassages={currentPassages}
            bookGroupings={bookGroupings}
            clusterPickingActive={clusterLemmaCallback !== null}
            onSelectCharacter={setActiveCharId}
            onCreateCharacter={handleCreateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onUpdateCharacter={handleUpdateCharacter}
            onReorder={handleReorderCharacters}
            highlightedCharIds={highlightCharIds}
            onToggleHighlight={handleToggleHighlight}
            onCreateGrouping={handleCreateBookGrouping}
            onRequestWordClick={handleRequestWordClick}
            onCancelWordClick={handleCancelWordClick}
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
            currentBook={book}
            currentChapter={chapter}
            currentPassages={currentPassages}
            bookGroupings={bookGroupings}
            clusterPickingActive={clusterLemmaCallback !== null}
            onSelectTag={(id) => { setActiveWordTagId(id); }}
            onCreateConceptTag={handleCreateConceptTag}
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

        {/* Synoptic word-compare category bar */}
        {editingWordCompare && (
          <div
            className="flex items-center gap-2 px-6 py-1.5 border-b flex-wrap"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>Compare:</span>
            <div className="flex flex-wrap gap-1">
              {synopticCategories.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setWordCompareCategoryKey(cat.key)}
                  className="px-2 py-0.5 rounded text-[11px] text-white font-semibold transition-opacity"
                  style={{ backgroundColor: cat.color, opacity: wordCompareCategoryKey === cat.key ? 1 : 0.4 }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowSynopticCategoryManager(true)}
              className="text-[10px] ml-auto text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              Manage categories
            </button>
          </div>
        )}
        {editingWordCompare && wordCompareRangeStart && (
          <div className="px-6 py-1 text-xs bg-emerald-50 dark:bg-emerald-950 border-b border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
            Click the end word to complete the range (or the same word for a single-word mark).
          </div>
        )}
        {showSynopticCategoryManager && (
          <SynopticCategoryManager onClose={() => setShowSynopticCategoryManager(false)} />
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

        {/* Line group hint */}
        {editingLineGroups && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {lineGroupSegA
              ? t("toolbar.hintLineGroupsA")
              : t("toolbar.hintLineGroupsStart")}
          </div>
        )}

        {/* Line group color-by-level panel */}
        {editingLineGroups && showLineGroupColors && (
          <LineGroupColorPanel
            levelCount={Math.min(MAX_CONFIGURABLE_LEVELS, Math.max(3, getMaxNestingLevel(lineGroupTree)))}
            getColor={getBracketColor}
            onChange={setBracketColorForLevel}
            onClose={() => setShowLineGroupColors(false)}
          />
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
          onMouseDown={(e) => {
            // Shift-click drives every range-selection affordance in this view
            // (character refs, word tags, poetry marks, translation compare, …).
            // Without this, the browser's native "shift-click extends text
            // selection" behavior fires at the same time, visibly highlighting
            // a swath of page text alongside the intended app-level selection.
            // Exempt real text-entry fields so shift-click still extends the
            // caret selection there as normal.
            if (e.shiftKey && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) {
              e.preventDefault();
            }
          }}
          style={{
            // Synoptic View's narrow columns need every bit of width for
            // text, so its verse-number gutter sits much closer to the edge.
            paddingLeft:  compactVerseLabels ? "0.5rem" : "1.5rem",
            paddingRight: compactVerseLabels ? "0.5rem" : "1.5rem",
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
          {orderedVerses.map((verse, idx) => {
            const verseNum = verse.v;
            const isFirstOfChapter = idx === 0 ||
              orderedVerses[idx - 1].ch !== verse.ch ||
              orderedVerses[idx - 1].bookId !== verse.bookId;
            const prevWords = orderedVerses[idx - 1]?.words ?? [];
            const nextWords = orderedVerses[idx + 1]?.words ?? [];
            return (
              <div key={`${verse.bookId}:${verse.ch}:${verse.v}`} data-passage-verse-key={`${verse.bookId}:${verse.ch}:${verse.v}`}>
                {/* Chapter heading — only shown when `words` spans more than one chapter */}
                {isMultiChapter && isFirstOfChapter && !presentationMode && (
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
                key={verseNum}
                verseNum={verseNum}
                isFirstVerseOfPassage={idx === 0}
                words={verse.words}
                displayMode={displayMode}
                grammarFilter={grammarFilter}
                colorRules={colorRules}
                onSelectWord={handleSelectWord}
                selectedWordId={selectedWord?.wordId ?? null}
                isHebrew={isHebrew}
                showTooltips={showTooltips}
                translationTexts={editingTranslationVerseMap.get(`${chapterKey(verse.bookId, verse.ch)}:${verse.v}`) ?? []}
                hasActiveTranslations={hasActiveTranslations}
                translationVerseOffset={translationVerseOffset}
                translationVerseLabelFn={translationVerseLabelFn}
                useLinguisticTerms={useLinguisticTerms}
                paragraphBreakIds={paragraphBreakIds}
                editingParagraphs={editingParagraphs}
                showAtnachBreaks={showAtnachBreaks}
                showSyllableStress={showSyllableStress}
                syllableStressOverrideMap={syllableStressOverrideMap}
                editingSyllableStress={editingSyllableStress}
                onSetSyllableStressOverride={handleSetSyllableStressOverride}
                onResetSyllableStressOverride={handleResetSyllableStressOverride}
                showVowels={showVowels}
                showCantillation={showCantillation}
                characterRefMap={characterRefMap}
                characterMap={characterMap}
                wordSpeechMap={wordSpeechMap}
                synopticWordMarkColorMap={synopticWordMarkColorMap}
                editingWordCompare={editingWordCompare}
                wordCompareRangeStartWordId={wordCompareRangeStart}
                compactVerseLabels={compactVerseLabels}
                prevVerseLastWordId={prevWords[prevWords.length - 1]?.wordId ?? null}
                nextVerseFirstWordId={nextWords[0]?.wordId ?? null}
                editingRefs={editingRefs}
                editingSpeech={editingSpeech}
                activeCharId={activeCharId}
                speechRangeStartWordId={speechRangeStart?.wordId ?? null}
                tagRangeStartWordId={refRangeStart ?? wordTagRangeStart}
                book={verse.book}
                chapter={verse.ch}
                onSelectTranslationWord={handleSelectTranslationWord}
                onToggleTranslationParagraphBreak={handleToggleTranslationParagraphBreak}
                highlightCharIds={highlightCharIds}
                onDeleteSpeechSection={handleDeleteSpeechSection}
                onReassignSpeechSection={handleReassignSpeechSection}
                wordTagRefMap={wordTagRefMap}
                wordTagMap={wordTagMap}
                passageBoundsById={passageBoundsById}
                editingWordTags={editingWordTags}
                clusterPickingActive={clusterLemmaCallback !== null}
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
                editingFormatting={editingLetterFormatting}
                editingBold={editingBold}
                editingItalic={editingItalic}
                editingUnderline={editingUnderline}
                editingTextColor={editingTextColor}
                letterFormatAnchor={letterFormatAnchor}
                onFormattingGraphemeClick={handleFormattingGraphemeClick}
                interlinearSubMode={interlinearSubMode}
                constituentLabelMap={constituentLabelMap}
                constituentGroupMap={constituentGroupMap}
                datasetEntryMap={datasetEntryMap}
                datasetDirection={activeDatasetDirection}
                transliterationFormatMap={transliterationFormatMap}
                onSaveConstituentLabel={handleSaveConstituentLabel}
                onSaveDatasetEntry={handleSaveDatasetEntry}
                onSaveTransliterationFormat={handleSaveTransliterationFormat}
                onLemmaClick={displayMode === "interlinear" && interlinearSubMode === "lemma" ? handleLemmaClick : undefined}
                datasetGroupMap={datasetGroupMap}
                datasetLabelColors={datasetLabelColors}
                datasetGroupingActive={groupingContextKey !== "none" && datasetGroupingMode !== "off"}
                pendingGroupWordIds={pendingGroupWordIds}
                onToggleDatasetGroupMember={handleToggleDatasetGroupMember}
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
                editingAnnotationId={editingAnnotationId}
                onSetEditingAnnotationId={setEditingAnnotationId}
                onSelectAnnotationSegment={handleSelectAnnotationSegment}
                onSaveAnnotation={handleSaveAnnotation}
                onCancelAnnotation={handleCancelAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onExpandAnnotationRange={handleExpandAnnotationRange}
                showAnnotationCol={panelDisplayMode === "annotations" && (editingAnnotations || lineAnnotations.length > 0)}
                showPoetryCol={panelDisplayMode === "poetry" && (editingPoetryNotation || balanceMarks.length > 0 || symmetryMarks.length > 0)}
                editingPoetryNotation={editingPoetryNotation}
                closureRangeStart={closureRangeStart}
                requirednessRangeStart={requirednessRangeStart}
                requirednessResolvingStart={requirednessResolvingStart}
                onSelectPoetryWord={handlePoetryWordSelectByIds}
                poetryWordMarkMap={poetryWordMarkMap}
                poetryRequirednessUnderlineSet={poetryRequirednessUnderlineSet}
                poetryRequirednessUnderlineRangesByAbbr={poetryRequirednessUnderlineRangesByAbbr}
                poetryClosureWeakSet={poetryClosureWeakSet}
                poetryClosureWeakRangesByAbbr={poetryClosureWeakRangesByAbbr}
                poetryClosureCompleteSet={poetryClosureCompleteSet}
                poetryClosureCompleteStartIds={poetryClosureCompleteStartIds}
                similarityMarkByWord={similarityMarkByWord}
                showPoetryNotes={showPoetryNotes}
                poetryNoteMap={poetryNoteMap}
                editingPoetrySimilarity={editingPoetryNotation && activePrinciple === "similarity"}
                pendingSimilarityAnchor={pendingSimilarityAnchor}
                onGraphemeClick={handleGraphemeClick}
                onClickSimilarityMark={(markId) => setEditingNotationId(markId)}
                openPoetryNoteMarkByWord={openPoetryNoteMarkByWord}
                openPoetryNoteGroupMembersByWord={openPoetryNoteGroupMembersByWord}
                openPoetryNoteHasMissingArrowByWord={openPoetryNoteHasMissingArrowByWord}
                onSavePoetryNote={handleUpdatePoetryNote}
                onDeletePoetryMark={handleDeletePoetryNotation}
                onClosePoetryNote={() => setEditingNotationId(null)}
                onSelectRequirednessResolving={handleStartRequirednessResolving}
                onAddWordToSimilarityGroup={handleStartAddWordToGroup}
                onSaveSimilarityGroup={handleSaveSimilarityGroup}
                onDeleteSimilarityWord={handleDeleteSimilarityWord}
                onRestoreSimilarityArrows={handleRestoreSimilarityArrows}
                tcMarkMap={tcMarkMap}
                editingTc={editingTc}
                onTcMarkWord={handleTcMarkLxxWord}
                onVerseClick={(v) => {
                  setNotesOpen(true);
                  setNotesScrollVerse({ ch: verse.ch, v });
                }}
                rstSourcePad={Math.max(rstSourcePad, lineGroupSourcePad)}
                lineSpacingMap={lineSpacingMap}
                presentationMode={presentationMode}
                translationFootnotes={
                  showFootnotes
                    ? Object.entries(localFootnotes).flatMap(([tid, fns]) =>
                        fns.filter((fn) => fn.book === verse.book && fn.chapter === verse.ch && fn.verse === verseNum && activeTranslationIds.has(Number(tid)))
                      )
                    : []
                }
                onDeleteFootnote={(translationId, fnId) => handleDeleteFootnote(translationId, fnId)}
                onEditFootnote={(fn) => openEditFootnote(fn)}
                editingFootnotes={editingFootnotes}
                anchorMoveFootnote={(() => {
                  if (fnAnchorMoveId === null) return undefined;
                  const fn = Object.values(localFootnotes).flat().find((f) => f.id === fnAnchorMoveId);
                  if (!fn || fn.book !== verse.book || fn.chapter !== verse.ch || fn.verse !== verseNum) return undefined;
                  const tr = allAvailableTranslations.find((t) => t.id === fn.translationId);
                  if (!tr) return undefined;
                  return { id: fn.id, translationId: fn.translationId, verse: fn.verse, abbr: tr.abbreviation };
                })()}
                onMoveFootnoteAnchor={(fnId, wordIndex) => handleMoveFootnoteAnchor(fnId, wordIndex)}
              />
              </div>
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
      {notesOpen && !disableSidePanels && (
        <ResizablePane storageKey="pane-notes-width" defaultWidth={320} minWidth={200} maxWidth={700}>
          <PassageNotesPane
            passageId={passageState?.id}
            passageLabel={passageState ? (passageState.label?.trim() || passageRangeLabel) : undefined}
            book={book}
            bookName={refBookName(book)}
            orderedVerses={notesOrderedVerses}
            isMultiChapter={isMultiChapter}
            isWholeChapter={isWholeChapter}
            wholeChapterNum={wholeChapterNum}
            scrollToVerse={notesScrollVerse}
            onScrollHandled={() => setNotesScrollVerse(null)}
            onClose={() => setNotesOpen(false)}
            synced={notesSynced}
            onSyncToggle={toggleNotesSync}
          />
        </ResizablePane>
      )}

      {/* Search pane */}
      {searchOpen && !disableSidePanels && (
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
      {bibleOpen && !disableSidePanels && (
        <ResizablePane storageKey="pane-bible-width" defaultWidth={320} minWidth={240} maxWidth={600}>
          <BibleLookupPane onClose={() => setBibleOpen(false)} />
        </ResizablePane>
      )}

      {/* Passage preview pane — opened from a scripture citation clicked inside a lexicon entry */}
      {previewOpen && previewRequest && (
        <ResizablePane storageKey="pane-passage-preview-width" defaultWidth={340} minWidth={260} maxWidth={700}>
          <PassagePreviewPane
            key={previewRequest.nonce}
            osisRef={previewRequest.osisRef}
            lexiconSource={previewRequest.lexiconSource}
            useLinguisticTerms={useLinguisticTerms}
            onClose={() => setPreviewOpen(false)}
          />
        </ResizablePane>
      )}

      {/* Intertextual links pane */}
      {intertextualOpen && !disableSidePanels && (
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
            chapter={isMultiChapter ? -1 : chapter}
            textSource={textSource}
            sceneBreakMap={isMultiChapter ? EMPTY_SCENE_BREAK_MAP : sceneBreakMap}
            bookSceneBreaks={isMultiChapter ? outlineBreaksForPane : bookSceneBreaks}
            wordPositionMap={wordPositionMap}
            sectionRanges={outlineExtended ? extendedSectionRanges : sectionRanges}
            onUpdateCurrentHeading={handleUpdateSceneHeading}
            onDeleteCurrentBreak={handleDeleteCurrentBreak}
            onChangeCurrentLevel={handleChangeSceneBreakLevel}
            onClose={() => setOutlineOpen(false)}
            outlineExtended={outlineExtended}
            onToggleExtended={setOutlineExtended}
            continuationBook={continuationBook}
            continuationBookName={continuationBookName}
            continuationBreaks={contBreaks}
            crossBookRangeKeys={crossBookRangeKeys}
            loadingContinuation={loadingCont}
            passageChapters={isMultiChapter ? coveredChapterSet : undefined}
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
      {panelOpen && !disableSidePanels && (
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
                <MorphologyPanel word={selectedWord} useLinguisticTerms={useLinguisticTerms} onSearchRequest={handleSearchFromWord} onScriptureRefClick={handleScriptureRefClick} />
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
