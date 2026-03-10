"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { Word, Character, CharacterRef, SpeechSection, WordTag, WordTagRef, ClauseRelationship, WordArrow } from "@/lib/db/schema";
import type { Translation, TranslationVerse } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry } from "@/lib/morphology/types";
import VerseDisplay from "./VerseDisplay";
import MorphologyPanel from "./MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import WordTagPanel from "@/components/controls/WordTagPanel";
import ClauseRelationshipOverlay from "./ClauseRelationshipOverlay";
import WordArrowOverlay from "./WordArrowOverlay";
import type { ColorRule } from "@/lib/morphology/colorRules";
import { RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";

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
  initialClauseRelationships: ClauseRelationship[];
  initialWordArrows: WordArrow[];
  initialWordFormatting: { wordId: string; isBold: boolean; isItalic: boolean }[];
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
  initialClauseRelationships,
  initialWordArrows,
  initialWordFormatting,
}: ChapterDisplayProps) {
  // Use fallback defaults for SSR — localStorage values are loaded in useEffect after hydration
  const [displayMode, setDisplayMode] = useState<DisplayMode>("clean");
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showTooltips, setShowTooltips] = useState(false);
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

  // ── Paragraph indentation state ─────────────────────────────────────────────
  const [lineIndentMap, setLineIndentMap] = useState<Map<string, number>>(
    () => new Map(initialLineIndents.map((li) => [li.wordId, li.indentLevel]))
  );
  const [editingIndents, setEditingIndents] = useState(false);

  // ── Clause relationships state ────────────────────────────────────────────
  const [clauseRelationships, setClauseRelationships] = useState<ClauseRelationship[]>(initialClauseRelationships);
  const [editingRelationships, setEditingRelationships] = useState(false);
  const [relFromSegWordId, setRelFromSegWordId] = useState<string | null>(null);
  const [relToSegWordId, setRelToSegWordId]     = useState<string | null>(null);
  const [showRelPicker, setShowRelPicker]       = useState(false);

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

  // ── Source text visibility ─────────────────────────────────────────────────
  // When true, source text columns are hidden so the user works with translation only.
  const [hideSourceText, setHideSourceText] = useState(false);

  // ── Translation text editing ───────────────────────────────────────────────
  // Local mutable copy of translationVerseData so edits can be reflected immediately.
  const [localTranslationVerseData, setLocalTranslationVerseData] = useState(translationVerseData);
  const [editingTranslation, setEditingTranslation] = useState(false);

  // ── Overlay refs ───────────────────────────────────────────────────────────
  const textContainerRef = useRef<HTMLDivElement>(null);
  // outerRef wraps textContainerRef without overflow clipping, so SVG arcs can
  // extend in any direction without being cut off by overflow-y: auto.
  const outerRef = useRef<HTMLDivElement>(null);

  // Maps every word in the chapter to the first word of its paragraph.
  // Used by VerseDisplay to look up indent levels for paragraph continuations.
  const wordToParaStart = useMemo(() => {
    const map = new Map<string, string>();
    let currentStart = words[0]?.wordId ?? "";
    for (const word of words) {
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

  // ── Undo stack ─────────────────────────────────────────────────────────────
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

  // Restore persisted settings after hydration — avoids server/client HTML mismatch
  // (reading localStorage in useState initializers causes hydration errors)
  useEffect(() => {
    setDisplayMode(readLocal<DisplayMode>("structura:displayMode", "clean"));
    setActiveTranslationAbbrs(new Set(readLocal<string[]>("structura:activeTranslations", [])));
    setUseLinguisticTerms(readLocal<boolean>("structura:useLinguisticTerms", false));
    setHebrewFontSize(readLocal<number>("structura:hebrewFontSize", 1.375));
    setGreekFontSize(readLocal<number>("structura:greekFontSize", 1.25));
    setTranslationFontSize(readLocal<number>("structura:translationFontSize", 0.875));
    setHideSourceText(readLocal<boolean>("structura:hideSourceText", false));
  }, []); // empty deps → runs once after first render (client only)

  // Persist sticky settings whenever they change
  useEffect(() => { writeLocal("structura:displayMode", displayMode); }, [displayMode]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hebrewFontSize", hebrewFontSize); }, [hebrewFontSize]);
  useEffect(() => { writeLocal("structura:greekFontSize", greekFontSize); }, [greekFontSize]);
  useEffect(() => { writeLocal("structura:translationFontSize", translationFontSize); }, [translationFontSize]);
  useEffect(() => { writeLocal("structura:hideSourceText", hideSourceText); }, [hideSourceText]);

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

  // Character id → Character
  const characterMap = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  // Resolve stored abbreviations → numeric IDs for the current chapter's translations
  const activeTranslationIds = useMemo(
    () => new Set(
      availableTranslations
        .filter((t) => activeTranslationAbbrs.has(t.abbreviation))
        .map((t) => t.id)
    ),
    [activeTranslationAbbrs, availableTranslations]
  );

  // wordId → SpeechSection (derived from ordered word list + section bounds)
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

  // Build verseNum → TranslationTextEntry[] for active translations
  const activeTranslationVerseMap = useMemo(() => {
    const map = new Map<number, TranslationTextEntry[]>();
    for (const t of availableTranslations) {
      if (!activeTranslationIds.has(t.id)) continue;
      const verses = localTranslationVerseData[t.id] ?? [];
      for (const tv of verses) {
        const existing = map.get(tv.verse) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text });
        map.set(tv.verse, existing);
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
      const setter = isHebrew ? setHebrewFontSize : setGreekFontSize;
      setter((prev) => Math.min(2.5, Math.max(0.875, Math.round((prev + delta) * 1000) / 1000)));
    } else {
      setTranslationFontSize((prev) => Math.min(1.5, Math.max(0.625, Math.round((prev + delta) * 1000) / 1000)));
    }
  }

  function handleSelectWord(word: Word, shiftHeld = false) {
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
    return handleToggleParagraphBreakById(wordId, textSource);
  }

  // Called when a translation word is clicked in paragraph-editing mode.
  function handleToggleTranslationParagraphBreak(wordId: string, abbr: string) {
    return handleToggleParagraphBreakById(wordId, abbr);
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
        character2Id: null, textSource: source, book, chapter,
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
      else next.set(wordId, { id: -1, wordId, tagId: activeWordTagId!, textSource: source, book, chapter });
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
      createdAt: new Date().toISOString(),
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
          textSource: firstWordSource, book, chapter,
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
      textSource, book, chapter,
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
      createdAt: new Date().toISOString(),
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

  // ── Indent handler ────────────────────────────────────────────────────────

  async function handleSetIndent(paraStartWordId: string, level: number) {
    const prevLevel = lineIndentMap.get(paraStartWordId) ?? 0;
    // Optimistic update
    setLineIndentMap((prev) => {
      const next = new Map(prev);
      if (level <= 0) next.delete(paraStartWordId);
      else next.set(paraStartWordId, level);
      return next;
    });
    try {
      await fetch("/api/line-indents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: paraStartWordId, indentLevel: level, textSource, book, chapter }),
      });
    } catch {
      // Rollback on error
      setLineIndentMap((prev) => {
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

  // ── Clause relationship handlers ──────────────────────────────────────────
  function handleSelectSegment(wordId: string) {
    if (!relFromSegWordId) {
      setRelFromSegWordId(wordId);
    } else if (wordId === relFromSegWordId) {
      setRelFromSegWordId(null); // deselect
    } else {
      setRelToSegWordId(wordId);
      setShowRelPicker(true);
    }
  }

  async function handleCreateRelationship(relType: string) {
    if (!relFromSegWordId || !relToSegWordId) return;
    const resp = await fetch("/api/clause-relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromSegWordId: relFromSegWordId,
        toSegWordId:   relToSegWordId,
        relType,
        book,
        chapter,
        source: textSource,
      }),
    });
    const { relationship } = await resp.json();
    setClauseRelationships((prev) => [...prev, relationship]);
    setRelFromSegWordId(null);
    setRelToSegWordId(null);
    setShowRelPicker(false);
  }

  function handleCancelRelPicker() {
    setShowRelPicker(false);
    setRelFromSegWordId(null);
    setRelToSegWordId(null);
  }

  async function handleDeleteClauseRelationship(id: number) {
    await fetch("/api/clause-relationships", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setClauseRelationships((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Word arrow handlers ────────────────────────────────────────────────────
  async function handleSelectArrowWord(word: Word) {
    if (!arrowFromWordId) {
      setArrowFromWordId(word.wordId);
      return;
    }
    if (arrowFromWordId === word.wordId) {
      setArrowFromWordId(null);
      return;
    }
    const resp = await fetch("/api/word-arrows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromWordId: arrowFromWordId,
        toWordId:   word.wordId,
        book,
        chapter,
        source: textSource,
      }),
    });
    const { arrow } = await resp.json();
    setWordArrowsState((prev) => [...prev, arrow]);
    setArrowFromWordId(null);
  }

  async function handleDeleteWordArrow(id: number) {
    await fetch("/api/word-arrows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setWordArrowsState((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Word formatting (bold / italic) handler ────────────────────────────────

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
  async function handleUpdateTranslationVerse(abbr: string, verse: number, newText: string) {
    const translation = availableTranslations.find((t) => t.abbreviation === abbr);
    if (!translation) return;
    const tvRecord = localTranslationVerseData[translation.id]?.find((tv) => tv.verse === verse);
    if (!tvRecord) return;

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
          tv.verse === verse ? { ...tv, text: tvRecord.text } : tv
        ),
      }));
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Main text area */}
      <div className="flex-1 relative min-h-0 flex flex-col" ref={outerRef}>
        {/* WordArrowOverlay stays in outerRef (unchanged) */}
        <WordArrowOverlay
          arrows={wordArrowsState}
          containerRef={textContainerRef}
          outerRef={outerRef}
          editing={editingArrows}
          selectedFromWordId={arrowFromWordId}
          onDeleteArrow={handleDeleteWordArrow}
        />
        {/* Scrollable text container — ClauseRelationshipOverlay lives INSIDE so it scrolls
            with the content and uses stable content-relative coordinates. */}
        <div
          className="flex-1 overflow-y-auto relative flex flex-col min-h-0"
          ref={textContainerRef}
        >
          <ClauseRelationshipOverlay
            relationships={clauseRelationships}
            containerRef={textContainerRef}
            isHebrew={isHebrew}
            hasTranslation={hasActiveTranslations}
            hasSource={!hideSourceText}
            editing={editingRelationships}
            paragraphFirstWordIds={paragraphFirstWordIds}
            selectedSegWordId={relFromSegWordId}
            onSelectSegment={handleSelectSegment}
            onDeleteRelationship={handleDeleteClauseRelationship}
          />
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-6 py-3 flex items-center gap-4 flex-wrap">
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
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              showTooltips
                ? "bg-blue-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            Tooltips
          </button>

          {/* Paragraph edit mode toggle */}
          <button
            onClick={() => setEditingParagraphs((v) => !v)}
            title={editingParagraphs
              ? "Exit paragraph edit mode"
              : "Enter paragraph edit mode — click any word to start/remove a paragraph there"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingParagraphs
                ? "bg-amber-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ¶
          </button>

          {/* Character reference tag mode */}
          <button
            onClick={() => {
              setEditingRefs((v) => !v);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setPendingWordTag(false);
              setSpeechRangeStart(null);
            }}
            title={editingRefs ? "Exit reference tagging" : "Tag words as referring to a character"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRefs
                ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            👤
          </button>

          {/* Speech section tag mode */}
          <button
            onClick={() => {
              setEditingSpeech((v) => !v);
              setEditingRefs(false);
              setEditingWordTags(false);
              setPendingWordTag(false);
              setSpeechRangeStart(null);
            }}
            title={editingSpeech
              ? "Exit speech tagging"
              : "Mark word ranges as spoken by a character (two clicks: start then end)"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingSpeech
                ? "bg-violet-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            💬
          </button>

          {/* Word / concept tag mode */}
          <button
            onClick={() => {
              setEditingWordTags((v) => !v);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingIndents(false);
              setSpeechRangeStart(null);
              setPendingWordTag(false);
            }}
            title={editingWordTags
              ? "Exit word/concept tag mode"
              : "Tag words or concepts with colour highlights"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingWordTags
                ? "bg-yellow-500 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            🏷
          </button>

          {/* Paragraph indent mode */}
          <button
            onClick={() => {
              setEditingIndents((v) => !v);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setSpeechRangeStart(null);
              setPendingWordTag(false);
            }}
            title={editingIndents
              ? "Exit indent mode"
              : "Indent paragraphs to indicate subordinate clauses (use − / + next to the paragraph label)"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingIndents
                ? "bg-teal-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ↳
          </button>

          {/* Clause relationship mode */}
          <button
            onClick={() => {
              setEditingRelationships((v) => !v);
              setEditingArrows(false);
              setArrowFromWordId(null);
              setRelFromSegWordId(null);
              setShowRelPicker(false);
            }}
            title={editingRelationships
              ? "Exit clause relationship mode"
              : "Mark logical relationships between paragraph segments"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingRelationships
                ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ⤢
          </button>

          {/* Word arrow mode */}
          <button
            onClick={() => {
              setEditingArrows((v) => !v);
              setEditingRelationships(false);
              setRelFromSegWordId(null);
              setShowRelPicker(false);
              setArrowFromWordId(null);
            }}
            title={editingArrows
              ? "Exit word arrow mode"
              : "Draw free-form arrows between words"}
            className={[
              "px-2.5 py-1 rounded text-xs font-medium transition-colors",
              editingArrows
                ? "bg-rose-600 text-white"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            ↗
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
              title={`Undo: ${undoStack[undoStack.length - 1].label} (Ctrl/Cmd+Z)`}
              className="px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
            >
              ↩ {undoStack[undoStack.length - 1].label}
            </button>
          )}

          {/* Bold formatting mode */}
          <button
            onClick={() => {
              setEditingBold((v) => !v);
              setEditingParagraphs(false);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setEditingIndents(false);
              setEditingRelationships(false);
              setEditingArrows(false);
              setSpeechRangeStart(null);
              setRelFromSegWordId(null);
              setArrowFromWordId(null);
            }}
            title={editingBold ? "Exit bold mode" : "Click words to toggle bold"}
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
              setEditingItalic((v) => !v);
              setEditingParagraphs(false);
              setEditingRefs(false);
              setEditingSpeech(false);
              setEditingWordTags(false);
              setEditingIndents(false);
              setEditingRelationships(false);
              setEditingArrows(false);
              setSpeechRangeStart(null);
              setRelFromSegWordId(null);
              setArrowFromWordId(null);
            }}
            title={editingItalic ? "Exit italic mode" : "Click words to toggle italic"}
            className={[
              "px-2.5 py-1 rounded text-xs italic transition-colors",
              editingItalic
                ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
            ].join(" ")}
          >
            I
          </button>

          {/* Linguistic terms toggle — Hebrew only */}
          {isHebrew && (
            <button
              onClick={() => setUseLinguisticTerms((v) => !v)}
              title={useLinguisticTerms
                ? "Show descriptive aspect names (Perfect, Imperfect…)"
                : "Show linguistic terms (Qatal, Yiqtol, Wayyiqtol, Weqatal)"}
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

          {/* Translation toggles + source visibility toggle + translation edit */}
          {availableTranslations.length > 0 && (
            <div className="flex items-center gap-1 border-l border-[var(--border)] pl-4">
              <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">
                Translations:
              </span>
              {/* Source text visibility — shown only when a translation is active */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setHideSourceText((v) => !v)}
                  title={hideSourceText ? `Show ${textSource} text` : `Hide ${textSource} text`}
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
              {/* Translation text edit mode */}
              {hasActiveTranslations && (
                <button
                  onClick={() => setEditingTranslation((v) => !v)}
                  title={editingTranslation ? "Exit translation edit mode" : "Edit translation text"}
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
              {availableTranslations.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggleTranslation(t.id)}
                  title={t.name}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium font-mono transition-colors",
                    activeTranslationIds.has(t.id)
                      ? "bg-emerald-600 text-white"
                      : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
                  ].join(" ")}
                >
                  {t.abbreviation}
                </button>
              ))}
            </div>
          )}

          {/* Font size controls */}
          {(() => {
            const sizeBtn = "w-6 h-6 flex items-center justify-center rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors select-none";
            return (
              <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
                <span className="text-xs text-stone-400 dark:text-stone-500 select-none">
                  {isHebrew ? "Heb" : "Grk"}
                </span>
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
            Click a source word to name this tag by its lemma
          </div>
        )}

        {/* Clause relationship hint */}
        {editingRelationships && !showRelPicker && (
          <div className="px-6 py-1 text-xs border-b border-[var(--border)] text-stone-500 dark:text-stone-400"
               style={{ backgroundColor: "var(--nav-bg)" }}>
            {relFromSegWordId
              ? "Click a second segment dot to choose a relationship type"
              : "Click a segment dot (◉) in the margin to start a relationship"}
          </div>
        )}

        {/* Relationship type picker bar */}
        {showRelPicker && (
          <div
            className="border-b border-[var(--border)] px-4 py-2 flex flex-wrap gap-1.5 items-center shrink-0"
            style={{ backgroundColor: "var(--nav-bg)" }}
          >
            <span className="text-xs font-medium mr-1" style={{ color: "var(--nav-fg-muted)" }}>
              Relationship:
            </span>
            <span className="text-xs opacity-50 mr-0.5 select-none">Coord.</span>
            {RELATIONSHIP_TYPES.filter((r) => r.category === "coordinate").map((r) => (
              <button
                key={r.key}
                onClick={() => handleCreateRelationship(r.key)}
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
                onClick={() => handleCreateRelationship(r.key)}
                className="px-2 py-0.5 rounded text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: r.color }}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={handleCancelRelPicker}
              className="ml-auto text-xs px-2 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
            >
              Cancel
            </button>
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

        {/* Chapter text */}
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
                wordTagRefMap={wordTagRefMap}
                wordTagMap={wordTagMap}
                editingWordTags={editingWordTags}
                highlightWordTagIds={highlightWordTagIds}
                lineIndentMap={lineIndentMap}
                wordToParaStart={wordToParaStart}
                editingIndents={editingIndents}
                onSetSegmentIndent={handleSetIndent}
                wordFormattingMap={wordFormattingMap}
                editingFormatting={editingBold || editingItalic}
                hideSourceText={hideSourceText}
                editingTranslation={editingTranslation}
                onUpdateTranslationVerse={handleUpdateTranslationVerse}
              />
            );
          })}
        </div>
      </div>
      </div> {/* end outerRef wrapper */}

      {/* Morphology panel */}
      {panelOpen && (
        <div className="w-72 border-l border-[var(--border)] flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
              Word Analysis
            </h2>
            <button
              onClick={() => setPanelOpen(false)}
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <MorphologyPanel word={selectedWord} useLinguisticTerms={useLinguisticTerms} />
          </div>
        </div>
      )}
    </div>
  );
}
