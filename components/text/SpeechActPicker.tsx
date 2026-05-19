"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Taxonomy ─────────────────────────────────────────────────────────────────

export const SPEECH_ACT_TAXONOMY = {
  assertive: {
    label: "Assertive",
    fullLabel: "Assertive (Describe Reality)",
    description: "Commits the speaker to the truth of a proposition.",
    children: {
      statement:  { label: "Statement / Fact",       description: "Informing, reporting, or stating a fact." },
      claim:      { label: "Claim / Argument",        description: "Making an assertion open to debate or requiring proof." },
      hypothesis: { label: "Hypothesis / Speculation",description: "Conjecturing, guessing, or theorizing." },
      prediction: { label: "Prediction",              description: "Foretelling a future state or event." },
      denial:     { label: "Denial",                  description: "Contradicting a fact, claim, or accusation." },
      conclusion: { label: "Conclusion",              description: "Deducing or concluding based on evidence." },
    },
  },
  directive: {
    label: "Directive",
    fullLabel: "Directive (Influence Others)",
    description: "Attempts to get the listener to perform an action.",
    children: {
      command:     { label: "Command / Order",    description: "Authoritative, mandatory instruction." },
      request:     { label: "Request / Ask",      description: "A polite or standard call for action." },
      suggestion:  { label: "Suggestion / Advice",description: "Offering a recommended course of action." },
      prohibition: { label: "Prohibition",        description: "Explicitly disallowing an action." },
      invitation:  { label: "Invitation",         description: "Courteously asking someone to join an event or action." },
      entreaty:    { label: "Plead / Beg",        description: "High-urgency or emotional request." },
    },
  },
  commissive: {
    label: "Commissive",
    fullLabel: "Commissive (Bind the Self)",
    description: "Commits the speaker to a future course of action.",
    children: {
      promise:   { label: "Promise / Assurance", description: "Commits the speaker to a strict obligation." },
      offer:     { label: "Offer",               description: "Proposing an action conditional on acceptance." },
      threat:    { label: "Threat",              description: "Committing to an adverse action if conditions aren't met." },
      refusal:   { label: "Refusal / Rejection", description: "Explicitly declining an action or demand." },
      volunteer: { label: "Volunteer / Pledge",  description: "Freely taking on a task, duty, or oath." },
    },
  },
  expressive: {
    label: "Expressive",
    fullLabel: "Expressive (Share Internal State)",
    description: "Expresses a psychological attitude or emotional state.",
    children: {
      thanks:         { label: "Thanking",           description: "Expressing gratitude." },
      apology:        { label: "Apologizing",         description: "Expressing regret, remorse, or asking forgiveness." },
      congratulation: { label: "Congratulating",      description: "Applauding or celebrating an achievement." },
      complaint:      { label: "Complaint / Lament",  description: "Expressing dissatisfaction, frustration, or grief." },
      greeting:       { label: "Greeting / Welcome",  description: "Standard social opening or acknowledgment." },
    },
  },
  declaration: {
    label: "Declaration",
    fullLabel: "Declaration (Change Status)",
    description: "Alters systemic or institutional reality the moment it is spoken.",
    children: {
      appointment: { label: "Appoint / Dismiss",    description: "Granting or stripping institutional roles (e.g., hiring, firing)." },
      resignation:  { label: "Resignation",          description: "Voluntarily stepping down from a status or office." },
      naming:       { label: "Naming / Christening", description: "Assigning a formal identity to an entity." },
      ruling:       { label: "Ruling / Decree",      description: "Official judgment or authoritative declaration." },
    },
  },
} as const;

type CategoryKey = keyof typeof SPEECH_ACT_TAXONOMY;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getSpeechActLeafLabel(value: string): string {
  if (!value) return value;
  if (!value.includes(".")) return value; // legacy flat values — display as-is
  const [cat, leaf] = value.split(".") as [CategoryKey, string];
  const category = SPEECH_ACT_TAXONOMY[cat];
  if (!category) return value;
  const leafNode = (category.children as Record<string, { label: string }>)[leaf];
  return leafNode?.label ?? value;
}

// ── Pinned quick-tags ─────────────────────────────────────────────────────────

const PINNED: { value: string; shortLabel: string }[] = [
  { value: "directive.command",  shortLabel: "Command"   },
  { value: "assertive.statement", shortLabel: "Statement" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function SpeechActPicker({
  value,
  onChange,
  presentationMode = false,
}: {
  value: string;
  onChange: (v: string) => void;
  presentationMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hoveredCat, setHoveredCat] = useState<CategoryKey | null>(null);
  const [dropPos, setDropPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

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
  const displayLabel = value ? getSpeechActLeafLabel(value) : null;

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
        <span className="truncate">{displayLabel ?? "— Speech act (optional) —"}</span>
        {displayLabel ? (
          <span
            role="button"
            aria-label="Clear speech act"
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
            {(Object.entries(SPEECH_ACT_TAXONOMY) as [CategoryKey, (typeof SPEECH_ACT_TAXONOMY)[CategoryKey]][]).map(
              ([key, cat]) => (
                <div
                  key={key}
                  onMouseEnter={() => setHoveredCat(key)}
                  className={[
                    "px-2.5 py-2 cursor-pointer flex items-start justify-between gap-2 transition-colors",
                    hoveredCat === key
                      ? "bg-indigo-50 dark:bg-indigo-900/30"
                      : "hover:bg-stone-50 dark:hover:bg-stone-700/50",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold text-stone-700 dark:text-stone-200 leading-tight">
                      {cat.label}
                    </div>
                    <div className="text-[9px] text-stone-400 dark:text-stone-500 leading-snug mt-0.5">
                      {cat.description}
                    </div>
                  </div>
                  <span className="shrink-0 text-stone-300 dark:text-stone-600 text-[11px] mt-0.5">›</span>
                </div>
              )
            )}
          </div>

          {/* ── Right panel: leaf nodes ── */}
          {hoveredCat && (
            <div
              className="bg-stone-50 dark:bg-stone-900 border-l border-stone-200 dark:border-stone-700 flex flex-col overflow-y-auto"
              style={{ width: 224 }}
            >
              <div className="px-2.5 pt-2 pb-1 border-b border-stone-100 dark:border-stone-700 shrink-0">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {SPEECH_ACT_TAXONOMY[hoveredCat].fullLabel}
                </div>
              </div>

              {(
                Object.entries(SPEECH_ACT_TAXONOMY[hoveredCat].children) as [
                  string,
                  { label: string; description: string },
                ][]
              ).map(([leafKey, leaf]) => {
                const dotValue = `${hoveredCat}.${leafKey}`;
                const isSelected = value === dotValue;
                return (
                  <div
                    key={leafKey}
                    onClick={() => select(dotValue)}
                    className={[
                      "px-2.5 py-2 cursor-pointer transition-colors border-b border-stone-100 dark:border-stone-800 last:border-0",
                      isSelected
                        ? "bg-indigo-50 dark:bg-indigo-900/40"
                        : "hover:bg-white dark:hover:bg-stone-800",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "text-[11px] font-medium leading-tight flex items-center gap-1",
                        isSelected
                          ? "text-indigo-700 dark:text-indigo-300"
                          : "text-stone-700 dark:text-stone-200",
                      ].join(" ")}
                    >
                      {isSelected && <span className="text-[9px]">✓</span>}
                      {leaf.label}
                    </div>
                    <div className="text-[9px] text-stone-400 dark:text-stone-500 leading-snug mt-0.5">
                      {leaf.description}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
