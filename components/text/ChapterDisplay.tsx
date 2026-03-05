"use client";

import { useMemo, useState, useEffect } from "react";
import type { Word, Character, CharacterRef, SpeechSection } from "@/lib/db/schema";
import type { Translation, TranslationVerse } from "@/lib/db/schema";
import type { DisplayMode, GrammarFilterState, TranslationTextEntry } from "@/lib/morphology/types";
import VerseDisplay from "./VerseDisplay";
import MorphologyPanel from "./MorphologyPanel";
import GrammarFilter from "@/components/controls/GrammarFilter";
import DisplayModeToggle from "@/components/controls/DisplayModeToggle";
import ColorRulePanel from "@/components/controls/ColorRulePanel";
import CharacterPanel from "@/components/controls/CharacterPanel";
import type { ColorRule } from "@/lib/morphology/colorRules";

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
}

const DEFAULT_FILTER: GrammarFilterState = {
  noun: true, verb: true, adjective: true, adverb: true,
  preposition: true, conjunction: true, pronoun: true,
  particle: true, article: true, interjection: true,
};

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
}: ChapterDisplayProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>("clean");
  const [grammarFilter, setGrammarFilter] = useState<GrammarFilterState>(DEFAULT_FILTER);
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showTooltips, setShowTooltips] = useState(false);
  const [activeTranslationIds, setActiveTranslationIds] = useState<Set<number>>(new Set());
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
      const verses = translationVerseData[t.id] ?? [];
      for (const tv of verses) {
        const existing = map.get(tv.verse) ?? [];
        existing.push({ abbr: t.abbreviation, text: tv.text });
        map.set(tv.verse, existing);
      }
    }
    return map;
  }, [activeTranslationIds, availableTranslations, translationVerseData]);

  const hasActiveTranslations = activeTranslationIds.size > 0;

  function toggleTranslation(id: number) {
    setActiveTranslationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  // Called when a translation word is clicked in refs-editing mode.
  function handleSelectTranslationWord(wordId: string, abbr: string) {
    if (!editingRefs || activeCharId === null) return;
    handleToggleCharacterRefById(wordId, abbr);
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

    // Snap to whole-verse boundaries: a speech section always begins at a
    // verse's first word and ends at a verse's last word.
    const clickedVerseWords = verseGroups.get(word.verse) ?? [word];

    // First click: record the first word of this verse as range start
    if (!speechRangeStart) {
      setSpeechRangeStart(clickedVerseWords[0]);
      return;
    }

    // Second click: compute the full verse-aligned range then clear the start marker
    const startVerseWords = verseGroups.get(speechRangeStart.verse) ?? [speechRangeStart];
    const posMap = new Map(words.map((w, i) => [w.wordId, i]));
    const startVerseFirstPos = posMap.get(startVerseWords[0].wordId) ?? 0;
    const endVerseFirstPos   = posMap.get(clickedVerseWords[0].wordId) ?? 0;

    let orderedStart: string;
    let orderedEnd: string;
    if (startVerseFirstPos <= endVerseFirstPos) {
      // Forward: first-clicked verse → second-clicked verse
      orderedStart = startVerseWords[0].wordId;
      orderedEnd   = clickedVerseWords[clickedVerseWords.length - 1].wordId;
    } else {
      // Backward: second-clicked verse is earlier, swap so DB range is ordered
      orderedStart = clickedVerseWords[0].wordId;
      orderedEnd   = startVerseWords[startVerseWords.length - 1].wordId;
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

  return (
    <div className="flex h-full min-h-0">
      {/* Main text area */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
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

          {/* Translation toggles */}
          {availableTranslations.length > 0 && (
            <div className="flex items-center gap-1 border-l border-[var(--border)] pl-4">
              <span className="text-xs text-stone-400 dark:text-stone-500 mr-1 select-none">
                Translations:
              </span>
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
            Start verse set — now click any word in the end verse to complete the speech section
          </div>
        )}

        {/* Chapter text */}
        <div
          className={`px-6 py-6 flex-1 ${hasActiveTranslations ? "" : "max-w-3xl mx-auto w-full"}`}
          style={{
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
              />
            );
          })}
        </div>
      </div>

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
