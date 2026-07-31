"use client";

import { useRef, useState } from "react";

interface TranslationDatasetLabelProps {
  /** `tv:ABBR:Book.Ch.V.wi` — a translation word's token-position id. */
  wordId: string;
  value: string | null;
  direction: "ltr" | "rtl";
  onSave?: (wordId: string, value: string | null) => void;
  groupingActive?: boolean;
  isPendingGroupMember?: boolean;
  onToggleGroupMember?: (wordId: string) => void;
  /** True for every non-first word of a saved grouping — its own value
   *  display is hidden since only the run's first word shows the shared
   *  label (mirrors WordToken's InterlinearLabel suppression for source
   *  word groupings). The label stays clickable so any member can still
   *  open the shared edit popover. */
  suppressValueDisplay?: boolean;
}

/**
 * Interlinear-dataset label rendered under a translation-text word — the
 * translation-text counterpart to WordToken's InterlinearLabel (source
 * words). Shares the same dataset value map and click-to-edit popover
 * behavior, but is keyed by a `tv:` word id instead of a source Word object,
 * since translation words have no lemma/Strong's/morphology/transliteration
 * of their own — only free-text dataset values apply here.
 */
export default function TranslationDatasetLabel({
  wordId,
  value,
  direction,
  onSave,
  groupingActive = false,
  isPendingGroupMember = false,
  onToggleGroupMember,
  suppressValueDisplay = false,
}: TranslationDatasetLabelProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const labelStyle: React.CSSProperties = {
    fontSize: "0.72em",
    color: "var(--interlinear-color)",
  };

  function handleLabelClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (groupingActive) {
      onToggleGroupMember?.(wordId);
      return;
    }
    setDraftValue(value ?? "");
    setPopoverOpen((v) => !v);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSave() {
    const val = draftValue.trim();
    onSave?.(wordId, val || null);
    setPopoverOpen(false);
  }

  return (
    <span className="relative">
      <span
        className={[
          "word-parse cursor-pointer rounded px-0.5",
          groupingActive
            ? "hover:bg-blue-100 dark:hover:bg-blue-900/40"
            : "hover:bg-stone-100 dark:hover:bg-stone-700",
        ].join(" ")}
        style={
          isPendingGroupMember
            ? { ...labelStyle, backgroundColor: "rgba(37, 99, 235, 0.35)", outline: "1px solid rgba(37, 99, 235, 0.6)" }
            : labelStyle
        }
        dir={direction}
        onClick={handleLabelClick}
        title={groupingActive ? "Click to add/remove from grouping" : "Click to edit"}
      >
        {suppressValueDisplay ? "" : (value ?? "·")}
      </span>

      {popoverOpen && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 rounded-lg border shadow-lg p-2 flex flex-col gap-1.5"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", minWidth: "150px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>{wordId}</span>
          <input
            ref={inputRef}
            autoFocus
            dir={direction}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setPopoverOpen(false);
            }}
            placeholder="Enter value…"
            className="rounded border px-1.5 py-0.5 text-xs outline-none w-full"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--foreground)" }}
          />
          <span className="flex gap-1 justify-end">
            <button
              onClick={() => { onSave?.(wordId, null); setPopoverOpen(false); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700"
              style={{ color: "var(--text-muted)" }}
            >
              Clear
            </button>
            <button
              onClick={handleSave}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white"
            >
              Save
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
