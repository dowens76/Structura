"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WordArrow } from "@/lib/db/schema";

export type ArrowPatch = {
  color?: string | null;
  midpointDx?: number | null;
  midpointDy?: number | null;
  midpoint2Dx?: number | null;
  midpoint2Dy?: number | null;
  fromWordId?: string;
  toWordId?: string;
};

export interface UseWordArrowsOptions {
  initialWordArrows: WordArrow[];
  book: string;
  textSource: string;
  /**
   * Resolves a wordId to the chapter number used for API POST calls — built
   * from a wordId → chapter map (with a `tv:` token ID fallback) so it stays
   * correct across a multi-chapter passage, not just a single chapter.
   */
  getChapterForWord: (wordId: string) => number;
}

export interface UseWordArrowsReturn {
  wordArrowsState: WordArrow[];
  setWordArrowsState: Dispatch<SetStateAction<WordArrow[]>>;
  editingArrows: boolean;
  setEditingArrows: Dispatch<SetStateAction<boolean>>;
  arrowFromWordId: string | null;
  setArrowFromWordId: Dispatch<SetStateAction<string | null>>;
  /** Two-click arrow creation. First click sets the origin; second click saves.
   *  Returns null on success, or an error message on failure. On failure the
   *  origin selection (`arrowFromWordId`) is left intact so the user can just
   *  retry the second click instead of having to re-pick the start word. */
  handleSelectArrowWordById: (wordId: string) => Promise<string | null>;
  handleDeleteWordArrow: (id: number) => Promise<void>;
  handleUpdateWordArrow: (id: number, patch: ArrowPatch) => Promise<void>;
  /** Creates an arrow directly between two known endpoints, bypassing the
   *  two-click `arrowFromWordId` flow — used by Similarity's "Add word"
   *  chaining to auto-connect consecutive group members on Save.
   *  `similarityGroupId` tags the arrow so a later per-word delete in that
   *  flow can find and remove just the arrows touching a given word. */
  createDirectArrow: (fromWordId: string, toWordId: string, chapter: number, similarityGroupId: number, color?: string) => Promise<WordArrow | null>;
}

export function useWordArrows({
  initialWordArrows,
  book,
  textSource,
  getChapterForWord,
}: UseWordArrowsOptions): UseWordArrowsReturn {
  const [wordArrowsState, setWordArrowsState] = useState<WordArrow[]>(initialWordArrows);
  const [editingArrows, setEditingArrows] = useState(false);
  const [arrowFromWordId, setArrowFromWordId] = useState<string | null>(null);

  async function handleSelectArrowWordById(wordId: string): Promise<string | null> {
    if (!arrowFromWordId) {
      setArrowFromWordId(wordId);
      return null;
    }
    if (arrowFromWordId === wordId) {
      setArrowFromWordId(null);
      return null;
    }
    const chapter = getChapterForWord(arrowFromWordId);
    try {
      const resp = await fetch("/api/word-arrows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWordId: arrowFromWordId,
          toWordId: wordId,
          book,
          chapter,
          source: textSource,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}) as { error?: string });
        console.error("[handleSelectArrowWordById] save failed:", resp.status, body.error);
        return body.error || `Save failed (${resp.status}).`;
      }
      const { arrow } = await resp.json();
      setWordArrowsState((prev) => [...prev, arrow]);
      setArrowFromWordId(null);
      return null;
    } catch (e) {
      // Leave arrowFromWordId set so the pending selection isn't lost —
      // the caller can just retry the second click.
      console.error("[handleSelectArrowWordById] network error:", e);
      return e instanceof Error ? e.message : "Network error.";
    }
  }

  async function createDirectArrow(fromWordId: string, toWordId: string, chapter: number, similarityGroupId: number, color?: string): Promise<WordArrow | null> {
    try {
      const resp = await fetch("/api/word-arrows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromWordId, toWordId, book, chapter, source: textSource, similarityGroupId, color }),
      });
      if (!resp.ok) return null;
      const { arrow } = await resp.json();
      setWordArrowsState((prev) => [...prev, arrow]);
      return arrow;
    } catch {
      return null;
    }
  }

  async function handleDeleteWordArrow(id: number) {
    setWordArrowsState((prev) => prev.filter((a) => a.id !== id));
    try {
      const resp = await fetch("/api/word-arrows", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!resp.ok) console.error("[handleDeleteWordArrow] delete failed:", resp.status, await resp.json().catch(() => null));
    } catch (e) {
      // non-critical — UI already updated optimistically
      console.error("[handleDeleteWordArrow] network error:", e);
    }
  }

  async function handleUpdateWordArrow(id: number, patch: ArrowPatch) {
    try {
      const resp = await fetch("/api/word-arrows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!resp.ok) {
        console.error("[handleUpdateWordArrow] update failed:", resp.status, await resp.json().catch(() => null));
        return;
      }
      const { arrow } = await resp.json();
      setWordArrowsState((prev) => prev.map((a) => (a.id === id ? arrow : a)));
    } catch (e) {
      console.error("[handleUpdateWordArrow] network error:", e);
    }
  }

  return {
    wordArrowsState,
    setWordArrowsState,
    editingArrows,
    setEditingArrows,
    arrowFromWordId,
    setArrowFromWordId,
    handleSelectArrowWordById,
    handleDeleteWordArrow,
    handleUpdateWordArrow,
    createDirectArrow,
  };
}
