"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LineAnnotation } from "@/lib/db/schema";

export interface UseAnnotationRangeOptions {
  initialLineAnnotations: LineAnnotation[];
  book: string;
  textSource: string;
  /**
   * Resolves a segWordId to the chapter number used for API POST calls —
   * built from a wordId → chapter map so it stays correct across a
   * multi-chapter passage, not just a single chapter.
   */
  getChapterForWord: (wordId: string) => number;
  /**
   * Ordered list of the first wordId of every paragraph segment in the visible text.
   * Passed fresh on every render so handlers always see the latest state.
   * Computed by the parent from `words` + `paragraphBreakIds`.
   */
  paragraphFirstWordIds: string[];
}

export interface UseAnnotationRangeReturn {
  lineAnnotations: LineAnnotation[];
  setLineAnnotations: Dispatch<SetStateAction<LineAnnotation[]>>;
  editingAnnotations: boolean;
  setEditingAnnotations: Dispatch<SetStateAction<boolean>>;
  annotRangeStart: string | null;
  setAnnotRangeStart: Dispatch<SetStateAction<string | null>>;
  annotRangeEnd: string | null;
  setAnnotRangeEnd: Dispatch<SetStateAction<string | null>>;
  editingAnnotationId: number | null;
  setEditingAnnotationId: Dispatch<SetStateAction<number | null>>;
  handleSelectAnnotationSegment: (segWordId: string, shiftHeld?: boolean) => void;
  handleCancelAnnotation: () => void;
  /** Returns true on success. On failure, the pending range selection is left
   *  intact (rather than silently discarded) so the caller can show an error
   *  and let the user retry without losing their range/description/etc. */
  handleSaveAnnotation: (data: {
    annotType: string;
    label: string;
    commFunction?: string | null;
    color: string;
    description: string | null;
    outOfSequence: boolean;
    transitional: boolean;
  }) => Promise<boolean>;
  handleDeleteAnnotation: (id: number) => Promise<void>;
  handleUpdateAnnotation: (
    id: number,
    updates: { annotType?: string; label?: string; commFunction?: string | null; color?: string; description?: string | null; outOfSequence?: boolean; transitional?: boolean }
  ) => Promise<void>;
  handleExpandAnnotationRange: (
    id: number,
    direction: "expand-start" | "shrink-start" | "expand-end" | "shrink-end"
  ) => Promise<void>;
}

export function useAnnotationRange({
  initialLineAnnotations,
  book,
  textSource,
  getChapterForWord,
  paragraphFirstWordIds,
}: UseAnnotationRangeOptions): UseAnnotationRangeReturn {
  const [lineAnnotations, setLineAnnotations] = useState<LineAnnotation[]>(initialLineAnnotations);
  const [editingAnnotations, setEditingAnnotations] = useState(false);
  const [annotRangeStart, setAnnotRangeStart] = useState<string | null>(null);
  const [annotRangeEnd, setAnnotRangeEnd] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<number | null>(null);

  // Finds the annotation (if any) whose start..end range already covers this
  // paragraph segment, so a click there can open it for editing instead of
  // starting a new (overlapping) range selection.
  function findCoveringAnnotation(segWordId: string): LineAnnotation | null {
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const pos = posMap.get(segWordId);
    if (pos === undefined) return null;
    for (const ann of lineAnnotations) {
      const startPos = posMap.get(ann.startWordId);
      if (startPos === undefined) continue;
      const endPos = posMap.get(ann.endWordId) ?? startPos;
      const lo = Math.min(startPos, endPos);
      const hi = Math.max(startPos, endPos);
      if (pos >= lo && pos <= hi) return ann;
    }
    return null;
  }

  function handleSelectAnnotationSegment(segWordId: string, shiftHeld = false) {
    // A segment that's already labeled can't be clicked into a new range
    // selection — open its existing annotation for editing instead.
    const covering = findCoveringAnnotation(segWordId);
    if (covering) {
      setEditingAnnotationId(covering.id);
      setAnnotRangeStart(null);
      setAnnotRangeEnd(null);
      return;
    }
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
    commFunction?: string | null;
    color: string;
    description: string | null;
    outOfSequence: boolean;
    transitional: boolean;
  }): Promise<boolean> {
    if (!annotRangeStart) return false;
    const endWordId = annotRangeEnd ?? annotRangeStart;
    const segIds = paragraphFirstWordIds;
    const posMap = new Map(segIds.map((id, i) => [id, i]));
    const startPos = posMap.get(annotRangeStart) ?? 0;
    const endPos   = posMap.get(endWordId) ?? 0;
    const lo = segIds[Math.min(startPos, endPos)] ?? annotRangeStart;
    const hi = segIds[Math.max(startPos, endPos)] ?? endWordId;
    const chapter = getChapterForWord(lo);

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
      if (!resp.ok) return false;
      const { annotation } = await resp.json();
      setLineAnnotations((prev) => [...prev, annotation]);
      setAnnotRangeStart(null);
      setAnnotRangeEnd(null);
      return true;
    } catch {
      // Network error — leave the range selected so the creation form stays
      // open and the caller can surface an error instead of silently losing
      // the user's in-progress annotation.
      return false;
    }
  }

  async function handleDeleteAnnotation(id: number) {
    setLineAnnotations((prev) => prev.filter((a) => a.id !== id));
    setEditingAnnotationId((prev) => (prev === id ? null : prev));
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
    updates: { annotType?: string; label?: string; commFunction?: string | null; color?: string; description?: string | null; outOfSequence?: boolean; transitional?: boolean }
  ) {
    setLineAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
    try {
      const resp = await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      // Changing a theme's color recolors every other instance of that theme
      // server-side; mirror those into any of them already loaded here.
      if (resp.ok) {
        const { alsoRecolored } = await resp.json() as { alsoRecolored?: LineAnnotation[] };
        if (alsoRecolored?.length) {
          const colorById = new Map(alsoRecolored.map((a) => [a.id, a.color]));
          setLineAnnotations((prev) =>
            prev.map((a) => (colorById.has(a.id) ? { ...a, color: colorById.get(a.id)! } : a))
          );
        }
      }
    } catch {
      // non-critical
    }
  }

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
    if (newStartPos === startPos && newEndPos === endPos) return;

    const newStart = segIds[newStartPos];
    const newEnd   = segIds[newEndPos];
    if (!newStart || !newEnd) return;

    setLineAnnotations((prev) =>
      prev.map((a) => a.id === id ? { ...a, startWordId: newStart, endWordId: newEnd } : a)
    );
    try {
      await fetch("/api/line-annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, startWordId: newStart, endWordId: newEnd }),
      });
    } catch {
      setLineAnnotations((prev) =>
        prev.map((a) => a.id === id ? { ...a, startWordId: ann.startWordId, endWordId: ann.endWordId } : a)
      );
    }
  }

  return {
    lineAnnotations,
    setLineAnnotations,
    editingAnnotations,
    setEditingAnnotations,
    annotRangeStart,
    setAnnotRangeStart,
    annotRangeEnd,
    setAnnotRangeEnd,
    editingAnnotationId,
    setEditingAnnotationId,
    handleSelectAnnotationSegment,
    handleCancelAnnotation,
    handleSaveAnnotation,
    handleDeleteAnnotation,
    handleUpdateAnnotation,
    handleExpandAnnotationRange,
  };
}
