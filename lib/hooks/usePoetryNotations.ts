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
  /** id of the Requiredness ("arrow") mark currently awaiting a resolved
   *  word/phrase pick — set by the note popover's "Select the word/phrase
   *  that is required" button, consumed by handleRequirednessArrowClick. */
  requirednessResolvingForId: number | null;
  /** First click anchor within that pick (click again on the same word, or
   *  shift-click a different word, to complete it — same range-picking UX
   *  as Closure/Requiredness-underline). */
  requirednessResolvingStart: string | null;
  /** Set by "Add word" in the Similarity note popover — the group id the
   *  NEXT word/letter-range the user picks (anywhere in the chapter) should
   *  be tagged with. Consumed and cleared by handleGraphemeClick. */
  addingToSimilarityGroupId: number | null;

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
  /** Requiredness ("arrow") — a plain click creates (or reopens) a single-
   *  word mark immediately, same as Continuation. While a resolved-range
   *  pick is pending (requirednessResolvingForId), clicks are routed to
   *  that instead — see handleStartRequirednessResolving. */
  handleRequirednessArrowClick: (wordId: string, shiftHeld: boolean) => void;
  /** Starts (or, called again on the same mark, cancels) picking the
   *  word/phrase that resolves `mark`'s requirement — triggered by the note
   *  popover's "Select the word/phrase that is required" button. Closes the
   *  popover so the text underneath is clickable. */
  handleStartRequirednessResolving: (mark: PoetryNotation) => void;
  /** "Add word" — starts (or resumes) a Similarity group so the next word/
   *  letter-range the user picks gets tagged into it. Self-tags an
   *  ungrouped mark with its own id as the group id the first time it's
   *  called on it. Closes the popover (same reasoning as
   *  handleStartRequirednessResolving) so the word being picked is visible
   *  and clickable, and the caller is expected to show a "click a word"
   *  status chip while addingToSimilarityGroupId is set. */
  handleStartAddWordToGroup: (mark: PoetryNotation) => void;
  /** Cancels a pending "Add word" pick without tagging anything — used by
   *  the "click a word to add · Cancel" status chip. */
  handleCancelAddWordToGroup: () => void;

  handleUpdateNote: (id: number, note: string | null) => Promise<void>;
  /** Writes the same note to every id in a Similarity group at once. */
  handleSaveSimilarityNote: (memberIds: number[], note: string | null) => Promise<void>;
  /** Clears a mark's similarityGroupId (auto-ungroup at 1 remaining member). */
  handleUngroupMark: (id: number) => Promise<void>;
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
  const [addingToSimilarityGroupId, setAddingToSimilarityGroupId] = useState<number | null>(null);
  // Requiredness ("arrow")'s resolved-range pick — see handleStartRequirednessResolving.
  const [requirednessResolvingForId, setRequirednessResolvingForId] = useState<number | null>(null);
  const [requirednessResolvingStart, setRequirednessResolvingStart] = useState<string | null>(null);

  function clearPending() {
    setSymmetryLineA(null);
    setBalanceLineA(null);
    setSimilarityStart(null);
    setClosureRangeStart(null);
    setRequirednessRangeStart(null);
    setAddingToSimilarityGroupId(null);
    setRequirednessResolvingForId(null);
    setRequirednessResolvingStart(null);
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
    similarityGroupId?: number | null;
    resolvedStartWordId?: string | null;
    resolvedEndWordId?: string | null;
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
      similarityGroupId: fields.similarityGroupId ?? null,
      resolvedStartWordId: fields.resolvedStartWordId ?? null,
      resolvedEndWordId: fields.resolvedEndWordId ?? null,
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

  // ── Requiredness ("arrow") — a plain click behaves exactly like
  // Continuation's single-word anchor (create, or reopen for editing — any
  // existing Requiredness mark on this word, EITHER subtype, so an old mark
  // stays reachable/deletable no matter which of the arrow/underline
  // toolbar buttons happens to be selected). The resolved-range pick is a
  // SEPARATE, explicitly-entered mode (requirednessResolvingForId, started
  // from the note popover's button below) — routed here first so it takes
  // priority whenever it's active, but it never blocks a plain click when
  // it isn't.
  function handleRequirednessArrowClick(wordId: string, shiftHeld: boolean) {
    if (requirednessResolvingForId !== null) {
      handleRequirednessResolveClick(wordId, shiftHeld);
      return;
    }
    const existing = findCoveringRequirednessMark(wordId);
    if (existing) {
      setEditingNotationId(existing.id);
      return;
    }
    createNotation({ principle: "requiredness", startWordId: wordId });
  }

  /** See UsePoetryNotationsReturn's doc comment. */
  function handleStartRequirednessResolving(mark: PoetryNotation) {
    setRequirednessResolvingStart(null);
    setRequirednessResolvingForId((prev) => (prev === mark.id ? null : mark.id));
    // Close the popover so it doesn't sit on top of the word(s) being picked
    // (it renders directly below its anchor word, which is often exactly
    // where the resolved phrase is).
    setEditingNotationId(null);
  }

  // Click-then-shift-click range picking for the resolved word/phrase, same
  // UX as Closure/Requiredness-underline: a plain click (re)anchors the
  // start, clicking the same word again or shift-clicking a different word
  // completes it. Reopens the popover on completion so the user sees the
  // result and can still edit/save the note.
  function handleRequirednessResolveClick(wordId: string, shiftHeld: boolean) {
    const markId = requirednessResolvingForId;
    if (markId === null) return;
    if (!requirednessResolvingStart) {
      setRequirednessResolvingStart(wordId);
      return;
    }
    function finish(resolvedStartWordId: string, resolvedEndWordId: string) {
      setRequirednessResolvingForId(null);
      setRequirednessResolvingStart(null);
      handleSetRequirednessResolvedRange(markId!, resolvedStartWordId, resolvedEndWordId);
    }
    if (wordId === requirednessResolvingStart) {
      finish(wordId, wordId);
      return;
    }
    if (!shiftHeld) {
      setRequirednessResolvingStart(wordId);
      return;
    }
    const startPos = wordIndexMap.get(requirednessResolvingStart);
    const endPos = wordIndexMap.get(wordId);
    const [resolvedStartWordId, resolvedEndWordId] =
      startPos !== undefined && endPos !== undefined && startPos > endPos
        ? [wordId, requirednessResolvingStart]
        : [requirednessResolvingStart, wordId];
    finish(resolvedStartWordId, resolvedEndWordId);
  }

  async function handleSetRequirednessResolvedRange(id: number, resolvedStartWordId: string, resolvedEndWordId: string) {
    setPoetryNotations((prev) => prev.map((n) => (n.id === id ? { ...n, resolvedStartWordId, resolvedEndWordId } : n)));
    setEditingNotationId(id);
    try {
      await fetch("/api/poetry-notations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, resolvedStartWordId, resolvedEndWordId }),
      });
    } catch {
      // non-critical
    }
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
  // wordToParaStart themselves. Same click model as Text Color: a plain click
  // marks the WHOLE word (regardless of which letter it landed on), a
  // shift-click anchors a specific letter, and a second shift-click commits
  // the range between the two anchors — spanning as many letters as needed.
  // If "Add word" set a pending group (addingToSimilarityGroupId), whichever
  // mark THIS click produces is tagged into that group and the flag is
  // consumed — one word/range added per "Add word" click, anywhere in the
  // chapter (the same-line restriction below only governs a single mark's
  // own two-letter-click range, not cross-group linking).
  function handleGraphemeClick(wordId: string, graphemeIndex: number, shiftHeld: boolean, segFirstWordId: string) {
    if (!shiftHeld) {
      setSimilarityStart(null);
      const groupId = addingToSimilarityGroupId;
      setAddingToSimilarityGroupId(null);
      // 9999 is this codebase's existing sentinel for "through the end of
      // the word" (see derivePoetryDisplayMaps.ts's cross-word span handling)
      // — rendering/lookup code already clamps it to the word's real length.
      createNotation({ principle: "similarity", startWordId: wordId, endWordId: wordId, startGraphemeIndex: 0, endGraphemeIndex: 9999, similarityGroupId: groupId });
      return;
    }
    if (!similarityStart) {
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
      const groupId = addingToSimilarityGroupId;
      setAddingToSimilarityGroupId(null);
      createNotation({ principle: "similarity", startWordId: wordId, endWordId: wordId, startGraphemeIndex: startIdx, endGraphemeIndex: endIdx, similarityGroupId: groupId });
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
    const groupId = addingToSimilarityGroupId;
    setAddingToSimilarityGroupId(null);
    createNotation({
      principle: "similarity",
      startWordId,
      endWordId,
      startGraphemeIndex: startIdx,
      endGraphemeIndex: endIdx,
      similarityGroupId: groupId,
    });
  }

  /** "Add word" — see UsePoetryNotationsReturn's doc comment. */
  function handleStartAddWordToGroup(mark: PoetryNotation) {
    // Close the popover so it doesn't sit on top of the word(s) being picked
    // — same reasoning as handleStartRequirednessResolving.
    setEditingNotationId(null);
    if (mark.similarityGroupId != null) {
      setAddingToSimilarityGroupId(mark.similarityGroupId);
      return;
    }
    const groupId = mark.id;
    setPoetryNotations((prev) => prev.map((n) => (n.id === mark.id ? { ...n, similarityGroupId: groupId } : n)));
    setAddingToSimilarityGroupId(groupId);
    fetch("/api/poetry-notations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mark.id, similarityGroupId: groupId }),
    }).catch(() => { /* non-critical */ });
  }

  /** Cancels a pending "Add word" pick — see UsePoetryNotationsReturn's doc comment. */
  function handleCancelAddWordToGroup() {
    setAddingToSimilarityGroupId(null);
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

  // Finds a Requiredness mark (either subtype) covering wordId — "underline"
  // via its startWordId/endWordId range, "arrow" via its single startWordId
  // or (once set) its resolvedStartWordId/resolvedEndWordId range. Shared by
  // both click handlers below so a click always reaches an existing mark
  // for editing/deleting regardless of which subtype the toolbar happens to
  // have selected — the toolbar's arrow/underline toggle only decides what
  // a click on BARE text creates, never which existing marks are reachable.
  function findCoveringRequirednessMark(wordId: string): PoetryNotation | undefined {
    return poetryNotations.find((n) => {
      if (n.principle !== "requiredness") return false;
      if (n.subtype === "underline") {
        if (!n.endWordId) return false;
        if (n.startWordId === wordId || n.endWordId === wordId) return true;
        const lo = wordIndexMap.get(n.startWordId);
        const hi = wordIndexMap.get(n.endWordId);
        const pos = wordIndexMap.get(wordId);
        if (lo === undefined || hi === undefined || pos === undefined) return false;
        return pos >= Math.min(lo, hi) && pos <= Math.max(lo, hi);
      }
      if (n.startWordId === wordId) return true;
      if (!n.resolvedStartWordId || !n.resolvedEndWordId) return false;
      if (n.resolvedStartWordId === wordId || n.resolvedEndWordId === wordId) return true;
      const lo = wordIndexMap.get(n.resolvedStartWordId);
      const hi = wordIndexMap.get(n.resolvedEndWordId);
      const pos = wordIndexMap.get(wordId);
      if (lo === undefined || hi === undefined || pos === undefined) return false;
      return pos >= Math.min(lo, hi) && pos <= Math.max(lo, hi);
    });
  }

  // ── Requiredness (underline) — arbitrary word range, chapter-ordered ───────
  // Same range-picking UX as Closure (weak): first click anchors the pending
  // start, a plain click re-anchors it, a SHIFT-click completes the range.
  function handleRequirednessWordClick(wordId: string, shiftHeld: boolean) {
    if (!requirednessRangeStart) {
      const covering = findCoveringRequirednessMark(wordId);
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

  /** Similarity "Add word" groups share one note across every member (so
   *  deleting any single member never loses it) — writes `note` to each id
   *  in `memberIds` in parallel, optimistically updating all of them locally
   *  first. */
  async function handleSaveSimilarityNote(memberIds: number[], note: string | null) {
    const idSet = new Set(memberIds);
    setPoetryNotations((prev) => prev.map((n) => (idSet.has(n.id) ? { ...n, note } : n)));
    await Promise.all(memberIds.map((id) =>
      fetch("/api/poetry-notations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      }).catch(() => { /* non-critical */ })
    ));
  }

  /** Clears a mark's similarityGroupId — used to auto-ungroup a Similarity
   *  "group" that's been deleted down to a single remaining member. */
  async function handleUngroupMark(id: number) {
    setPoetryNotations((prev) => prev.map((n) => (n.id === id ? { ...n, similarityGroupId: null } : n)));
    try {
      await fetch("/api/poetry-notations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, similarityGroupId: null }),
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
    requirednessResolvingForId,
    requirednessResolvingStart,
    addingToSimilarityGroupId,
    clearPending,
    handleWordClick,
    handleRequirednessArrowClick,
    handleStartRequirednessResolving,
    handleLineClick,
    handleSymmetryLineClick,
    handleGraphemeClick,
    handleClosureWordClick,
    handleClosureLineClick,
    handleRequirednessWordClick,
    handleStartAddWordToGroup,
    handleCancelAddWordToGroup,
    handleUpdateNote,
    handleSaveSimilarityNote,
    handleUngroupMark,
    handleDeleteNotation,
  };
}
