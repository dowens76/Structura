"use client";

import { useEffect, useRef, useState, RefObject } from "react";

export interface ToolbarVisibility {
  tooltips: boolean;
  qatal: boolean;
  atnach: boolean;
  scenes: boolean;
  outline: boolean;
  annotations: boolean;
  atnachInsert: boolean;
  paragraphs: boolean;
  indents: boolean;
  rst: boolean;
  arrows: boolean;
  bold: boolean;
  italic: boolean;
  refs: boolean;
  speech: boolean;
  wordTags: boolean;
  clear: boolean;
  notes: boolean;
  search: boolean;
  translations: boolean;
}

export const DEFAULT_TOOLBAR_VIS: ToolbarVisibility = {
  tooltips: true, qatal: true, atnach: true, scenes: true, outline: true,
  annotations: true, atnachInsert: true, paragraphs: true, indents: true,
  rst: true, arrows: true, bold: true, italic: true,
  refs: true, speech: true, wordTags: true, clear: true,
  notes: true, search: true, translations: true,
};

interface Props {
  visibility: ToolbarVisibility;
  onChange: (key: keyof ToolbarVisibility, val: boolean) => void;
  onClose: () => void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
}

const SECTIONS: { label: string; items: { key: keyof ToolbarVisibility; label: string; hebrew?: true }[] }[] = [
  {
    label: "View",
    items: [
      { key: "tooltips", label: "Tooltips" },
      { key: "qatal",    label: "Qatal", hebrew: true },
    ],
  },
  {
    label: "Structure",
    items: [
      { key: "atnach",      label: "Atnach",       hebrew: true },
      { key: "scenes",      label: "§ Sections" },
      { key: "outline",     label: "📋 Outline" },
      { key: "annotations", label: "≡ Annotations" },
      { key: "atnachInsert",label: "¶ Atnach",     hebrew: true },
      { key: "paragraphs",  label: "¶ Paragraphs" },
      { key: "indents",     label: "⇥ Indents" },
      { key: "rst",         label: "↳ RST" },
      { key: "arrows",      label: "↷ Arrows" },
    ],
  },
  {
    label: "Formatting",
    items: [
      { key: "bold",   label: "B Bold" },
      { key: "italic", label: "I Italic" },
    ],
  },
  {
    label: "Tags",
    items: [
      { key: "refs",     label: "👤 Characters" },
      { key: "speech",   label: "💬 Speech" },
      { key: "wordTags", label: "🏷 Word tags" },
    ],
  },
  {
    label: "Utilities",
    items: [
      { key: "clear",  label: "🗑 Clear" },
      { key: "notes",  label: "📝 Notes" },
      { key: "search", label: "🔍 Search" },
    ],
  },
  {
    label: "Translations",
    items: [
      { key: "translations", label: "Tr: Translations" },
    ],
  },
];

export default function ToolbarCustomizer({ visibility, onChange, onClose, anchorRef }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const panelHeight = 480; // generous estimate; panel is max-h-[70vh]
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= panelHeight || spaceBelow >= 200
        ? rect.bottom + 4
        : rect.top - panelHeight - 4;
      setPos({ top, right: window.innerWidth - rect.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef?.current !== e.target && !anchorRef?.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, anchorRef]);

  const allOn = Object.values(visibility).every(Boolean);

  return (
    <div
      ref={panelRef}
      className="z-50 w-52 rounded-lg shadow-xl border border-[var(--border)] overflow-hidden"
      style={{
        backgroundColor: "var(--background)",
        position: pos ? "fixed" : "absolute",
        top: pos?.top ?? "100%",
        right: pos?.right ?? 0,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
          Toolbar
        </span>
        <button
          onClick={() => {
            const key = Object.keys(DEFAULT_TOOLBAR_VIS) as (keyof ToolbarVisibility)[];
            key.forEach(k => onChange(k, true));
          }}
          className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
          title="Show all buttons"
        >
          Reset
        </button>
      </div>

      {/* Sections */}
      <div className="py-1 max-h-[70vh] overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {section.label}
            </div>
            {section.items.map(({ key, label, hebrew }) => {
              const on = visibility[key];
              return (
                <label
                  key={key}
                  className="flex items-center justify-between px-3 py-1 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60 select-none"
                >
                  <span className="text-[13px] text-stone-700 dark:text-stone-300 flex items-center gap-1.5">
                    {label}
                    {hebrew && (
                      <span className="text-[9px] text-stone-400 dark:text-stone-500 font-normal">Heb</span>
                    )}
                  </span>
                  {/* Toggle switch */}
                  <button
                    role="switch"
                    aria-checked={on}
                    onClick={() => onChange(key, !on)}
                    className={[
                      "relative w-8 h-[18px] rounded-full transition-colors flex-shrink-0",
                      on ? "bg-blue-500" : "bg-stone-300 dark:bg-stone-600",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform",
                        on ? "translate-x-[14px]" : "translate-x-0",
                      ].join(" ")}
                    />
                  </button>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: hide all / show all */}
      <div className="border-t border-[var(--border)] px-3 py-2 flex justify-end gap-2">
        <button
          onClick={() => {
            const keys = Object.keys(DEFAULT_TOOLBAR_VIS) as (keyof ToolbarVisibility)[];
            keys.forEach(k => onChange(k, false));
          }}
          className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
        >
          Hide all
        </button>
        <button
          onClick={() => {
            const keys = Object.keys(DEFAULT_TOOLBAR_VIS) as (keyof ToolbarVisibility)[];
            keys.forEach(k => onChange(k, true));
          }}
          className={[
            "text-[11px] transition-colors",
            allOn ? "text-stone-300 dark:text-stone-600" : "text-blue-500 hover:text-blue-600 dark:hover:text-blue-400",
          ].join(" ")}
          disabled={allOn}
        >
          Show all
        </button>
      </div>
    </div>
  );
}
