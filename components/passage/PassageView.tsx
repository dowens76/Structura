"use client";

import { useState, useTransition, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Passage, Word,
  Character, CharacterRef, SpeechSection, WordTag, WordTagRef,
  Translation, TranslationVerse, RstRelation, WordArrow, LineAnnotation,
} from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry, InterlinearSubMode } from "@/lib/morphology/types";
import type { ColorRule } from "@/lib/morphology/colorRules";
import VerseDisplay from "@/components/text/VerseDisplay";
import MorphologyPanel from "@/components/text/MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import InterlinearSubModePicker from "@/components/controls/InterlinearSubModePicker";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel from "@/components/controls/WordTagPanel";
import ChapterOverlays from "@/components/text/ChapterOverlays";
import ClearAnnotationsDialog, { type ClearCategory } from "@/components/controls/ClearAnnotationsDialog";
import PassageNotesPane from "@/components/notes/PassageNotesPane";
import FindBar from "@/components/text/FindBar";
import ResizablePane from "@/components/ResizablePane";
import OutlinePane from "@/components/text/OutlinePane";
import SearchPane from "@/components/search/SearchPane";
import BibleLookupPane from "@/components/bible/BibleLookupPane";
import RstTypeManager from "@/components/controls/RstTypeManager";
import ToolbarCustomizer, { DEFAULT_TOOLBAR_VIS, type ToolbarVisibility } from "@/components/controls/ToolbarCustomizer";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";
import type { RstTypeEntry } from "@/lib/morphology/clauseRelationships";
import type { RstCustomType, TranslationFootnote } from "@/lib/db/schema";
import { useWordArrows } from "@/lib/hooks/useWordArrows";
import { useAnnotationRange } from "@/lib/hooks/useAnnotationRange";
import { useRstRelations } from "@/lib/hooks/useRstRelations";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";
import { computeSectionRanges } from "@/lib/utils/sectionRanges";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";
import { useTranslation } from "@/lib/i18n/LocaleContext";

/** Normalize text for diacritic-insensitive find-in-page matching. */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/\//g, "")
    .toLowerCase();
}

/** Returns true if the word's surface text is entirely punctuation and should
 *  be skipped during character / word-tag selection. */
