"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PoetryNotation } from "@/lib/db/schema";
import type { PoetryPrinciple, BalanceSubtype, ClosureSubtype, ImbalanceDirection, RequirednessSubtype } from "@/lib/poetry/constants";

export interface GraphemeAnchor {
  wordId: string;
  graphemeIndex: number;
  /** The "line" (source paragraph-segment first-wordId) this anchor belongs
   *  to, supplied by the caller rather than re-derived — a translation word's
   *  own id can't be looked up in wordToParaStart (a source-only map), but
   *  VerseDisplay already knows which source line's row a translation token
   *  renders in and passes that same id through for both cases. */
  segFirstWordId: string;
}

export interface UsePoetryNotationsOptions {
  initialPoetryNotations: PoetryNotation[];
  /** Resolves any wordId — a source Word.wordId OR a `tv:ABBR:Book.Ch.V.wi`
   *  translation-token id — to the {textSource, book, chapter} a mark
   *  anchored there should be persisted under. For translation words this is
   *  the translation's own abbreviation (matching how wordFormatting/
   *  characterRefs already store translation-anchored rows), not the page's
   *  source-language textSource — see ChapterDisplay.tsx's resolveWordSource. */
  resolveWordSource: (wordId: string) => { textSource: string; book: string; chapter: number };
  /** Chapter-wide word order index, used to order arbitrary (non-segment-
   *  snapped) ranges regardless of click order — same approach as the
   *  Synoptic word-compare feature. Only resolves source Word ids; a missing
   *  entry (e.g. a translation word) falls back to trusting click order. */
  wordIndexMap: Map<string, number>;
}

export interface UsePoetryNotationsReturn {
  poetryNotations: PoetryNotation[];
  setPoetryNotations: Dispatch<SetStateAction<PoetryNotation[]>>;
  editingPoetryNotation: boolean;
  setEditingPoetryNotation: Dispatch<SetStateAction<boolean>>;
  activePrinciple: PoetryPrinciple;
  setActivePrinciple: Dispatch<SetStateAction<PoetryPrinciple>>;
  activeBalanceSubtype: BalanceSubtype;
  setActiveBalanceSubtype: Dispatch<SetStateAction<BalanceSubtype>>;
  activeImbalanceDirection: ImbalanceDirection;
  setActiveImbalanceDirection: Dispatch<SetStateAction<ImbalanceDirection>>;
  activeClosureSubtype: ClosureSubtype;
  setActiveClosureSubtype: Dispatch<SetStateAction<ClosureSubtype>>;
  activeRequirednessSubtype: RequirednessSubtype;
  setActiveRequirednessSubtype: Dispatch<SetStateAction<RequirednessSubtype>>;

  editingNotationId: number | null;
  setEditingNotationId: Dispatch<SetStateAction<number | null>>;

  symmetryLineA: string | null;
  balanceLineA: string | null;
  similarityStart: GraphemeAnchor | null;
  closureRangeStart: string | null;
  requirednessRangeStart: string | null;

  /** Clears every pending (mid-selection) state — called when leaving poetry
   *  edit mode or switching which principle/sub-tool is active. */
  clearPending: () => void;

  handleWordClick: (wordId: string) => void;
  handleLineClick: (segFirstWordId: string) => void;
  handleSymmetryLineClick: (segFirstWordId: string) => void;
  handleGraphemeClick: (wordId: string, graphemeIndex: number, shiftHeld: boolean, segFirstWordId: string) => void;
  handleClosureWordClick: (wordId: string, shiftHeld: boolean) => void;
  handleClosureLineClick: (segFirstWordId: string) => void;
  handleRequirednessWordClick: (wordId: string, shiftHeld: boolean) => void;

  handleUpdateNote: (id: number, note: string | null) => Promise<void>;
  handleDeleteNotation: (id: number) => Promise<void>;
}

