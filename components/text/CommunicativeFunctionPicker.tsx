"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import CommFunctionManager from "@/components/controls/CommFunctionManager";

// ── Taxonomy ─────────────────────────────────────────────────────────────────

export const COMM_FUNCTION_TAXONOMY = {
  statement: {
    label: "Statement",
    children: {
      assertion:   "Assertion",
      narration:   "Narration",
      explanation: "Explanation",
      testimony:   "Testimony",
      prophecy:    "Prophecy",
    },
  },
  question: {
    label: "Question",
    children: {
      information: "Information",
      rhetorical:  "Rhetorical",
      challenge:   "Challenge",
    },
  },
  command: {
    label: "Command",
    children: {
      command:     "Command",
      exhortation: "Exhortation",
      warning:     "Warning",
      invitation:  "Invitation",
      request:     "Request",
      commission:  "Commission",
    },
  },
  promise: {
    label: "Promise",
    children: {
      promise:   "Promise",
      oath:      "Oath",
      assurance: "Assurance",
      threat:    "Threat",
    },
  },
  evaluation: {
    label: "Evaluation",
    children: {
      praise:       "Praise",
      blessing:     "Blessing",
      rebuke:       "Rebuke",
      condemnation: "Condemnation",
      woe:          "Woe",
    },
  },
  expression: {
    label: "Expression",
    children: {
      lament:       "Lament",
      thanksgiving: "Thanksgiving",
      confession:   "Confession",
      hope:         "Hope",
      fear:         "Fear",
      joy:          "Joy",
      trust:        "Trust",
    },
  },
  worship: {
    label: "Worship",
    children: {
      praise:       "Praise",
      prayer:       "Prayer",
      petition:     "Petition",
      intercession: "Intercession",
      doxology:     "Doxology",
    },
  },
  declaration: {
    label: "Declaration",
    children: {
      forgiveness:  "Forgiveness",
      judgment:     "Judgment",
      appointment:  "Appointment",
      consecration: "Consecration",
      oracle:       "Oracle",
    },
  },
} as const;

export type CommFunctionCategoryKey = keyof typeof COMM_FUNCTION_TAXONOMY;

// ── Custom (user-defined) communicative functions ────────────────────────────
// Shared, reactive, module-level store so every picker/badge instance reads the
// same data without prop-drilling through VerseDisplay/ChapterDisplay.

export interface CommFunctionCustomEntry {
  id: number;
  workspaceId: number;
  category: string;
  key: string;
  label: string;
  sortOrder: number;
}

let customCache: CommFunctionCustomEntry[] = [];
let fetchState: "idle" | "loading" | "done" = "idle";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function ensureFetched() {
  if (fetchState !== "idle") return;
  fetchState = "loading";
  fetch("/api/comm-function-custom-types")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: CommFunctionCustomEntry[]) => {
      customCache = rows;
      fetchState = "done";
      notify();
    })
    .catch(() => { fetchState = "done"; });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() { return customCache; }
const EMPTY_ENTRIES: CommFunctionCustomEntry[] = [];
function getServerSnapshot() { return EMPTY_ENTRIES; }

