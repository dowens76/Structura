"use client";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WordArrow } from "@/lib/db/schema";

export interface UseWordArrowsOptions {
  initialWordArrows: WordArrow[];
  book: string;
  textSource: string;
  /**
   * Resolves a wordId to the chapter number used for API POST calls.
   * ChapterDisplay passes `() => chapter` (always the single chapter prop).
   * PassageView builds a `wordToChapter` map and also parses `tv:` token IDs.
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
  /** Two-click arrow creation. First click sets the origin; second click saves. */
  handleSelectArrowWordById: (wordId: string) => Promise<void>;
  handleDeleteWordArrow: (id: number) => Promise<void>;
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

  async function handleSelectArrowWordById(wordId: string) {
    if (!arrowFromWordId) {
      setArrowFromWordId(wordId);
      return;
    }
    if (arrowFromWordId === wordId) {
      setArrowFromWordId(null);
      return;
    }
    const chapter = getChapterForWord(arrowFromWordId);
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

  return {
    wordArrowsState,
    setWordArrowsState,
    editingArrows,
    setEditingArrows,
    arrowFromWordId,
    setArrowFromWordId,
    handleSelectArrowWordById,
    handleDeleteWordArrow,
  };
}