export function usePoetryNotations({
  initialPoetryNotations,
  resolveWordSource,
  wordIndexMap,
}: UsePoetryNotationsOptions): UsePoetryNotationsReturn {
  const [poetryNotations, setPoetryNotations] = useState<PoetryNotation[]>(initialPoetryNotations);
  const [editingPoetryNotation, setEditingPoetryNotation] = useState(false);
  const [activePrinciple, setActivePrinciple] = useState<PoetryPrinciple>("continuation");
  const [activeBalanceSubtype, setActiveBalanceSubtype] = useState<BalanceSubtype>("balance");
  const [activeImbalanceDirection, setActiveImbalanceDirection] = useState<ImbalanceDirection>("right");
  const [activeClosureSubtype, setActiveClosureSubtype] = useState<ClosureSubtype>("weak");
  const [activeRequirednessSubtype, setActiveRequirednessSubtype] = useState<RequirednessSubtype>("arrow");
  const [editingNotationId, setEditingNotationId] = useState<number | null>(null);

  const [symmetryLineA, setSymmetryLineA] = useState<string | null>(null);
  const [balanceLineA, setBalanceLineA] = useState<string | null>(null);
  const [similarityStart, setSimilarityStart] = useState<GraphemeAnchor | null>(null);
  const [closureRangeStart, setClosureRangeStart] = useState<string | null>(null);
  const [requirednessRangeStart, setRequirednessRangeStart] = useState<string | null>(null);

  function clearPending() {
    setSymmetryLineA(null);
    setBalanceLineA(null);
    setSimilarityStart(null);
    setClosureRangeStart(null);
    setRequirednessRangeStart(null);
    setEditingNotationId(null);
  }

  async function createNotation(fields: {
    principle: PoetryPrinciple;
    subtype?: string | null;
    direction?: string | null;
    startWordId: string;
    endWordId?: string | null;
    startGraphemeIndex?: number | null;
    endGraphemeIndex?: number | null;
  }) {
    const { textSource, book, chapter } = resolveWordSource(fields.startWordId);
    const tempId = -Date.now();
    const optimistic: PoetryNotation = {
      id: tempId,
      workspaceId: 1,
      versionId: 0,
      principle: fields.principle,
      subtype: fields.subtype ?? null,
      direction: fields.direction ?? null,
      startWordId: fields.startWordId,
      endWordId: fields.endWordId ?? null,
      startGraphemeIndex: fields.startGraphemeIndex ?? null,
      endGraphemeIndex: fields.endGraphemeIndex ?? null,
      note: null,
      textSource,
      book,
      chapter,
      createdAt: null,
    };
    setPoetryNotations((prev) => [...prev, optimistic]);
    try {
      const resp = await fetch("/api/poetry-notations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, book, chapter, source: textSource }),
      });
      if (!resp.ok) throw new Error("save failed");
      const { notation } = await resp.json();
      setPoetryNotations((prev) => prev.map((n) => (n.id === tempId ? notation : n)));
      setEditingNotationId(notation.id);
    } catch {
      setPoetryNotations((prev) => prev.filter((n) => n.id !== tempId));
    }
  }

  function findWordMark(principle: PoetryPrinciple, wordId: string): PoetryNotation | undefined {
    return poetryNotations.find((n) => n.principle === principle && n.startWordId === wordId);
  }

  // ── Continuation / Requiredness — single word anchor ──────────────────────
  function handleWordClick(wordId: string) {
    const existing = findWordMark(activePrinciple, wordId);
    if (existing) {
      setEditingNotationId(existing.id);
      return;
    }
    createNotation({ principle: activePrinciple, startWordId: wordId });
  }

  // ── Balance/Imbalance — two-line, mirrors Symmetry's click-order-preserved
  // pair picking. A mark's "=" renders vertically centered between the two
  // lines' text areas, with a bracket spanning from the top of the earlier
  // line to the bottom of the later one (see PoetryMarginOverlay) — so a click on
  // EITHER line of an existing pair reopens it for editing. ─────────────────
  function handleLineClick(segFirstWordId: string) {
    const existing = poetryNotations.find(
      (n) => n.principle === "balance" && (n.startWordId === segFirstWordId || n.endWordId === segFirstWordId)
    );
    if (existing) {
      setEditingNotationId(existing.id);
      return;
    }
    if (!balanceLineA) {
      setBalanceLineA(segFirstWordId);
      return;
    }
    if (segFirstWordId === balanceLineA) {
      setBalanceLineA(null);
      return;
    }
    const a = balanceLineA;
    setBalanceLineA(null);
    createNotation({
      principle: "balance",
      subtype: activeBalanceSubtype,
      direction: activeBalanceSubtype === "imbalance" ? activeImbalanceDirection : null,
      startWordId: a,
      endWordId: segFirstWordId,
    });
  }

  // ── Symmetry — two-line, click-order preserved (order = triangle orientation) ─
  function handleSymmetryLineClick(segFirstWordId: string) {
    if (!symmetryLineA) {
      setSymmetryLineA(segFirstWordId);
      return;
    }
    if (segFirstWordId === symmetryLineA) {
      setSymmetryLineA(null);
      return;
    }
    const a = symmetryLineA;
    setSymmetryLineA(null);
    createNotation({ principle: "symmetry", startWordId: a, endWordId: segFirstWordId });
  }

  // ── Similarity — letter-range within one line ──────────────────────────────
  // `wordId` is either a source Word.wordId or a `tv:ABBR:...` translation-
  // token id; `segFirstWordId` (always a source line id) is supplied by the
  // caller for both cases, since translation words don't resolve through
  // wordToParaStart themselves.
  function handleGraphemeClick(wordId: string, graphemeIndex: number, shiftHeld: boolean, segFirstWordId: string) {
    if (!similarityStart) {
      setSimilarityStart({ wordId, graphemeIndex, segFirstWordId });
      return;
    }
    if (!shiftHeld) {
      // Plain click while a start is pending restarts the selection.
      setSimilarityStart({ wordId, graphemeIndex, segFirstWordId });
      return;
    }
    // Shift-click must land in the same line as the pending start, per the
    // spec — a different-line shift-click is a silent no-op, leaving the
    // pending start selection intact.
    if (segFirstWordId !== similarityStart.segFirstWordId) return;

    if (similarityStart.wordId === wordId) {
      // Same word (the common case): order purely by grapheme index.
      const [startIdx, endIdx] = similarityStart.graphemeIndex <= graphemeIndex
        ? [similarityStart.graphemeIndex, graphemeIndex]
        : [graphemeIndex, similarityStart.graphemeIndex];
      setSimilarityStart(null);
      createNotation({ principle: "similarity", startWordId: wordId, endWordId: wordId, startGraphemeIndex: startIdx, endGraphemeIndex: endIdx });
      return;
    }

    // Spans two adjacent words in the same line. wordIndexMap only resolves
    // source Word ids — if either endpoint is a translation token (or the
    // lookup otherwise misses), fall back to trusting click order instead of
    // silently dropping the selection.
    const startPos = wordIndexMap.get(similarityStart.wordId);
    const endPos = wordIndexMap.get(wordId);
    const [startWordId, startIdx, endWordId, endIdx] =
      startPos !== undefined && endPos !== undefined && startPos > endPos
        ? [wordId, graphemeIndex, similarityStart.wordId, similarityStart.graphemeIndex]
        : [similarityStart.wordId, similarityStart.graphemeIndex, wordId, graphemeIndex];
    setSimilarityStart(null);
    createNotation({
      principle: "similarity",
      startWordId,
      endWordId,
      startGraphemeIndex: startIdx,
      endGraphemeIndex: endIdx,
    });
  }

  // ── Closure (weak) — arbitrary word range, chapter-ordered ─────────────────
  // wordId may be a source Word.wordId or a translation `tv:...` token id —
  // wordIndexMap only resolves the former, so a covering-range search or an
  // ordering comparison that can't resolve both endpoints falls back to
  // exact-match / click-order rather than silently missing a match.
  // First click always anchors the pending start. From there, same as
  // Similarity's grapheme-range picking: a plain click re-anchors the start
  // to the newly clicked word, while a SHIFT-click completes the range —
  // click the first word, shift-click the last. Clicking the SAME word again
  // (with or without shift) also completes the selection, as a single-word
  // range — a second plain click on the pending start no longer re-anchors
  // it to itself (a no-op the user had no way to escape from without shift).
  function handleClosureWordClick(wordId: string, shiftHeld: boolean) {
    if (!closureRangeStart) {
      const covering = poetryNotations.find((n) => {
        if (n.principle !== "closure" || n.subtype !== "weak" || !n.endWordId) return false;
        if (n.startWordId === wordId || n.endWordId === wordId) return true;
        const lo = wordIndexMap.get(n.startWordId);
        const hi = wordIndexMap.get(n.endWordId);
        const pos = wordIndexMap.get(wordId);
        if (lo === undefined || hi === undefined || pos === undefined) return false;
        return pos >= Math.min(lo, hi) && pos <= Math.max(lo, hi);
      });
      if (covering) {
        setEditingNotationId(covering.id);
        return;
      }
      setClosureRangeStart(wordId);
      return;
    }
    if (wordId === closureRangeStart) {
      setClosureRangeStart(null);
      createNotation({ principle: "closure", subtype: "weak", startWordId: wordId, endWordId: wordId });
      return;
    }
    if (!shiftHeld) {
      setClosureRangeStart(wordId);
      return;
    }
    const startPos = wordIndexMap.get(closureRangeStart);
    const endPos = wordIndexMap.get(wordId);
    const [startWordId, endWordId] =
      startPos !== undefined && endPos !== undefined && startPos > endPos
        ? [wordId, closureRangeStart]
        : [closureRangeStart, wordId];
    setClosureRangeStart(null);
    createNotation({ principle: "closure", subtype: "weak", startWordId, endWordId });
  }

  // ── Requiredness (underline) — arbitrary word range, chapter-ordered ───────
  // Same range-picking UX as Closure (weak): first click anchors the pending
  // start, a plain click re-anchors it, a SHIFT-click completes the range.
  function handleRequirednessWordClick(wordId: string, shiftHeld: boolean) {
    if (!requirednessRangeStart) {
      const covering = poetryNotations.find((n) => {
        if (n.principle !== "requiredness" || n.subtype !== "underline" || !n.endWordId) return false;
        if (n.startWordId === wordId || n.endWordId === wordId) return true;
        const lo = wordIndexMap.get(n.startWordId);
        const hi = wordIndexMap.get(n.endWordId);
        const pos = wordIndexMap.get(wordId);
        if (lo === undefined || hi === undefined || pos === undefined) return false;
        return pos >= Math.min(lo, hi) && pos <= Math.max(lo, hi);
      });
      if (covering) {
        setEditingNotationId(covering.id);
        return;
      }
      setRequirednessRangeStart(wordId);
      return;
    }
    if (!shiftHeld) {
      setRequirednessRangeStart(wordId);
      return;
    }
    const startPos = wordIndexMap.get(requirednessRangeStart);
    const endPos = wordIndexMap.get(wordId);
    const [startWordId, endWordId] =
      startPos !== undefined && endPos !== undefined && startPos > endPos
        ? [wordId, requirednessRangeStart]
        : [requirednessRangeStart, wordId];
    setRequirednessRangeStart(null);
    createNotation({ principle: "requiredness", subtype: "underline", startWordId, endWordId });
  }

  // ── Closure (complete) — one mark per line ──────────────────────────────────
  function handleClosureLineClick(segFirstWordId: string) {
    const existing = poetryNotations.find(
      (n) => n.principle === "closure" && n.subtype === "complete" && n.startWordId === segFirstWordId
    );
    if (existing) {
      setEditingNotationId(existing.id);
      return;
    }
    createNotation({ principle: "closure", subtype: "complete", startWordId: segFirstWordId });
  }

  async function handleUpdateNote(id: number, note: string | null) {
    setPoetryNotations((prev) => prev.map((n) => (n.id === id ? { ...n, note } : n)));
    try {
      await fetch("/api/poetry-notations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      });
    } catch {
      // non-critical
    }
  }

  async function handleDeleteNotation(id: number) {
    setPoetryNotations((prev) => prev.filter((n) => n.id !== id));
    setEditingNotationId((prev) => (prev === id ? null : prev));
    try {
      await fetch("/api/poetry-notations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // non-critical
    }
  }

  return {
    poetryNotations,
    setPoetryNotations,
    editingPoetryNotation,
    setEditingPoetryNotation,
    activePrinciple,
    setActivePrinciple,
    activeBalanceSubtype,
    setActiveBalanceSubtype,
    activeImbalanceDirection,
    setActiveImbalanceDirection,
    activeClosureSubtype,
    setActiveClosureSubtype,
    activeRequirednessSubtype,
    setActiveRequirednessSubtype,
    editingNotationId,
    setEditingNotationId,
    symmetryLineA,
    balanceLineA,
    similarityStart,
    closureRangeStart,
    requirednessRangeStart,
    clearPending,
    handleWordClick,
    handleLineClick,
    handleSymmetryLineClick,
    handleGraphemeClick,
    handleClosureWordClick,
    handleClosureLineClick,
    handleRequirednessWordClick,
    handleUpdateNote,
    handleDeleteNotation,
  };
}