export function useCommFunctionCustoms() {
  ensureFetched();
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/comm-function-custom-types");
    customCache = r.ok ? await r.json() : [];
    notify();
  }, []);

  const addCustom = useCallback(async (category: string, label: string) => {
    const r = await fetch("/api/comm-function-custom-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, label }),
    });
    if (!r.ok) throw new Error("Failed to add — please try again.");
    const row = await r.json();
    customCache = [...customCache, row];
    notify();
    return row as CommFunctionCustomEntry;
  }, []);

  const updateCustom = useCallback(async (id: number, label: string) => {
    const r = await fetch("/api/comm-function-custom-types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label }),
    });
    if (!r.ok) throw new Error("Failed to save — please try again.");
    const row = await r.json();
    customCache = customCache.map((e) => (e.id === id ? row : e));
    notify();
  }, []);

  const deleteCustom = useCallback(async (id: number) => {
    const r = await fetch(`/api/comm-function-custom-types?id=${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error("Failed to delete — please try again.");
    customCache = customCache.filter((e) => e.id !== id);
    notify();
  }, []);

  return { entries, refresh, addCustom, updateCustom, deleteCustom };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getCommFunctionLeafLabel(value: string, customEntries: CommFunctionCustomEntry[] = []): string {
  if (!value) return value;
  if (!value.includes(".")) return value; // legacy flat values — display as-is
  const [cat, leaf] = value.split(".") as [CommFunctionCategoryKey, string];
  const category = COMM_FUNCTION_TAXONOMY[cat];
  if (category) {
    const builtIn = (category.children as Record<string, string>)[leaf];
    if (builtIn) return builtIn;
  }
  const custom = customEntries.find((e) => e.category === cat && e.key === leaf);
  return custom?.label ?? value;
}

// ── Pinned quick-tags ─────────────────────────────────────────────────────────

const PINNED: { value: string; shortLabel: string }[] = [
  { value: "command.command",     shortLabel: "Command"   },
  { value: "statement.assertion", shortLabel: "Assertion" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function CommunicativeFunctionPicker({
  value,
  onChange,
  presentationMode = false,
}: {
  value: string;
  onChange: (v: string) => void;
  presentationMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hoveredCat, setHoveredCat] = useState<CommFunctionCategoryKey | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [dropPos, setDropPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  const { entries: customEntries } = useCommFunctionCustoms();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const openDropdown = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Prevent overflow off the right edge (left + 444px total panel width)
    const left = Math.min(r.left, window.innerWidth - 444);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const cap = 360; // max dropdown height
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      setDropPos({ top: r.bottom + 4, left, maxHeight: Math.min(spaceBelow, cap) });
    } else {
      // Flip above the trigger
      setDropPos({ bottom: window.innerHeight - r.top + 4, left, maxHeight: Math.min(spaceAbove, cap) });
    }
    setHoveredCat(null);
    setOpen(true);
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !dropdownRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = useCallback((v: string) => { onChange(v); setOpen(false); }, [onChange]);
  const clear  = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onChange(""); }, [onChange]);

  const textCls    = presentationMode ? "text-sm" : "text-[10px]";
  const displayLabel = value ? getCommFunctionLeafLabel(value, customEntries) : null;

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        onKeyDown={(e) => e.stopPropagation()}
        className={[
          "w-full px-1.5 py-0.5 border border-stone-300 dark:border-stone-600 rounded bg-transparent",
          textCls,
          "text-left flex items-center justify-between gap-1 transition-colors",
          "hover:border-indigo-400 dark:hover:border-indigo-500",
          displayLabel
            ? "text-stone-700 dark:text-stone-300"
            : "text-stone-400 dark:text-stone-500",
        ].join(" ")}
      >
        <span className="truncate">{displayLabel ?? "— Communicative function (optional) —"}</span>
        {displayLabel ? (
          <span
            role="button"
            aria-label="Clear communicative function"
            className="shrink-0 leading-none hover:text-red-500 transition-colors"
            onClick={clear}
          >×</span>
        ) : (
          <span className="shrink-0 text-stone-300 dark:text-stone-600 leading-none">▾</span>
        )}
      </button>

      {/* ── Dropdown (fixed, so it escapes overflow:hidden containers) ── */}
      {open && dropPos && (
        <div
          ref={dropdownRef}
          className="flex shadow-2xl border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden"
          style={{
            position: "fixed",
            top: dropPos.top,
            bottom: dropPos.bottom,
            left: dropPos.left,
            maxHeight: dropPos.maxHeight,
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* ── Left panel: quick tags + macro-categories ── */}
          <div
            className="bg-white dark:bg-stone-800 flex flex-col overflow-y-auto"
            style={{ width: 220 }}
          >
            {/* Quick Tags */}
            <div className="px-2.5 py-2 border-b border-stone-100 dark:border-stone-700">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
                Quick Tags
              </div>
              <div className="flex gap-1.5">
                {PINNED.map((pin) => (
                  <button
                    key={pin.value}
                    type="button"
                    onClick={() => select(pin.value)}
                    className={[
                      "text-[10px] px-2 py-0.5 rounded border font-medium transition-colors",
                      value === pin.value
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-stone-50 dark:bg-stone-700 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-600",
                    ].join(" ")}
                  >
                    {pin.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Macro-categories */}
            <div className="flex-1 overflow-y-auto">
              {(Object.entries(COMM_FUNCTION_TAXONOMY) as [CommFunctionCategoryKey, (typeof COMM_FUNCTION_TAXONOMY)[CommFunctionCategoryKey]][]).map(
                ([key, cat]) => (
                  <div
                    key={key}
                    onMouseEnter={() => setHoveredCat(key)}
                    className={[
                      "px-2.5 py-2 cursor-pointer flex items-center justify-between gap-2 transition-colors",
                      hoveredCat === key
                        ? "bg-indigo-50 dark:bg-indigo-900/30"
                        : "hover:bg-stone-50 dark:hover:bg-stone-700/50",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-semibold text-stone-700 dark:text-stone-200 leading-tight">
                      {cat.label}
                    </div>
                    <span className="shrink-0 text-stone-300 dark:text-stone-600 text-[11px]">›</span>
                  </div>
                )
              )}
            </div>

            {/* Manage categories */}
            <div className="px-2.5 py-1.5 border-t border-stone-100 dark:border-stone-700 shrink-0">
              <button
                type="button"
                onClick={() => { setOpen(false); setShowManager(true); }}
                className="w-full text-left text-[9px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                ⚙ Manage categories…
              </button>
            </div>
          </div>

          {/* ── Right panel: leaf nodes ── */}
          {hoveredCat && (
            <div
              className="bg-stone-50 dark:bg-stone-900 border-l border-stone-200 dark:border-stone-700 flex flex-col overflow-y-auto"
              style={{ width: 200 }}
            >
              <div className="px-2.5 pt-2 pb-1 border-b border-stone-100 dark:border-stone-700 shrink-0">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {COMM_FUNCTION_TAXONOMY[hoveredCat].label}
                </div>
              </div>

              {(
                Object.entries(COMM_FUNCTION_TAXONOMY[hoveredCat].children) as [string, string][]
              ).map(([leafKey, label]) => {
                const dotValue = `${hoveredCat}.${leafKey}`;
                const isSelected = value === dotValue;
                return (
                  <div
                    key={leafKey}
                    onClick={() => select(dotValue)}
                    className={[
                      "px-2.5 py-1.5 cursor-pointer transition-colors border-b border-stone-100 dark:border-stone-800 last:border-0",
                      "text-[11px] font-medium leading-tight flex items-center gap-1",
                      isSelected
                        ? "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                        : "text-stone-700 dark:text-stone-200 hover:bg-white dark:hover:bg-stone-800",
                    ].join(" ")}
                  >
                    {isSelected && <span className="text-[9px]">✓</span>}
                    {label}
                  </div>
                );
              })}

              {customEntries.filter((e) => e.category === hoveredCat).map((e) => {
                const dotValue = `${hoveredCat}.${e.key}`;
                const isSelected = value === dotValue;
                return (
                  <div
                    key={e.key}
                    onClick={() => select(dotValue)}
                    className={[
                      "px-2.5 py-1.5 cursor-pointer transition-colors border-b border-stone-100 dark:border-stone-800 last:border-0",
                      "text-[11px] font-medium leading-tight flex items-center gap-1",
                      isSelected
                        ? "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                        : "text-stone-700 dark:text-stone-200 hover:bg-white dark:hover:bg-stone-800",
                    ].join(" ")}
                  >
                    {isSelected && <span className="text-[9px]">✓</span>}
                    {e.label}
                    <span className="text-stone-300 dark:text-stone-600" title="Custom">•</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Manage categories modal ── */}
      {showManager && <CommFunctionManager onClose={() => setShowManager(false)} />}
    </>
  );
}
