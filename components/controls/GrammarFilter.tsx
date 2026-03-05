"use client";

import { useEffect, useRef, useState } from "react";
import type { GrammarFilterState } from "@/lib/morphology/types";
import { POS_COLORS, POS_LABELS } from "@/lib/morphology/types";

interface GrammarFilterProps {
  filter: GrammarFilterState;
  onChange: (filter: GrammarFilterState) => void;
}

export default function GrammarFilter({ filter, onChange }: GrammarFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const togglePOS = (key: keyof GrammarFilterState) => {
    onChange({ ...filter, [key]: !filter[key] });
  };

  const enabledCount = Object.values(filter).filter(Boolean).length;
  const totalCount = Object.keys(filter).length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
      >
        <span>Filter POS</span>
        <span className="text-stone-400 dark:text-stone-500">
          ({enabledCount}/{totalCount})
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg p-2 min-w-[160px]">
          {(Object.keys(filter) as Array<keyof GrammarFilterState>).map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800"
            >
              <input
                type="checkbox"
                checked={filter[key]}
                onChange={() => togglePOS(key)}
                className="w-3 h-3 rounded"
              />
              <span
                className="text-xs font-medium"
                style={{ color: POS_COLORS[key] ?? "inherit" }}
              >
                {POS_LABELS[key] ?? key}
              </span>
            </label>
          ))}
          <div className="border-t border-[var(--border)] mt-1 pt-1 flex gap-2">
            <button
              onClick={() =>
                onChange(
                  Object.fromEntries(
                    Object.keys(filter).map((k) => [k, true])
                  ) as unknown as GrammarFilterState
                )
              }
              className="flex-1 text-[10px] text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
            >
              All
            </button>
            <button
              onClick={() =>
                onChange(
                  Object.fromEntries(
                    Object.keys(filter).map((k) => [k, false])
                  ) as unknown as GrammarFilterState
                )
              }
              className="flex-1 text-[10px] text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
            >
              None
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
