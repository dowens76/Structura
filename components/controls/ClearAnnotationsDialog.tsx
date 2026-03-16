"use client";

import { useEffect, useRef, useState } from "react";

export type ClearCategory =
  | "paragraphBreaks"
  | "characterRefs"
  | "speechSections"
  | "wordTagRefs"
  | "lineIndents"
  | "wordArrows"
  | "wordFormatting"
  | "clauseRelationships";

const CATEGORY_META: { key: ClearCategory; label: string; icon: string }[] = [
  { key: "paragraphBreaks",    label: "Paragraph breaks",       icon: "¶"  },
  { key: "characterRefs",      label: "Character tags",          icon: "👤" },
  { key: "speechSections",     label: "Speech sections",         icon: "💬" },
  { key: "wordTagRefs",        label: "Word / concept tags",     icon: "🏷" },
  { key: "lineIndents",        label: "Indentations",            icon: "↳" },
  { key: "clauseRelationships",label: "Clause arcs",             icon: "⤢" },
  { key: "wordArrows",         label: "Arrows",                  icon: "↗" },
  { key: "wordFormatting",     label: "Bold / italic formatting",icon: "B" },
];

interface Props {
  /** Human-readable scope label shown in the warning, e.g. "Genesis 1" */
  scopeLabel: string;
  book: string;
  textSource: string;
  startChapter: number;
  endChapter: number;
  /** Subset of categories to offer. If omitted, all eight are shown. */
  availableCategories?: ClearCategory[];
  onClose: () => void;
  /** Called after a successful clear with the list of cleared categories. */
  onCleared: (cleared: ClearCategory[]) => void;
}

export default function ClearAnnotationsDialog({
  scopeLabel,
  book,
  textSource,
  startChapter,
  endChapter,
  availableCategories,
  onClose,
  onCleared,
}: Props) {
  const categories = availableCategories
    ? CATEGORY_META.filter((m) => availableCategories.includes(m.key))
    : CATEGORY_META;

  const [checked, setChecked] = useState<Set<ClearCategory>>(
    () => new Set(categories.map((c) => c.key))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel on open
  useEffect(() => { cancelRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(key: ClearCategory) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectAll() { setChecked(new Set(categories.map((c) => c.key))); }
  function selectNone() { setChecked(new Set()); }

  async function handleClear() {
    if (checked.size === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clear-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book,
          textSource,
          startChapter,
          endChapter,
          categories: [...checked],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Clear failed.");
        return;
      }
      const { cleared } = await res.json() as { cleared: ClearCategory[] };
      onCleared(cleared);
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-lg shadow-xl border"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Clear annotations
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--foreground)" }}
            aria-label="Close"
          >×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Warning */}
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Permanently delete the selected annotations for{" "}
            <span className="font-semibold" style={{ color: "var(--foreground)" }}>
              {scopeLabel}
            </span>
            . This cannot be undone.
          </p>

          {/* Select all / none */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Categories
            </span>
            <button
              onClick={selectAll}
              className="text-xs underline"
              style={{ color: "var(--accent)" }}
              type="button"
            >
              all
            </button>
            <button
              onClick={selectNone}
              className="text-xs underline"
              style={{ color: "var(--accent)" }}
              type="button"
            >
              none
            </button>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            {categories.map(({ key, label, icon }) => (
              <label
                key={key}
                className="flex items-center gap-3 cursor-pointer select-none group"
              >
                <input
                  type="checkbox"
                  checked={checked.has(key)}
                  onChange={() => toggle(key)}
                  className="w-4 h-4 rounded accent-red-600"
                />
                <span
                  className="w-5 text-center text-sm select-none"
                  style={{ color: "var(--text-muted)" }}
                >
                  {icon}
                </span>
                <span className="text-sm" style={{ color: "var(--foreground)" }}>
                  {label}
                </span>
              </label>
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            ref={cancelRef}
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{ color: "var(--text-muted)" }}
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleClear}
            disabled={checked.size === 0 || loading}
            className="px-4 py-1.5 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-40"
            type="button"
          >
            {loading ? "Clearing…" : `Clear ${checked.size === categories.length ? "all" : checked.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}
