"use client";

import { useEffect } from "react";

interface FindBarProps {
  query: string;
  onChange: (q: string) => void;
  hitCount: number;
  focusIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  canTag: boolean;
  onTag: () => void;
}

export default function FindBar({
  query,
  onChange,
  hitCount,
  focusIdx,
  onPrev,
  onNext,
  onClose,
  inputRef,
  canTag,
  onTag,
}: FindBarProps) {
  // Focus input on mount
  useEffect(() => {
    inputRef.current?.select();
  }, [inputRef]);

  const hasHits = hitCount > 0;
  const displayIdx = hasHits ? focusIdx + 1 : 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onNext();
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      onPrev();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white dark:bg-stone-900 shadow-lg px-2 py-1.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in text…"
        className="w-44 bg-transparent text-sm outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500 text-stone-800 dark:text-stone-200"
        spellCheck={false}
        autoComplete="off"
      />

      <span className="text-xs text-stone-400 dark:text-stone-500 min-w-[3.5rem] text-center select-none">
        {query.trim() === ""
          ? ""
          : hasHits
            ? `${displayIdx} / ${hitCount}`
            : "No matches"}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          onClick={onPrev}
          disabled={!hasHits}
          title={`Previous match (${modKey}+Shift+G)`}
          className="rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={onNext}
          disabled={!hasHits}
          title={`Next match (${modKey}+G)`}
          className="rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {canTag && hasHits && (
        <button
          onClick={onTag}
          title={`Tag focused word (${modKey}+E)`}
          className="rounded px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60"
        >
          Tag ({modKey}+E)
        </button>
      )}

      <button
        onClick={onClose}
        title="Close (Esc)"
        className="rounded p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-600 dark:hover:text-stone-300"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
