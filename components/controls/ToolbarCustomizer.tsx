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
  syllableStress: boolean;
  paragraphs: boolean;
  indents: boolean;
  rst: boolean;
  lineGroups: boolean;
  arrows: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: boolean;
  refs: boolean;
  speech: boolean;
  wordTags: boolean;
  clear: boolean;
  notes: boolean;
  search: boolean;
  bible: boolean;
  intertextual: boolean;
  translations: boolean;
  wordCompare: boolean;
  tc: boolean;
  poetry: boolean;
}

export const DEFAULT_TOOLBAR_VIS: ToolbarVisibility = {
  tooltips: true, qatal: true, atnach: true, scenes: true, outline: true,
  annotations: true, atnachInsert: true, syllableStress: true, paragraphs: true, indents: true,
  rst: true, lineGroups: true, arrows: true, bold: true, italic: true, underline: true, textColor: true,
  refs: true, speech: true, wordTags: true, clear: true,
  notes: true, search: true, bible: true, intertextual: true, translations: true,
  wordCompare: true, tc: true, poetry: true,
};

/**
 * Default toolbar visibility for a Synoptic View column — only Tooltips and
 * the "🆚 Compare" word-level marking tool (see the `editingWordCompare` state
 * in ChapterDisplay.tsx) stay on. Text size isn't gated by ToolbarVisibility
 * at all (always shown), so it needs no entry here. Everything else — including
 * Text Critical (TC) markup — defaults off to keep narrow side-by-side columns
 * uncluttered — the user can still re-enable any of it via the customizer.
 */
export const SYNOPTIC_DEFAULT_TOOLBAR_VIS: ToolbarVisibility = {
  tooltips: true, qatal: false, atnach: false, scenes: false, outline: false,
  annotations: false, atnachInsert: false, syllableStress: false, paragraphs: false, indents: false,
  rst: false, lineGroups: false, arrows: false, bold: false, italic: false, underline: false, textColor: false,
  refs: false, speech: false, wordTags: false, clear: false,
  notes: false, search: false, bible: false, intertextual: false, translations: false,
  wordCompare: true, tc: false, poetry: false,
};

interface Props {
  visibility: ToolbarVisibility;
  onChange: (key: keyof ToolbarVisibility, val: boolean) => void;
  onClose: () => void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  /** Used by the "Reset" button — defaults to DEFAULT_TOOLBAR_VIS (everything
   *  on). Pass SYNOPTIC_DEFAULT_TOOLBAR_VIS so Reset restores the Synoptic
   *  View's own minimal default instead of turning everything on. */
  defaultVisibility?: ToolbarVisibility;
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
      { key: "scenes",      label: "§ Sections" },
      { key: "outline",     label: "📋 Outline" },
      { key: "paragraphs",  label: "¶ Paragraphs" },
      { key: "atnach",      label: "Show Atnach", hebrew: true },
      { key: "atnachInsert",label: "¶ at Atnach", hebrew: true },
      { key: "syllableStress", label: "Syllable/Stress counts", hebrew: true },
      { key: "indents",     label: "⇥ Indents" },
      { key: "rst",         label: "↳ Clause Relationships" },
      { key: "lineGroups",  label: "⌐ Line Groups (poetry)" },
      { key: "annotations", label: "≡ Clause/Paragraph labels" },
      { key: "poetry",      label: "◈ Poetry notation (Gestalt principles)" },
      { key: "arrows",      label: "↷ Arrows" },
      { key: "tc",          label: "TC Text Critical markup" },
    ],
  },
  {
    label: "Formatting",
    items: [
      { key: "bold",      label: "B Bold" },
      { key: "italic",    label: "I Italic" },
      { key: "underline", label: "U Underline" },
      { key: "textColor", label: "A Text color" },
    ],
  },
  {
    label: "Comparison",
    items: [
      { key: "wordCompare", label: "🆚 Compare (word-level)" },
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
      { key: "bible",         label: "📖 Bible Lookup" },
      { key: "intertextual",  label: "⬡ Intertextual Links" },
    ],
  },
  {
    label: "Translations",
    items: [
      { key: "translations", label: "Tr: Translations" },
    ],
  },
];

export default function ToolbarCustomizer({ visibility, onChange, onClose, anchorRef, defaultVisibility = DEFAULT_TOOLBAR_VIS }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const margin = 8;
      const right = window.innerWidth - rect.right;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
        setPos({ top: rect.bottom + 4, right, maxHeight: Math.max(spaceBelow - 4, 150) });
      } else {
        setPos({ bottom: window.innerHeight - rect.top + 4, right, maxHeight: Math.max(spaceAbove - 4, 150) });
      }
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
      className="z-50 w-52 rounded-lg shadow-xl border border-[var(--border)] overflow-hidden flex flex-col"
      style={{
        backgroundColor: "var(--background)",
        position: pos ? "fixed" : "absolute",
        top: pos?.top,
        bottom: pos?.bottom,
        right: pos?.right ?? 0,
        maxHeight: pos ? pos.maxHeight : "70vh",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
          Toolbar
        </span>
        <button
          onClick={() => {
            const keys = Object.keys(DEFAULT_TOOLBAR_VIS) as (keyof ToolbarVisibility)[];
            keys.forEach(k => onChange(k, defaultVisibility[k]));
          }}
          className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
          title="Restore defaults"
        >
          Reset
        </button>
      </div>

      {/* Sections */}
      <div className="py-1 overflow-y-auto flex-1 min-h-0">
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
      <div className="border-t border-[var(--border)] px-3 py-2 flex justify-end gap-2 shrink-0">
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
