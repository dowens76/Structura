"use client";

import { useState } from "react";
import type { PoetryNotation } from "@/lib/db/schema";

/** Small inline note editor shown under/over a poetry-notation glyph — same
 *  click-to-toggle-popover mechanism as InterlinearLabel's editable popovers.
 *  Shared between WordToken.tsx (source words) and VerseDisplay.tsx's
 *  translation-token renderer. */
export default function PoetryNotePopover({
  mark,
  color,
  onSave,
  onDelete,
  onClose,
}: {
  mark: PoetryNotation;
  color: string;
  onSave: (id: number, note: string | null) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(mark.note ?? "");
  return (
    <span
      className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 w-48 rounded border bg-white dark:bg-stone-900 shadow-lg p-2 flex flex-col gap-1.5 not-italic font-normal text-left"
      style={{ borderColor: color }}
      onClick={(e) => e.stopPropagation()}
    >
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
          className="text-[10px] text-red-600 hover:underline"
          onClick={() => onDelete(mark.id)}
        >
          Delete
        </button>
        <span className="flex gap-1">
          <button className="text-[10px] text-stone-500 hover:underline" onClick={onClose}>Cancel</button>
          <button
            className="text-[10px] font-semibold hover:underline"
            style={{ color }}
            onClick={() => { onSave(mark.id, draft.trim() || null); onClose(); }}
          >
            Save
          </button>
        </span>
      </span>
    </span>
  );
}
