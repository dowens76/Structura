"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  Passage, Word,
  Character, CharacterRef, SpeechSection, WordTag, WordTagRef,
  Translation, TranslationVerse,
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
import hebrewLemmas from "@/lib/data/hebrew-lemmas.json";

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
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Passage state ─────────────────────────────────────────────────────────
  const [passage, setPassage] = useState(initialPassage);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(initialPassage.label);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (editingLabel) labelInputRef.current?.select();
  }, [editingLabel]);

  useEffect(() => {
    if (!editingLabel) setLabelDraft(initialPassage.label);
    setPassage(initialPassage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPassage.id]);

  // ── Display / reading settings ────────────────────────────────────────────
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
    readLocal<DisplayMode>("structura:displayMode", "clean")
  );
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showTooltips, setShowTooltips] = useState(false);
  const [activeTranslationAbbrs, setActiveTranslationAbbrs] = useState<Set<string>>(() =>
    new Set(readLocal<string[]>("structura:activeTranslations", []))
  );
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [useLinguisticTerms, setUseLinguisticTerms] = useState(() =>
    readLocal<boolean>("structura:useLinguisticTerms", false)
  );
  const [hebrewFontSize, setHebrewFontSize] = useState(() =>
    readLocal<number>("structura:hebrewFontSize", 1.375)
  );
  const [greekFontSize, setGreekFontSize] = useState(() =>
    readLocal<number>("structura:greekFontSize", 1.25)
  );
  const [translationFontSize, setTranslationFontSize] = useState(() =>
    readLocal<number>("structura:translationFontSize", 0.875)
  );

  // Persist sticky settings
  useEffect(() => { writeLocal("structura:displayMode", displayMode); }, [displayMode]);
  useEffect(() => { writeLocal("structura:useLinguisticTerms", useLinguisticTerms); }, [useLinguisticTerms]);
  useEffect(() => { writeLocal("structura:hebrewFontSize", hebrewFontSize); }, [hebrewFontSize]);
  useEffect(() => { writeLocal("structura:greekFontSize", greekFontSize); }, [greekFontSize]);
  useEffect(() => { writeLocal("structura:translationFontSize", translationFontSize); }, [translationFontSize]);

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
    () => new Map(initialLineIndents.map((li) => [li.wordId, li.indentLevel]))
  );
  const [editingIndents, setEditingIndents] = useState(false);

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
  const wordToParaStart = useMemo(() => {
    const map = new Map<string, string>();
    let currentStart = words[0]?.wordId ?? "";
    for (const word of words) {
      if (paragraphBreakIds.has(word.wordId)) currentStart = word.wordId;
      map.set(word.wordId, currentStart);
    }
    return map;
  }, [words, paragraphBreakIds]);

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
      for (const tv of translationVerseData[t.id] ?? []) {
        const key = `${tv.chapter}:${tv.verse}`;
        const existing = map.get(key) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text });
        map.set(key, existing);
      }
    }
    return map;
  }, [activeTranslationIds, availableTranslations, translationVerseData]);

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

  // ── Label save ────────────────────────────────────────────────────────────
  async function saveLabel() {
    const trimmed = labelDraft.trim();
    setPassage((p) => ({ ...p, label: trimmed }));
    setEditingLabel(false);
    await fetch(`/api/passages/${passage.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: trimmed }),
    });
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
    if (editingParagraphs) { handleToggleParagraphBreak(word.wordId); return; }
    if (editingRefs) { if (activeCharId === null) return; handleToggleCharacterRef(word); return; }
    if (editingSpeech) { if (activeCharId === null) return; handleToggleSpeechSection(word, shiftHeld); return; }
    if (editingWordTags) { handleToggleWordTagRef(word); return; }
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
    return handleToggleCharacterRefById(word.wordId, textSource);
  }

  function handleSelectTranslationWord(wordId: string, abbr: string) {
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

  // ── Indent handler ────────────────────────────────────────────────────────
  async function handleSetIndent(paraStartWordId: string, level: number) {
    const wordChapter = wordToChapter.get(paraStartWordId) ?? passage.startChapter;
    const prevLevel = lineIndentMap.get(paraStartWordId) ?? 0;
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
        body: JSON.stringify({ wordId: paraStartWordId, indentLevel: level, textSource, book: osisBook, chapter: wordChapter }),
      });
    } catch {
      setLineIndentMap((prev) => {
        const next = new Map(prev);
        if (prevLevel <= 0) next.delete(paraStartWordId);
        else next.set(paraStartWordId, prevLevel);
        return next;
      });
    }
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
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

        {/* ── Passage header ──────────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)" }}>

          {/* Label row */}
          <div className="flex items-start gap-3 mb-3">
            <span className="text-lg select-none mt-0.5" style={{ color: "var(--accent)" }}>📖</span>

            {editingLabel ? (
              <input
                ref={labelInputRef}
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={saveLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLabel();
                  if (e.key === "Escape") { setLabelDraft(passage.label); setEditingLabel(false); }
                }}
                placeholder="Passage label…"
                className="flex-1 text-xl font-bold bg-transparent border-b-2 outline-none"
                style={{
                  color: "var(--foreground)",
                  borderColor: "var(--accent)",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => { setLabelDraft(passage.label); setEditingLabel(true); }}
                className="flex-1 text-left text-xl font-bold hover:opacity-70 transition-opacity"
                style={{
                  color: passage.label ? "var(--foreground)" : "var(--text-muted)",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                }}
                title="Click to edit label"
              >
                {passage.label || "Untitled passage — click to add label"}
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

          {/* Range reference */}
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {rangeLabel}
            {isPending && <span className="ml-2 text-xs opacity-50">updating…</span>}
          </p>

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

        {/* ── Sticky toolbar ───────────────────────────────────────────────── */}
        <div className="shrink-0 sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-6 py-3 flex items-center gap-4 flex-wrap">
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
          >↳</button>

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

        {/* ── Passage text ─────────────────────────────────────────────────── */}
        {words.length === 0 ? (
          <p className="px-6 py-6 text-sm italic" style={{ color: "var(--text-muted)" }}>
            No words found for this range.
          </p>
        ) : (
          <div
            className={`px-6 py-6 flex-1 ${hasActiveTranslations ? "" : "max-w-3xl mx-auto w-full"}`}
            style={{
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
                    wordTagRefMap={wordTagRefMap}
                    wordTagMap={wordTagMap}
                    editingWordTags={editingWordTags}
                    highlightWordTagIds={highlightWordTagIds}
                    lineIndentMap={lineIndentMap}
                    wordToParaStart={wordToParaStart}
                    editingIndents={editingIndents}
                    onSetSegmentIndent={handleSetIndent}
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
    </div>
  );
}