function isPunctuationWord(word: Word): boolean {
  const text = (word.surfaceText ?? "").replace(/\//g, "").trim();
  return text.length > 0 && /^["""''\u2018\u2019\u201C\u201D.,:;?·\u00B7\u05C3\u05BE\u05C0]+$/.test(text);
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
  // ULT (built-in) translation — base text from ult.db, edits in user.db
  ultBaseVerses?: { chapter: number; verse: number; text: string }[];
  ultTranslation?: Translation | null;
  // VCB (built-in Vietnamese) translation
  vcbBaseVerses?: { chapter: number; verse: number; text: string }[];
  vcbTranslation?: Translation | null;
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
  // Translation footnotes (keyed by translation ID)
  initialTranslationFootnotes?: Record<number, TranslationFootnote[]>;
  // Workspace translation-only mode — hides source text by default
  translationOnly?: boolean;
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
  ultBaseVerses = [],
  ultTranslation = null,
  vcbBaseVerses = [],
  vcbTranslation = null,
  initialRstRelations,
  initialWordArrows,
  initialWordFormatting,
  initialSceneBreaks,
  initialLineAnnotations,
  bookSceneBreaks,
  bookMaxVerses,
  initialTranslationFootnotes = {},
  translationOnly = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { t } = useTranslation();

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
  const [interlinearSubMode, setInterlinearSubMode] = useState<InterlinearSubMode>("lemma");
  const [constituentLabelMap, setConstituentLabelMap] = useState<Map<string, string>>(new Map());
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([]);
  const [datasetEntryMap, setDatasetEntryMap] = useState<Map<string, string>>(new Map());
  const [uploadDatasetId, setUploadDatasetId] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const [searchRequest, setSearchRequest] = useState<{ query: string; source: string; nonce: number } | null>(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [notesScrollVerse, setNotesScrollVerse] = useState<{ ch: number; v: number } | null>(null);
  const [showTooltips, setShowTooltips] = useState(false);
  const [showAtnachBreaks, setShowAtnachBreaks] = useState(false);
  const [activeTranslationAbbrs, setActiveTranslationAbbrs] = useState<Set<string>>(new Set());
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [useLinguisticTerms, setUseLinguisticTerms] = useState(false);
  const [hebrewFontSize, setHebrewFontSize] = useState(1.375);
  const [greekFontSize, setGreekFontSize] = useState(1.25);
  const [translationFontSize, setTranslationFontSize] = useState(0.875);
  // Find-in-page
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findFocusIdx, setFindFocusIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  // Toolbar customizer
  const [toolbarVis, setToolbarVis] = useState<ToolbarVisibility>(DEFAULT_TOOLBAR_VIS);
  const [showToolbarCustomizer, setShowToolbarCustomizer] = useState(false);
  const [tbTooltip, setTbTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const gearBtnRef = useRef<HTMLButtonElement>(null);
  // Translation footnotes
  const [localFootnotes, setLocalFootnotes] = useState<Record<number, TranslationFootnote[]>>(initialTranslationFootnotes);
  const [fnDialogOpen, setFnDialogOpen] = useState(false);
  const [fnDialogVerse, setFnDialogVerse] = useState(1);
  const [fnDialogAbbr, setFnDialogAbbr] = useState("");
  const [fnDialogType, setFnDialogType] = useState<"f" | "x">("f");
  const [fnDialogContent, setFnDialogContent] = useState("");
  const [fnEditId, setFnEditId] = useState<number | null>(null);
  const [showFootnotes, setShowFootnotes] = useState(true);
  // Version history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAbbr, setHistoryAbbr] = useState("");
  const [historyVerse, setHistoryVerse] = useState(1);
  const [historyVersions, setHistoryVersions] = useState<Array<{ id: number; text: string; createdAt: string; label: string | null }>>([]);
  // Translation source editing (USFM mode)
  const [editingTranslationSource, setEditingTranslationSource] = useState(false);
  const [hideSourceText, setHideSourceText] = useState(false);

  // Persist sticky settings
  useEffect(() => { writeLocal("structura:displayMode", displayMode); }, [displayMode]);
  useEffect(() => { writeLocal("structura:interlinearSubMode", interlinearSubMode); }, [interlinearSubMode]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);
  useEffect(() => { writeLocal("structura:toolbarVisibility", toolbarVis); }, [toolbarVis]);

  useEffect(() => {
    fetch("/api/book-groupings")
      .then((r) => r.json())
      .then((d: { groupings?: import("@/lib/db/schema").BookGrouping[] }) => setBookGroupings(d.groupings ?? []))
      .catch(() => {});
  }, []);

  // Load datasets list on mount
  useEffect(() => {
    fetch("/api/interlinear/datasets?workspaceId=1")
      .then((r) => r.json())
      .then((rows: { id: number; name: string }[]) => setDatasets(rows))
      .catch(() => {});
  }, []);

  // Load constituent labels when in constituent sub-mode
  useEffect(() => {
    if (displayMode !== "interlinear" || interlinearSubMode !== "constituent") return;
    const chapterEntries = [...new Set(words.map((w) => `${w.chapter}`))];
    Promise.all(chapterEntries.map((ch) =>
      fetch(`/api/interlinear/constituent-labels?workspaceId=1&book=${encodeURIComponent(osisBook)}&chapter=${ch}&textSource=${encodeURIComponent(textSource)}`)
        .then((r) => r.json())
        .then((rows: { wordId: string; label: string }[]) => rows)
    ))
      .then((all) => setConstituentLabelMap(new Map(all.flat().map((r) => [r.wordId, r.label]))))
      .catch(() => {});
  }, [displayMode, interlinearSubMode, osisBook, textSource, words]);

  // Load dataset entries when in dataset sub-mode
  useEffect(() => {
    if (displayMode !== "interlinear") return;
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    const chapterEntries = [...new Set(words.map((w) => `${w.chapter}`))];
    Promise.all(chapterEntries.map((ch) =>
      fetch(`/api/interlinear/datasets/${dsId}/entries?book=${encodeURIComponent(osisBook)}&chapter=${ch}&textSource=${encodeURIComponent(textSource)}`)
        .then((r) => r.json())
        .then((rows: { wordId: string; value: string }[]) => rows)
    ))
      .then((all) => setDatasetEntryMap(new Map(all.flat().map((r) => [r.wordId, r.value]))))
      .catch(() => {});
  }, [displayMode, interlinearSubMode, osisBook, textSource, words]);

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
    setHideSourceText(readLocal<boolean>("structura:hideSourceText", translationOnly));
    setToolbarVis({ ...DEFAULT_TOOLBAR_VIS, ...readLocal<Partial<ToolbarVisibility>>("structura:toolbarVisibility", {}) });
  }, []);

  // ── Editing mode toggles ──────────────────────────────────────────────────
  const [editingParagraphs, setEditingParagraphs] = useState(false);
  const [paragraphBreakIds, setParagraphBreakIds] = useState<Set<string>>(
    () => new Set(initialParagraphBreakIds)
  );

  // ── Character tagging state ───────────────────────────────────────────────
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
  const [pendingWordTagCorpusGroupingId, setPendingWordTagCorpusGroupingId] = useState<number | null>(null);
  const [clusterLemmaCallback, setClusterLemmaCallback] = useState<((lemma: string) => void) | null>(null);
  const [bookGroupings, setBookGroupings] = useState<import("@/lib/db/schema").BookGrouping[]>([]);

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

  // ── RST relations (hook) ──────────────────────────────────────────────────
  // getChapterForWord resolves a wordId → chapter number, handling both regular
  // word IDs (via wordToChapter map) and tv: token IDs (parsed from the ID).
  // wordToChapter is declared further below (line ~385); since this hook is called
  // here (before that useMemo), we use a ref pattern so the callbacks always see
  // the latest map without requiring a reorder of calls.
  const wordToChapterRef = useRef<Map<string, number>>(new Map());
  function getChapterForWord(wordId: string): number {
    let ch = wordToChapterRef.current.get(wordId);
    if (ch === undefined && wordId.startsWith("tv:")) {
      const dotParts = wordId.split(":")[2]?.split(".");
      const parsed = dotParts ? parseInt(dotParts[1]) : NaN;
      ch = isNaN(parsed) ? passage.startChapter : parsed;
    }
    return ch ?? passage.startChapter;
  }

  const {
    rstRelations, setRstRelations,
    // tvRstRelations / linked-mode not used (supportsLinkedTrees = false)
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
    book: osisBook,
    textSource,
    getChapterForWord,
    supportsLinkedTrees: false,
  });

  // Custom RST label types (local to PassageView — not part of hook)
  const [customRstTypes, setCustomRstTypes]   = useState<RstCustomType[]>([]);
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
    book: osisBook,
    textSource,
    getChapterForWord,
  });

  const [showClearDialog, setShowClearDialog] = useState(false);

  // ── Line annotation hook is called below, after paragraphFirstWordIds ─────

  // ── Section break state ──────────────────────────────────────────────────────
  const [sceneBreakMap, setSceneBreakMap] = useState<Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null }>>>(
    () => {
      const m = new Map<string, Array<{ heading: string | null; level: number; verse: number; outOfSequence: boolean; extendedThrough: number | null; thematic: boolean; thematicLetter: string | null }>>();
      for (const sb of initialSceneBreaks) {
        const arr = m.get(sb.wordId) ?? [];
        arr.push({ heading: sb.heading, level: sb.level, verse: sb.verse, outOfSequence: sb.outOfSequence, extendedThrough: sb.extendedThrough, thematic: false, thematicLetter: null });
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

  // ── Line annotation hook — called below after paragraphFirstWordIds useMemo ─

  // ── RST source-pad: dynamically sized so group chips never overlap verse labels ──
  const [rstSourcePad, setRstSourcePad] = useState(0);

  // ── Word formatting (bold / italic) state ──────────────────────────────────
  const [wordFormattingMap, setWordFormattingMap] = useState<Map<string, { isBold: boolean; isItalic: boolean }>>(
    () => new Map(initialWordFormatting.map((f) => [f.wordId, { isBold: f.isBold, isItalic: f.isItalic }]))
  );
  const [editingBold, setEditingBold]     = useState(false);
  const [editingItalic, setEditingItalic] = useState(false);

  // ── Translation editing state ──────────────────────────────────────────────
  // Merge ULT and VCB base verses; user edits take precedence.
  // Verses are keyed by "chapter:verse" since passages span multiple chapters.
  const initialTranslationVerseData = useMemo(() => {
    let data = translationVerseData;

    if (ultTranslation && ultBaseVerses.length > 0) {
      const ultId = ultTranslation.id;
      const editedMap = new Map(
        (data[ultId] ?? []).map((v) => [`${v.chapter}:${v.verse}`, v])
      );
      const merged: TranslationVerse[] = ultBaseVerses.map((base, i) => {
        return editedMap.get(`${base.chapter}:${base.verse}`) ?? {
          id: -(i + 1),
          workspaceId: ultTranslation.workspaceId,
          translationId: ultId,
          osisRef: `${osisBook}.${base.chapter}.${base.verse}`,
          bookId: 0,
          chapter: base.chapter,
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
        return editedMap.get(`${base.chapter}:${base.verse}`) ?? {
          id: -(i + 1),
          workspaceId: vcbTranslation.workspaceId,
          translationId: vcbId,
          osisRef: `${osisBook}.${base.chapter}.${base.verse}`,
          bookId: 0,
          chapter: base.chapter,
          verse: base.verse,
          text: base.text,
        };
      });
      data = { ...data, [vcbId]: merged };
    }

    return data;
  // Only recalculate on passage identity / translation change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage.id, ultTranslation?.id, vcbTranslation?.id]);

  const [editingTranslation, setEditingTranslation] = useState(false);
  const [localTranslationVerseData, setLocalTranslationVerseData] = useState(initialTranslationVerseData);
  // Snapshot taken when translation editing mode is entered, used for Cancel
  const translationEditSnapshotRef = useRef(initialTranslationVerseData);

  // Merge ULT + VCB into the available translations list and track which are "built-in"
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
    return list;
  }, [availableTranslations, ultTranslation, ultBaseVerses.length, vcbTranslation, vcbBaseVerses.length, translationOnly]);

  const systemTranslationIds = useMemo(
    () => new Set([
      ...(ultTranslation ? [ultTranslation.id] : []),
      ...(vcbTranslation ? [vcbTranslation.id] : []),
    ]),
    [ultTranslation, vcbTranslation]
  );

  // ── Overlay ref ────────────────────────────────────────────────────────────
  const overlayContainerRef = useRef<HTMLDivElement>(null);

  // Snapshot translation data when editing mode is entered so Cancel can revert to it
  useEffect(() => {
    if (editingTranslation) {
      translationEditSnapshotRef.current = localTranslationVerseData;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTranslation]);

  // ── Undo stack ────────────────────────────────────────────────────────────
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

  // Refs for the static keydown listener to read current find state without stale closures
  const findOpenRef = useRef(false);
  const findHitIdsRef = useRef<string[]>([]);
  const findFocusIdRef = useRef<string | null>(null);
  // tagFocusedFindWord is assigned each render with fresh state closures
  const tagFocusedFindWordRef = useRef<() => void>(() => {});
  const editingRefsRef = useRef(false);
  const editingWordTagsRef = useRef(false);

  useEffect(() => { findOpenRef.current = findOpen; }, [findOpen]);
  useEffect(() => { editingRefsRef.current = editingRefs; }, [editingRefs]);
  useEffect(() => { editingWordTagsRef.current = editingWordTags; }, [editingWordTags]);

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
        return;
      }
      // Ctrl/Cmd+F — open find bar
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.select(), 0);
        return;
      }
      // Ctrl/Cmd+G — next hit; Ctrl/Cmd+Shift+G — previous hit
      if ((e.metaKey || e.ctrlKey) && e.key === "g") {
        if (!findOpenRef.current || findHitIdsRef.current.length === 0) return;
        e.preventDefault();
        if (e.shiftKey) {
          setFindFocusIdx((i) => (i - 1 + findHitIdsRef.current.length) % findHitIdsRef.current.length);
        } else {
          setFindFocusIdx((i) => (i + 1) % findHitIdsRef.current.length);
        }
        return;
      }
      // Ctrl/Cmd+E — tag focused find word with active annotation tool
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        if (!findOpenRef.current || !findFocusIdRef.current) return;
        if (!editingRefsRef.current && !editingWordTagsRef.current) return;
        e.preventDefault();
        tagFocusedFindWordRef.current();
        return;
      }
      // Escape — close find bar
      if (e.key === "Escape" && findOpenRef.current) {
        setFindOpen(false);
        setFindQuery("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // ── Word → chapter lookup (for API calls that require chapter) ────────────
  const wordToChapter = useMemo(
    () => new Map(words.map((w) => [w.wordId, w.chapter])),
    [words]
  );
  // Keep the ref in sync so hook handlers (getChapterForWord) always see the latest map.
  wordToChapterRef.current = wordToChapter;

  // Precomputed section ranges: key = `${wordId}:${level}` → { endChapter, endVerse }
  // Uses book-wide breaks (from bookSceneBreaks prop) plus live passage breaks from sceneBreakMap.
  // Chapters covered by the passage come from live state; other chapters from the static prop.
  const passageChapterSet = useMemo(() => {
    // Cross-book passages span two separate chapter sequences (e.g. 1Sam 31 → 2Sam 1–5).
    // The simple range loop would produce an empty set when endChapter < startChapter
    // across books, so derive the set directly from the loaded words instead.
    if (passage.endBook && passage.endBook !== passage.book) {
      return new Set(words.map((w) => w.chapter));
    }
    const s = new Set<number>();
    for (let ch = passage.startChapter; ch <= passage.endChapter; ch++) s.add(ch);
    return s;
  }, [passage.startChapter, passage.endChapter, passage.endBook, passage.book, words]);

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

  // ── Find-in-page hits ─────────────────────────────────────────────────────
  const findHitIds = useMemo<string[]>(() => {
    if (!findQuery.trim()) return [];
    const q = normalizeForSearch(findQuery);
    if (!q) return [];
    return words
      .filter((w) => !isPunctuationWord(w))
      .filter((w) => normalizeForSearch(w.surfaceText ?? "").includes(q))
      .map((w) => w.wordId);
  }, [words, findQuery]);

  const findHitSet = useMemo(() => new Set(findHitIds), [findHitIds]);
  const findFocusId = findHitIds[findFocusIdx % Math.max(findHitIds.length, 1)] ?? null;

  // Keep refs in sync for the static keydown listener
  useEffect(() => { findHitIdsRef.current = findHitIds; }, [findHitIds]);

  // Sync findFocusId ref for keyboard handler
  useEffect(() => { findFocusIdRef.current = findFocusId; }, [findFocusId]);

  // Scroll focused find hit into view
  useEffect(() => {
    if (!findFocusId) return;
    document
      .querySelector(`[data-word-id="${CSS.escape(findFocusId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findFocusId]);

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
    // Cross-book passages have two independent chapter sequences (e.g. 1Sam ch31,
    // then 2Sam ch1–5). Sorting numerically would interleave them incorrectly
    // (ch1 < ch31). Preserve insertion order instead; within each chapter, verses
    // are always monotonically increasing so sorting is still safe.
    const isCrossBook = !!(passage.endBook && passage.endBook !== passage.book);
    const result: { ch: number; v: number; words: Word[] }[] = [];
    const chapterEntries = isCrossBook
      ? byChapter.entries()
      : [...byChapter.entries()].sort(([a], [b]) => a - b);
    for (const [ch, byVerse] of chapterEntries)
      for (const [v, vWords] of [...byVerse.entries()].sort(([a], [b]) => a - b))
        result.push({ ch, v, words: vWords });
    return result;
  }, [words, passage.endBook, passage.book]);

  // Whether this passage actually spans multiple chapters
  const isMultiChapter = orderedVerses.length > 0 &&
    orderedVerses[orderedVerses.length - 1].ch !== orderedVerses[0].ch;

  // ── Character map ─────────────────────────────────────────────────────────
  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  // ── wordId → SpeechSection[] sorted largest-range-first (outermost → innermost) ──
  const wordSpeechMap = useMemo<Map<string, SpeechSection[]>>(() => {
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));
    const sorted = [...speechSections].sort((a, b) => {
      const aLen = (posMap.get(a.endWordId) ?? 0) - (posMap.get(a.startWordId) ?? 0);
      const bLen = (posMap.get(b.endWordId) ?? 0) - (posMap.get(b.startWordId) ?? 0);
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

  // ── Line annotations (hook) ──────────────────────────────────────────────
  const {
    lineAnnotations: lineAnnotationsState, setLineAnnotations: setLineAnnotationsState,
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
    book: osisBook,
    textSource,
    getChapterForWord,
    paragraphFirstWordIds,
  });

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
      allAvailableTranslations
        .filter((t) => activeTranslationAbbrs.has(t.abbreviation))
        .map((t) => t.id)
    ),
    [activeTranslationAbbrs, allAvailableTranslations]
  );

  // keyed by "chapter:verse" to avoid collisions in multi-chapter passages
  const activeTranslationVerseMap = useMemo(() => {
    const map = new Map<string, TranslationTextEntry[]>();
    for (const t of allAvailableTranslations) {
      if (!activeTranslationIds.has(t.id)) continue;
      const verses = localTranslationVerseData[t.id] ?? [];
      // Deduplicate by chapter:verse — keep highest-id row (DB has no unique constraint)
      const deduped = new Map<string, typeof verses[0]>();
      for (const tv of verses) {
        const vk = `${tv.chapter}:${tv.verse}`;
        const prev = deduped.get(vk);
        if (!prev || tv.id > prev.id) deduped.set(vk, tv);
      }
      for (const tv of deduped.values()) {
        const key = `${tv.chapter}:${tv.verse}`;
        const existing = map.get(key) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text, translationId: t.id });
        map.set(key, existing);
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
  const rangeLabel = (() => {
    if (passage.endBook && passage.endBook !== passage.book) {
      // Cross-book passage: show both book names
      const endBkName = OSIS_BOOK_NAMES[passage.endBook] ?? passage.endBook;
      return `${bookName} ${startChapter}:${startVerse} – ${endBkName} ${endChapter}:${endVerse}`;
    }
    return startChapter === endChapter
      ? `${bookName} ${startChapter}:${startVerse}–${endVerse}`
      : `${bookName} ${startChapter}:${startVerse} – ${endChapter}:${endVerse}`;
  })();

  // ── Word selection dispatcher ─────────────────────────────────────────────
  function handleSelectWord(word: Word, shiftHeld = false) {
    if (editingArrows) { handleSelectArrowWordById(word.wordId); return; }
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
      nextRef = { id: -1, wordId, character1Id: activeCharId, character2Id: null, textSource: source, book: osisBook, chapter: wordChapter, workspaceId: 0 };
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
      else next.set(wordId, { id: -1, wordId, tagId: activeWordTagId!, textSource: source, book: osisBook, chapter: wordChapter, workspaceId: 0 });
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
    if (clusterLemmaCallback !== null) {
      const canonicalLemma = word.language === "hebrew"
        ? (word.strongNumber ?? word.lemma ?? word.surfaceText?.replace(/\//g, "") ?? "?")
        : (word.lemma ?? word.surfaceText ?? "?");
      clusterLemmaCallback(canonicalLemma);
      return;
    }
    const wordChapter = wordToChapter.get(word.wordId) ?? passage.startChapter;
    if (pendingWordTag && pendingWordTagColor !== null) {
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
      await handleCreateClusterTag(displayName, [canonicalLemma], color, corpusGroupingId, [osisBook], "word");
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
    firstWordChapter?: number,
    corpusGroupingId?: number | null,
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book: osisBook, name, color, type,
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
      corpusGroupingId: corpusGroupingId ?? null, lemmas: null,
    };
    setWordTags((prev) => [...prev, tempTag]);
    setActiveWordTagId(tempTag.id);

    try {
      const res = await fetch("/api/word-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, type, book: osisBook, corpusGroupingId: corpusGroupingId ?? null }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

      if (firstWordId && firstWordSource) {
        const chap = firstWordChapter ?? passage.startChapter;
        const ref: WordTagRef = {
          id: -1, wordId: firstWordId, tagId: realTag.id,
          textSource: firstWordSource, book: osisBook, chapter: chap, workspaceId: 0,
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

  async function handleCreateClusterTag(
    name: string,
    lemmas: string[],
    color: string,
    corpusGroupingId: number | null,
    corpusBooks: string[],
    type: "cluster" | "word" = "cluster",
  ) {
    const tempTag: WordTag = {
      id: -(Date.now()), book: osisBook, name, color, type,
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
          name, color, book: osisBook, lemmas, corpusBooks,
          textSource, corpusGroupingId, currentChapter: passage.startChapter, type,
        }),
      });
      const data = await res.json();
      const realTag: WordTag = data.tag;
      setWordTags((prev) => prev.map((t) => t.id === tempTag.id ? realTag : t));
      setActiveWordTagId(realTag.id);

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
    return handleCreateTag("concept", name, color, undefined, undefined, undefined, corpusGroupingId);
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

  function handleToggleWordTagHighlight(id: number) {
    setHighlightWordTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      textSource, book: osisBook, chapter: sectionChapter, workspaceId: 0,
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
      createdAt: new Date().toISOString(), workspaceId: 0, sortOrder: null,
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
        arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null, thematic: false, thematicLetter: null });
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
          arr.push({ heading: null, level, verse, outOfSequence: false, extendedThrough: null, thematic: false, thematicLetter: null });
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

  async function handleChangeSceneBreakLevel(wordId: string, fromLevel: number, toLevel: number, verse: number) {
    const existing = sceneBreakMap.get(wordId)?.find(b => b.level === fromLevel);
    if (!existing) return;
    const wordChapter = wordToChapter.get(wordId) ?? passage.startChapter;
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
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book: bookName, chapter: wordChapter, verse, source: textSource, level: fromLevel }) });
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, book: bookName, chapter: wordChapter, verse, source: textSource, level: toLevel }) });
      if (existing.heading) {
        await fetch("/api/scene-breaks", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, level: toLevel, heading: existing.heading }) });
      }
    } catch {
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
    const emptyBreaks: { wordId: string; level: number; verse: number }[] = [];
    for (const [wordId, breaks] of sceneBreakMap) {
      for (const br of breaks) {
        const inputEl = document.getElementById(`scene-heading-${wordId}-${br.level}`) as HTMLInputElement | null;
        const currentValue = inputEl ? inputEl.value.trim() : (br.heading?.trim() ?? "");
        if (!currentValue) emptyBreaks.push({ wordId, level: br.level, verse: br.verse });
      }
    }
    setEditingScenes(false);
    for (const { wordId, level, verse } of emptyBreaks) {
      handleToggleSceneBreak(wordId, level, verse);
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
    } catch { /* non-critical */ }
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
    } catch { /* non-critical */ }
  }

  // Line annotation handlers (handleSelectAnnotationSegment, handleCancelAnnotation,
  // handleSaveAnnotation, handleDeleteAnnotation, handleUpdateAnnotation,
  // handleExpandAnnotationRange) are provided by useAnnotationRange above.

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
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);
    if (!tvRecord) return;
    const oldText = tvRecord.text;
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
    await handleUpdateTranslationVerse(abbr, verse, snapRecord.text);
  }

  // ── Search / Bible lookup ────────────────────────────────────────────────
  const handleSearchResults = useCallback((allResults: import("@/app/api/search/words/route").SearchResult[]) => {
    const normalizedSource = textSource === "LXX" ? "STEPBIBLE_LXX" : textSource;
    const hits = new Set<string>();
    for (const r of allResults) {
      if (r.book === osisBook && passageChapterSet.has(r.chapter) && r.textSource === normalizedSource) {
        hits.add(r.wordId);
      }
    }
    setSearchHits(hits);
  }, [osisBook, passageChapterSet, textSource]);

  const handleSearchSaved = useCallback((tagId: number, name: string, color: string, wordRefs: { wordId: string; book: string; chapter: number; textSource: string }[]) => {
    const newTag: import("@/lib/db/schema").WordTag = { id: tagId, workspaceId: 1, book: "*", name, color, type: "search", createdAt: new Date().toISOString(), sortOrder: null, corpusGroupingId: null, lemmas: null };
    setWordTags((prev) => [...prev, newTag]);
    const normalizedSource = textSource === "LXX" ? "STEPBIBLE_LXX" : textSource;
    const passageRefs = wordRefs.filter(
      (r) => r.book === osisBook && passageChapterSet.has(r.chapter) && r.textSource === normalizedSource
    );
    if (passageRefs.length > 0) {
      setWordTagRefMap((prev) => {
        const next = new Map(prev);
        for (const r of passageRefs) {
          if (!next.has(r.wordId)) {
            next.set(r.wordId, { id: -1, workspaceId: 1, wordId: r.wordId, tagId, textSource: r.textSource, book: r.book, chapter: r.chapter });
          }
        }
        return next;
      });
    }
    setSearchHits(new Set());
  }, [osisBook, passageChapterSet, textSource]);

  /** Called by MorphologyPanel when the user clicks a lemma or Strong's number. */
  const handleSearchFromWord = useCallback((query: string, source: string) => {
    setSearchOpen(true);
    setSearchRequest({ query, source, nonce: Date.now() });
  }, []);

  /** Called when the user clicks a lemma in interlinear mode. */
  const handleLemmaClick = useCallback((word: Word) => {
    const query = word.language === "hebrew"
      ? (word.strongNumber ?? word.lemma ?? "")
      : (word.lemma ?? "");
    if (!query) return;
    setSearchOpen(true);
    setSearchRequest({ query, source: word.textSource, nonce: Date.now() });
  }, []);

  // ── Interlinear dataset handlers ──────────────────────────────────────────
  async function handleSaveConstituentLabel(wordId: string, label: string | null) {
    setConstituentLabelMap((prev) => {
      const next = new Map(prev);
      if (label === null) next.delete(wordId);
      else next.set(wordId, label);
      return next;
    });
    try {
      const ch = wordToChapter.get(wordId) ?? passage.startChapter;
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
          body: JSON.stringify({ workspaceId: 1, wordId, label, textSource, book: osisBook, chapter: ch }),
        });
      }
    } catch { /* ignore */ }
  }

  async function handleSaveDatasetEntry(wordId: string, value: string | null) {
    if (typeof interlinearSubMode !== "object" || interlinearSubMode.type !== "dataset") return;
    const dsId = interlinearSubMode.id;
    setDatasetEntryMap((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(wordId);
      else next.set(wordId, value);
      return next;
    });
    try {
      const ch = wordToChapter.get(wordId) ?? passage.startChapter;
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
          body: JSON.stringify({ wordId, value, textSource, book: osisBook, chapter: ch }),
        });
      }
    } catch { /* ignore */ }
  }

  async function handleCreateDataset(name: string): Promise<{ id: number; name: string } | null> {
    try {
      const res = await fetch("/api/interlinear/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: 1, name }),
      });
      const ds = await res.json() as { id: number; name: string };
      setDatasets((prev) => [...prev, ds]);
      return ds;
    } catch { return null; }
  }

  async function handleDeleteDataset(id: number) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    try { await fetch(`/api/interlinear/datasets/${id}`, { method: "DELETE" }); } catch { /* ignore */ }
  }

  async function handleRenameDataset(id: number, name: string) {
    setDatasets((prev) => prev.map((d) => d.id === id ? { ...d, name } : d));
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
      if (wordId && value) {
        const ch = wordToChapter.get(wordId) ?? passage.startChapter;
        entries.push({ wordId, value, textSource, book: osisBook, chapter: ch });
      }
    }
    if (entries.length === 0) return;
    try {
      await fetch(`/api/interlinear/datasets/${datasetId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (typeof interlinearSubMode === "object" && interlinearSubMode.type === "dataset" && interlinearSubMode.id === datasetId) {
        // Reload all entries for the passage
        const chapterSet = [...new Set(words.map((w) => w.chapter))];
        const all = await Promise.all(chapterSet.map((ch) =>
          fetch(`/api/interlinear/datasets/${datasetId}/entries?book=${encodeURIComponent(osisBook)}&chapter=${ch}&textSource=${encodeURIComponent(textSource)}`)
            .then((r) => r.json())
            .then((rows: { wordId: string; value: string }[]) => rows)
        ));
        setDatasetEntryMap(new Map(all.flat().map((r) => [r.wordId, r.value])));
      }
    } catch { /* ignore */ }
    setUploadDatasetId(null);
  }

  // ── Translation footnote handlers ─────────────────────────────────────────
  async function handleAddFootnote() {
    if (!fnDialogContent.trim()) return;
    const translation = allAvailableTranslations.find((t) => t.abbreviation === fnDialogAbbr);
    if (!translation) return;
    try {
      const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === fnDialogVerse);
      const res = await fetch("/api/translation-footnotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationId: translation.id,
          osisRef: tvRecord?.osisRef ?? `${osisBook}.${passage.startChapter}.${fnDialogVerse}`,
          verse: fnDialogVerse,
          abbr: fnDialogAbbr,
          type: fnDialogType,
          content: fnDialogContent.trim(),
        }),
      });
      if (res.ok) {
        const { footnote: created }: { footnote: TranslationFootnote } = await res.json();
        setLocalFootnotes((prev) => ({
          ...prev,
          [translation.id]: [...(prev[translation.id] ?? []), created],
        }));
        if (tvRecord) {
          const newText = tvRecord.text.trimEnd() + " \\fn \\fn*";
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
    setFnDialogOpen(true);
  }

  async function handleDeleteFootnote(translationId: number, fnId: number) {
    try {
      await fetch(`/api/translation-footnotes?id=${fnId}`, { method: "DELETE" });
      setLocalFootnotes((prev) => ({
        ...prev,
        [translationId]: (prev[translationId] ?? []).filter((fn) => fn.id !== fnId),
      }));
    } catch { /* ignore */ }
  }

  // ── Divine-name USFM marker ───────────────────────────────────────────────────
  function applyNdMarker() {
    const el = document.activeElement as HTMLTextAreaElement | null;
    if (!el || el.tagName !== "TEXTAREA" || !el.dataset.translationTextarea) return;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    if (s === e) return;
    const val = el.value;
    const selected = val.slice(s, e);
    const inserted = `\\nd ${selected}\\nd*`;
    const newVal = val.slice(0, s) + inserted + val.slice(e);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    nativeSetter?.call(el, newVal);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.selectionStart = s;
    el.selectionEnd = s + inserted.length;
    el.focus();
  }

  // ── Version history ───────────────────────────────────────────────────────
  async function openHistory(abbr: string, verse: number) {
    const translation = allAvailableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);
    if (!tvRecord) return;
    setHistoryAbbr(abbr);
    setHistoryVerse(verse);
    setHistoryOpen(true);
    try {
      const res = await fetch(
        `/api/translation-versions?translationId=${translation.id}&osisRef=${encodeURIComponent(tvRecord.osisRef)}`
      );
      if (res.ok) setHistoryVersions((await res.json()).versions ?? []);
    } catch { /* ignore */ }
  }

  async function handleRestoreVersion(versionText: string) {
    await handleUpdateTranslationVerse(historyAbbr, historyVerse, versionText);
    setHistoryOpen(false);
  }

  // ── Toolbar tooltip ───────────────────────────────────────────────────────
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

  // ── tagFocusedFindWord — updated each render so it captures fresh state ─────
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

  // ── Outline pane ──────────────────────────────────────────────────────────
  const [outlineOpen, setOutlineOpen] = useState(false);

  const outlineBreaksForPane = useMemo(() => {
    const result: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[] = [];
    for (const [wordId, arr] of sceneBreakMap) {
      const ch = wordToChapter.get(wordId) ?? passage.startChapter;
      for (const br of arr) {
        result.push({ wordId, heading: br.heading, level: br.level, chapter: ch, verse: br.verse, positionInVerse: 1, thematic: br.thematic, thematicLetter: br.thematicLetter });
      }
    }
    result.sort((a, b) =>
      a.chapter !== b.chapter ? a.chapter - b.chapter :
      a.verse   !== b.verse   ? a.verse   - b.verse   :
      a.level   - b.level
    );
    return result;
  }, [sceneBreakMap, wordToChapter, passage.startChapter]);

  async function handleDeleteSceneBreakForOutline(wordId: string, level: number) {
    setSceneBreakMap((prev) => {
      const next = new Map(prev);
      const arr = (prev.get(wordId) ?? []).filter((b) => b.level !== level);
      if (arr.length === 0) next.delete(wordId);
      else next.set(wordId, arr);
      return next;
    });
    try {
      await fetch("/api/scene-breaks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, level }),
      });
    } catch { /* non-critical */ }
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
    <div className="relative h-full min-h-0 flex flex-row">
      {/* Main content + toolbar — takes remaining width; notes pane sits to the right */}
      <div
        className="flex-1 overflow-y-auto flex flex-col min-h-0"
        ref={overlayContainerRef}
        style={{ position: "relative" }}
        onClick={editingRst && (rstSegA || rstSegAGroupId) ? () => { setRstSegA(null); setRstSegAGroupId(null); setRstSegB(null); setShowRstPicker(false); } : undefined}
      >
        <ChapterOverlays
          rstRelations={rstRelations}
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
          containerRef={overlayContainerRef}
        />

        {/* ── Passage header ──────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)" }}>

          {/* Header row: range label + outline export + delete */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-lg font-bold flex-1" style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}>
              {rangeLabel}
            </span>

            {/* Outline sidebar toggle */}
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

        {/* Toolbar tooltip */}
        {tbTooltip && (
          <div
            className="fixed z-[200] pointer-events-none px-2 py-1 rounded bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[13px] max-w-xs shadow-lg"
            style={
              tbTooltip.x > window.innerWidth * 0.65
                ? { right: window.innerWidth - tbTooltip.x + 8, top: tbTooltip.y + 16 }
                : { left: tbTooltip.x + 12, top: tbTooltip.y + 16 }
            }
          >
            {tbTooltip.text}
          </div>
        )}

        {/* Toolbar */}
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
                setEditingRefs(false);
                setEditingSpeech(false);
                setEditingWordTags(false);
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
            title={presentationMode ? "Exit presentation mode" : "Enter presentation mode — larger text, minimal toolbar"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              presentationMode
                ? "bg-sky-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >⊞</button>

          {!presentationMode && (<>
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
                setTimeout(() => uploadInputRef.current?.click(), 0);
              }}
            />
          )}
          {toolbarVis.tooltips && <button
            onClick={() => setShowTooltips((v) => !v)}
            data-tip={showTooltips ? "Disable hover tooltips" : "Enable hover tooltips"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              showTooltips ? "bg-blue-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >Tooltips</button>}

          {/* Linguistic terms toggle — Hebrew only */}
          {isHebrew && toolbarVis.qatal && (
            <button
              onClick={() => setUseLinguisticTerms((v) => !v)}
              data-tip={useLinguisticTerms
                ? "Show descriptive aspect names (Perfect, Imperfect…)"
                : "Show linguistic terms (Qatal, Yiqtol, Wayyiqtol, Weqatal)"}
              className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
                useLinguisticTerms ? "bg-blue-600 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >Qatal</button>
          )}

          <div className="h-5 border-l border-[var(--border)]" />

          {/* Atnach marker — Hebrew only */}
          {isHebrew && toolbarVis.atnach && (
            <button
              onClick={() => setShowAtnachBreaks((v) => !v)}
              data-tip={showAtnachBreaks ? "Hide atnach half-verse markers" : "Show atnach accent markers (main cantillation accent dividing each verse)"}
              className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
                showAtnachBreaks ? "bg-violet-600 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >Atnach</button>
          )}

          {/* Scene / episode break mode */}
          {toolbarVis.scenes && <button
            onClick={() => editingScenes ? handleExitSceneEditing() : setEditingScenes(true)}
            data-tip={editingScenes
              ? "Exit section break mode"
              : "Enter section break mode — click any word to mark/remove a section break there"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingScenes ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >§</button>}

          {/* Outline sidebar toggle */}
          {toolbarVis.outline && sceneBreakMap.size > 0 && (
            <button
              type="button"
              onClick={() => setOutlineOpen((v) => !v)}
              className={[
                "shrink-0 text-xs px-2 py-0.5 rounded transition-colors",
                outlineOpen
                  ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
              data-tip="Open outline sidebar"
            >
              📋 Outline
            </button>
          )}

          {/* Line annotation mode */}
          {toolbarVis.annotations && <button
            onClick={() => {
              setEditingAnnotations((v) => !v);
              setAnnotRangeStart(null);
              setAnnotRangeEnd(null);
            }}
            data-tip={editingAnnotations ? "Exit annotation mode" : "Add clause/paragraph labels"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingAnnotations ? "bg-indigo-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >≡</button>}

          {/* Paragraph edit mode */}
          {toolbarVis.paragraphs && <button
            onClick={() => setEditingParagraphs((v) => !v)}
            data-tip={editingParagraphs ? "Exit paragraph edit mode" : "Enter paragraph edit mode — click any word to start/remove a paragraph there"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingParagraphs ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >¶</button>}

          {/* Indent mode */}
          {toolbarVis.indents && <button
            onClick={() => {
              setEditingIndents((v) => !v);
              setEditingRefs(false); setEditingSpeech(false);
              setEditingWordTags(false); setSpeechRangeStart(null);
              setPendingWordTag(false);
            }}
            data-tip={editingIndents ? "Exit indent mode" : "Indent paragraphs to indicate subordinate clauses"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingIndents ? "bg-teal-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >⇥</button>}

          {/* Source/translation indent link toggle */}
          {editingIndents && (
            <label
              className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400 cursor-pointer select-none"
              data-tip={indentsLinked
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
          {toolbarVis.rst && <button
            onClick={() => {
              const entering = !editingRst;
              setEditingRst(entering);
              setEditingArrows(false);
              setArrowFromWordId(null);
              setRstSegA(null);
              setRstSegB(null);
              setShowRstPicker(false);
              if (!entering) setShowRstTypeManager(false);
            }}
            data-tip={editingRst ? "Exit RST relation mode" : "Mark RST (Rhetorical Structure Theory) relations between paragraph segments"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRst ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >↳</button>}
          {toolbarVis.rst && editingRst && (
            <button
              onClick={() => setShowRstTypeManager((v) => !v)}
              data-tip="Manage RST label types"
              className={[
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                showRstTypeManager
                  ? "bg-amber-500 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >Labels</button>
          )}

          {/* Word arrow mode */}
          {toolbarVis.arrows && <button
            onClick={() => {
              setEditingArrows((v) => !v);
              setEditingRst(false);
              setRstSegA(null);
              setRstSegB(null);
              setShowRstPicker(false);
              setArrowFromWordId(null);
              setEditingWordTags(false);
              setPendingWordTag(false);
            }}
            data-tip={editingArrows ? "Exit word arrow mode" : "Draw free-form arrows between words"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingArrows ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >↷</button>}

          {/* Bold formatting mode */}
          {toolbarVis.bold && <button
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
            data-tip={editingBold ? "Exit bold mode" : "Click words to toggle bold"}
            className={["px-2.5 py-1 rounded text-xs font-bold transition-colors",
              editingBold ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >B</button>}

          {/* Italic formatting mode */}
          {toolbarVis.italic && <button
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
            data-tip={editingItalic ? "Exit italic mode" : "Click words to toggle italic"}
            className={["px-2.5 py-1 rounded text-xs italic transition-colors",
              editingItalic ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >I</button>}

          {/* Character reference mode */}
          {toolbarVis.refs && <button
            onClick={() => {
              setEditingRefs((v) => !v);
              setEditingSpeech(false); setEditingWordTags(false);
              setPendingWordTag(false); setSpeechRangeStart(null);
            }}
            data-tip={editingRefs ? "Exit reference tagging" : "Tag words as referring to a character"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRefs ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >👤</button>}

          {/* Speech section mode */}
          {toolbarVis.speech && <button
            onClick={() => {
              setEditingSpeech((v) => !v);
              setEditingRefs(false); setEditingWordTags(false);
              setPendingWordTag(false); setSpeechRangeStart(null);
            }}
            data-tip={editingSpeech ? "Exit speech tagging" : "Mark word ranges as spoken by a character (two clicks: start then end)"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingSpeech ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >💬</button>}

          {/* Word/concept tag mode */}
          {toolbarVis.wordTags && <button
            onClick={() => {
              setEditingWordTags((v) => !v);
              setEditingRefs(false); setEditingSpeech(false);
              setEditingIndents(false); setSpeechRangeStart(null);
              setPendingWordTag(false); setEditingArrows(false); setArrowFromWordId(null);
            }}
            data-tip={editingWordTags ? "Exit word/concept tag mode" : "Tag words or concepts with colour highlights"}
            className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingWordTags ? "bg-yellow-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >🏷</button>}

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
              data-tip={`Undo: ${undoStack[undoStack.length - 1].label} (Ctrl/Cmd+Z)`}
              className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
            >↩ {undoStack[undoStack.length - 1].label}</button>
          )}

          {/* Clear annotations */}
          {toolbarVis.clear && (
            <div className="border-l border-[var(--border)] pl-3 ml-1">
              <button
                onClick={() => setShowClearDialog(true)}
                data-tip="Clear annotations by category"
                className="px-2.5 py-1 rounded text-xs font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
              >🗑</button>
            </div>
          )}

          {/* Notes / Search / Bible panel toggles */}
          <div className="border-l border-[var(--border)] pl-3 ml-1 flex items-center gap-1">
            {toolbarVis.notes && <button
              onClick={() => setNotesOpen((v) => !v)}
              data-tip={notesOpen ? "Hide notes pane" : "Show notes pane"}
              className={[
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                notesOpen
                  ? "bg-amber-500 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >📝</button>}
            {toolbarVis.search && <button
              onClick={() => setSearchOpen((v) => !v)}
              data-tip={searchOpen ? "Close Search" : "Search corpus"}
              className={[
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                searchOpen
                  ? "bg-amber-500 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >🔍</button>}
            {toolbarVis.bible && <button
              onClick={() => setBibleOpen((v) => !v)}
              data-tip={bibleOpen ? "Close Bible Lookup" : "Bible Lookup"}
              className={[
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                bibleOpen
                  ? "bg-amber-500 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >📖</button>}
          </div>

          {/* Translation toggles */}
          {toolbarVis.translations && allAvailableTranslations.length > 0 && (
            <div className="flex items-center gap-1 border-l border-[var(--border)] pl-4">
              <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">Translations:</span>
              {/* Source text visibility — shown only when a translation is active */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setHideSourceText((v) => !v)}
                  data-tip={hideSourceText ? `Show ${textSource} text` : `Hide ${textSource} text`}
                  className={["px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                    !hideSourceText ? "bg-emerald-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >{textSource}</button>
              )}
              {/* Translation text edit mode */}
              {hasActiveTranslations && (
                <button
                  onClick={() => { setEditingTranslation((v) => !v); setEditingTranslationSource(false); }}
                  data-tip={editingTranslation ? "Exit translation edit mode" : "Edit translation text"}
                  className={["px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    editingTranslation ? "bg-sky-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >✏</button>
              )}
              {allAvailableTranslations.map((t) => (
                <button key={t.id} onClick={() => toggleTranslation(t.id)}
                  data-tip={systemTranslationIds.has(t.id) ? `${t.name} (built-in)` : t.name}
                  className={["px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                    activeTranslationIds.has(t.id) ? "bg-emerald-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  {t.abbreviation}
                  {systemTranslationIds.has(t.id) && (
                    <span className="ml-1 text-[10px] opacity-60">★</span>
                  )}
                </button>
              ))}
              {/* Translation editing sub-toolbar — only shown when edit mode is active */}
              {hasActiveTranslations && editingTranslation && (
                <>
                  {/* Divine Name: wraps textarea selection in \nd...\nd* */}
                  <button
                    onMouseDown={(e) => { e.preventDefault(); applyNdMarker(); }}
                    data-tip="Wrap selection as Divine Name (small caps) — \nd...\nd*"
                    className="px-2.5 py-1.5 rounded text-[11px] font-bold font-mono tracking-wider transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900 dark:hover:text-amber-300"
                    style={{ fontVariant: "small-caps" }}
                  >nd</button>
                  <button
                    onClick={() => {
                      const firstAbbr = [...activeTranslationIds]
                        .map((id) => allAvailableTranslations.find((tr) => tr.id === id))
                        .find((tr) => tr)?.abbreviation ?? "";
                      setFnEditId(null);
                      setFnDialogAbbr(firstAbbr);
                      setFnDialogVerse(passage.startVerse);
                      setFnDialogType("f");
                      setFnDialogContent("");
                      setFnDialogOpen(true);
                    }}
                    data-tip="Add a footnote or cross-reference to a verse"
                    className="px-2.5 py-1.5 rounded text-xs font-medium transition-colors bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                  >fn+</button>
                  <button
                    onClick={() => {
                      const firstAbbr = [...activeTranslationIds]
                        .map((id) => allAvailableTranslations.find((tr) => tr.id === id))
                        .find((tr) => tr)?.abbreviation ?? "";
                      openHistory(firstAbbr, passage.startVerse);
                    }}
                    data-tip="View version history for a verse"
                    className={["px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                      historyOpen ? "bg-violet-600 text-white"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                    ].join(" ")}
                  >⏱</button>
                </>
              )}
              {/* Show/hide footnotes — visible whenever a translation is active */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setShowFootnotes((v) => !v)}
                  data-tip={showFootnotes ? "Hide footnotes" : "Show footnotes"}
                  className={["px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                    showFootnotes
                      ? "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      : "bg-stone-300 dark:bg-stone-600 text-stone-500 dark:text-stone-400",
                  ].join(" ")}
                >fn</button>
              )}
            </div>
          )}

          {/* Font size controls */}
          {(() => {
            const sizeBtn = "w-6 h-6 flex items-center justify-center rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors select-none";
            return (
              <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                <span className="text-xs text-stone-400 dark:text-stone-500 select-none">{isHebrew ? "Heb" : "Grk"}</span>
                <button className={sizeBtn} onClick={() => adjustFontSize("source", -0.125)} data-tip="Decrease source text size">A−</button>
                <button className={sizeBtn} onClick={() => adjustFontSize("source", +0.125)} data-tip="Increase source text size">A+</button>
                {hasActiveTranslations && (
                  <>
                    <span className="text-xs text-stone-400 dark:text-stone-500 select-none ml-1">Tr</span>
                    <button className={sizeBtn} onClick={() => adjustFontSize("translation", -0.0625)} data-tip="Decrease translation text size">A−</button>
                    <button className={sizeBtn} onClick={() => adjustFontSize("translation", +0.0625)} data-tip="Increase translation text size">A+</button>
                  </>
                )}
              </div>
            );
          })()}

          {/* Gear button — toolbar customizer */}
          <div className="ml-auto">
            <button
              ref={gearBtnRef}
              onClick={() => setShowToolbarCustomizer((v) => !v)}
              data-tip="Customize toolbar"
              className={[
                "px-2.5 py-1 rounded text-lg font-medium transition-colors",
                showToolbarCustomizer
                  ? "bg-stone-300 dark:bg-stone-600 text-stone-700 dark:text-stone-200"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700",
              ].join(" ")}
            >⚙</button>
            {showToolbarCustomizer && (
              <ToolbarCustomizer
                visibility={toolbarVis}
                onChange={(key: keyof ToolbarVisibility, vis: boolean) => setToolbarVis((prev) => ({ ...prev, [key]: vis }))}
                onClose={() => setShowToolbarCustomizer(false)}
                anchorRef={gearBtnRef}
              />
            )}
          </div>
          </>)}
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
            onReorder={handleReorderCharacters}
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
            currentBook={osisBook}
            bookGroupings={bookGroupings}
            clusterPickingActive={clusterLemmaCallback !== null}
            onSelectTag={(id) => { setActiveWordTagId(id); setPendingWordTag(false); }}
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
            Click a source word to name this tag by its lemma
          </div>
        )}

        {/* RST relation hint */}
        {editingRst && !showRstPicker && !rstEditGroupId && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {rstSegA
              ? "First endpoint selected — click a segment dot or group connector dot to complete the relation"
              : "Click a segment dot (◉) or group connector dot to start an RST relation. Click a label chip to change its type."}
          </div>
        )}

        {/* RST group-type edit picker (shown when a chip label is clicked) */}
        {rstEditGroupId && (
          <div
            className="border-b border-[var(--border)] px-4 py-2 flex flex-col gap-1 shrink-0"
            style={{ backgroundColor: "var(--nav-bg)" }}
          >
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-medium mr-1" style={{ color: "var(--nav-fg-muted)" }}>
                Change relation type:
              </span>
              <span className="text-xs opacity-50 mr-0.5 select-none">Coord.</span>
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
              <span className="text-xs opacity-50 mr-0.5 select-none">Sub.</span>
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
                Cancel
              </button>
            </div>
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
              <span className="text-xs opacity-50 mr-0.5 select-none">Sub.</span>
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

        {/* RST type manager panel */}
        {editingRst && showRstTypeManager && (
          <RstTypeManager
            customTypes={customRstTypes}
            onAdd={async (t) => {
              const res = await fetch("/api/rst-custom-types", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(t),
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
                setCustomRstTypes((prev) => prev.map((t) => t.id === id ? row : t));
              }
            }}
            onDelete={async (id) => {
              await fetch(`/api/rst-custom-types?id=${id}`, { method: "DELETE" });
              setCustomRstTypes((prev) => prev.filter((t) => t.id !== id));
            }}
          />
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

        {/* Find-in-page bar */}
        {findOpen && (
          <FindBar
            query={findQuery}
            onChange={(q) => setFindQuery(q)}
            hitCount={findHitIds.length}
            focusIdx={findFocusIdx}
            onPrev={() => setFindFocusIdx((i) => (i - 1 + Math.max(findHitIds.length, 1)) % Math.max(findHitIds.length, 1))}
            onNext={() => setFindFocusIdx((i) => (i + 1) % Math.max(findHitIds.length, 1))}
            onClose={() => { setFindOpen(false); setFindQuery(""); }}
            inputRef={findInputRef}
            canTag={editingRefs || editingWordTags}
            onTag={() => tagFocusedFindWordRef.current()}
          />
        )}

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
            onClick={(e) => {
              if (editingArrows && !(e.target as HTMLElement).closest("[data-word-id]")) {
                setArrowFromWordId(null);
              }
            }}
          >
            {orderedVerses.map((verse, idx) => {
              const isFirstOfChapter = idx === 0 || orderedVerses[idx - 1].ch !== verse.ch;
              const prev = orderedVerses[idx - 1];
              const next = orderedVerses[idx + 1];
              return (
                <div key={`${verse.ch}:${verse.v}`}>
                  {/* Chapter heading — only shown for multi-chapter passages, not in presentation mode */}
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
                    verseNum={verse.v}
                    words={verse.words}
                    displayMode={displayMode}
                    grammarFilter={grammarFilter}
                    colorRules={colorRules}
                    onSelectWord={handleSelectWord}
                    selectedWordId={selectedWord?.wordId ?? null}
                    isHebrew={isHebrew}
                    showTooltips={showTooltips}
                    presentationMode={presentationMode}
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
                    editingTranslation={editingTranslation}
                    onUpdateTranslationVerse={handleUpdateTranslationVerse}
                    onCancelTranslationVerse={handleCancelTranslationVerse}
                    sceneBreakMap={sceneBreakMap}
                    editingScenes={editingScenes}
                    onToggleSceneBreak={handleToggleSceneBreak}
                    onUpdateSceneHeading={handleUpdateSceneHeading}
                    onUpdateSceneOutOfSequence={handleUpdateSceneOutOfSequence}
                    onUpdateSceneExtendedThrough={handleUpdateSceneExtendedThrough}
                    onUpdateSceneThematic={handleUpdateSceneThematic}
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
                    showAnnotationCol={editingAnnotations || lineAnnotationsState.length > 0}
                    editingArrows={editingArrows}
                    onSelectArrowWordById={handleSelectArrowWordById}
                    hideSourceText={hideSourceText}
                    rstSourcePad={rstSourcePad}
                    hasActiveTranslations={hasActiveTranslations}
                    showAtnachBreaks={showAtnachBreaks}
                    tagRangeStartWordId={refRangeStart ?? wordTagRangeStart}
                    findHits={findHitSet}
                    findFocusId={findFocusId}
                    interlinearSubMode={interlinearSubMode}
                    constituentLabelMap={constituentLabelMap}
                    datasetEntryMap={datasetEntryMap}
                    onSaveConstituentLabel={handleSaveConstituentLabel}
                    onSaveDatasetEntry={handleSaveDatasetEntry}
                    onLemmaClick={displayMode === "interlinear" && interlinearSubMode === "lemma" ? handleLemmaClick : undefined}
                    editingTranslationSource={editingTranslationSource}
                    translationFootnotes={
                      showFootnotes
                        ? Object.entries(localFootnotes).flatMap(([tid, fns]) =>
                            fns.filter((fn) => fn.verse === verse.v && activeTranslationIds.has(Number(tid)))
                          )
                        : []
                    }
                    onDeleteFootnote={(translationId, fnId) => handleDeleteFootnote(translationId, fnId)}
                    onEditFootnote={(fn) => openEditFootnote(fn)}
                    onVerseClick={(v) => {
                      setNotesOpen(true);
                      setNotesScrollVerse({ ch: verse.ch, v });
                    }}
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

      {/* ── Notes pane ───────────────────────────────────────────────────── */}
      {notesOpen && (
        <ResizablePane storageKey="pane-notes-width" defaultWidth={320} minWidth={200} maxWidth={700}>
          <PassageNotesPane
            passageId={passage.id}
            passageLabel={passage.label || `${bookName} ${passage.startChapter}:${passage.startVerse}–${passage.endChapter}:${passage.endVerse}`}
            book={osisBook}
            bookName={bookName}
            orderedVerses={orderedVerses}
            isMultiChapter={isMultiChapter}
            scrollToVerse={notesScrollVerse}
            onScrollHandled={() => setNotesScrollVerse(null)}
            onClose={() => setNotesOpen(false)}
          />
        </ResizablePane>
      )}

      {/* ── Search pane ──────────────────────────────────────────────────── */}
      {searchOpen && (
        <ResizablePane storageKey="pane-search-width" defaultWidth={340} minWidth={260} maxWidth={800}>
          <SearchPane
            book={osisBook}
            textSource={textSource}
            onClose={() => { setSearchOpen(false); setSearchHits(new Set()); }}
            onResultsChange={handleSearchResults}
            onSaveComplete={handleSearchSaved}
            searchRequest={searchRequest}
          />
        </ResizablePane>
      )}

      {/* ── Bible lookup pane ────────────────────────────────────────────── */}
      {bibleOpen && (
        <ResizablePane storageKey="pane-bible-width" defaultWidth={320} minWidth={240} maxWidth={600}>
          <BibleLookupPane onClose={() => setBibleOpen(false)} />
        </ResizablePane>
      )}

      {/* ── Outline pane ─────────────────────────────────────────────────── */}
      {outlineOpen && (
        <ResizablePane storageKey="pane-outline-width" defaultWidth={320} minWidth={220} maxWidth={600}>
          <OutlinePane
            book={osisBook}
            chapter={-1}
            textSource={textSource}
            sceneBreakMap={new Map()}
            bookSceneBreaks={outlineBreaksForPane}
            wordPositionMap={new Map()}
            sectionRanges={sectionRanges}
            onUpdateCurrentHeading={handleUpdateSceneHeading}
            onDeleteCurrentBreak={handleDeleteSceneBreakForOutline}
            onClose={() => setOutlineOpen(false)}
            outlineExtended={false}
            onToggleExtended={() => {}}
            continuationBook={null}
            continuationBookName={null}
            continuationBreaks={[]}
            crossBookRangeKeys={new Set()}
            passageChapters={passageChapterSet}
          />
        </ResizablePane>
      )}

      {/* ── Morphology side panel — flex sibling so it pushes content left instead of overlaying ── */}
      {panelOpen && (
          <ResizablePane storageKey="pane-morphology-width" defaultWidth={288} minWidth={200} maxWidth={700}>
            <div className="flex flex-col h-full bg-[var(--background)] border-l border-[var(--border)] shadow-[-4px_0_16px_rgba(0,0,0,0.1)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
                <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Word Analysis</h2>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
                  aria-label="Close"
                >×</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <MorphologyPanel word={selectedWord} useLinguisticTerms={useLinguisticTerms} onSearchRequest={handleSearchFromWord} />
              </div>
            </div>
          </ResizablePane>
      )}

      {/* ── Version history panel ────────────────────────────────────────── */}
      {historyOpen && (
        <ResizablePane storageKey="pane-history-width" defaultWidth={360} minWidth={260} maxWidth={700}>
          <div className="flex flex-col h-full border-l" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
              <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Version History — {historyAbbr} {passage.startChapter}:{historyVerse}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={historyVerse}
                  onChange={(e) => openHistory(historyAbbr, parseInt(e.target.value) || 1)}
                  className="w-14 text-xs rounded border px-1.5 py-0.5"
                  style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
                  title="Verse number"
                />
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
                >×</button>
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
              <div className="w-20">
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Verse</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={fnDialogVerse}
                  onChange={(e) => setFnDialogVerse(parseInt(e.target.value) || 1)}
                  className="w-full text-xs rounded border px-2 py-1"
                  style={{ backgroundColor: "var(--surface-muted)", borderColor: "var(--border-muted)", color: "var(--foreground)" }}
                />
              </div>
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
            <div className="flex justify-end gap-2 mt-3">
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
                onClick={fnEditId !== null ? handleUpdateFootnote : handleAddFootnote}
                disabled={!fnDialogContent.trim()}
                className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white disabled:opacity-50"
              >
                {fnEditId !== null ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
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
          e.target.value = "";
        }}
      />
    </div>
  );
}
