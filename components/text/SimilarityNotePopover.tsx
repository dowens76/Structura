"use client";

import { useState } from "react";
import type { PoetryNotation } from "@/lib/db/schema";
import { POETRY_COLORS } from "@/lib/poetry/constants";

/** Similarity's own note editor — like PoetryNotePopover, but (a) positioned
 *  to the right of its anchor (the clicked word/letter-range's own wrapper,
 *  already position:relative) instead of below it, so it doesn't cover the
 *  text while the user picks more words via "Add word", and (b) aware of the
 *  mark's Similarity group: the note is shared across every member (any one
 *  member's saved note is representative), and Delete only removes `mark`
 *  itself, not the whole group. Shared between WordToken.tsx (source words)
 *  and VerseDisplay.tsx's translation-token renderer, same as
 *  PoetryNotePopover. */
export default function SimilarityNotePopover({
  mark,
  groupMembers,
  hasMissingArrow,
  onAddWord,
  onSave,
  onDeleteWord,
  onRestoreArrows,
  onClose,
}: {
  mark: PoetryNotation;
  /** Every current member of mark's group, oldest-first — just `[mark]` when ungrouped. */
  groupMembers: PoetryNotation[];
  /** True when a connecting arrow somewhere in this group is missing — e.g.
   *  manually deleted via the Word Arrow tool — so "Restore arrow" shows. */
  hasMissingArrow: boolean;
  onAddWord: () => void;
  onSave: (note: string | null) => void;
  onDeleteWord: (id: number) => void;
  onRestoreArrows: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(mark.note ?? "");
  const color = POETRY_COLORS.similarity;
  return (
    <span
      className="absolute z-30 left-full top-1/2 -translate-y-1/2 ml-2 w-56 rounded border bg-white dark:bg-stone-900 shadow-lg p-2 flex flex-col gap-1.5 not-italic font-normal text-left"
      style={{ borderColor: color }}
      onClick={(e) => e.stopPropagation()}
    >
      {groupMembers.length > 1 && (
        <span className="text-[10px] font-semibold text-stone-500 dark:text-stone-400">
          Part of a {groupMembers.length}-word group
        </span>
      )}
      <textarea
        className="w-full text-xs rounded border border-stone-300 dark:border-stone-600 bg-transparent p-1 resize-none"
        rows={2}
        placeholder="Note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
      />
      <span className="flex items-center justify-between gap-1">
        <button
          className="text-[10px] font-semibold hover:underline"
          style={{ color }}
          onClick={onAddWord}
        >
          + Add word
        </button>
        <button
          className="text-[10px] text-red-600 hover:underline"
          onClick={() => onDeleteWord(mark.id)}
        >
          Delete
        </button>
      </span>
      {hasMissingArrow && (
        <button
          className="text-[10px] font-semibold hover:underline text-left"
          style={{ color }}
          onClick={onRestoreArrows}
        >
          ↺ Restore arrow
        </button>
      )}
      <span className="flex items-center justify-end gap-1">
        <button className="text-[10px] text-stone-500 hover:underline" onClick={onClose}>Cancel</button>
        <button
          className="text-[10px] font-semibold hover:underline"
          style={{ color }}
          onClick={() => { onSave(draft.trim() || null); onClose(); }}
        >
          Save
        </button>
      </span>
    </span>
  );
}
