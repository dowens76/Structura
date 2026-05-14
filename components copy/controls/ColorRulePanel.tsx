"use client";

import { useEffect, useRef, useState } from "react";
import {
  RULE_PALETTE,
  HEBREW_FIELDS,
  GREEK_FIELDS,
  generateRuleLabel,
  type ColorRule,
  type RuleConditions,
  type FieldDef,
} from "@/lib/morphology/colorRules";

interface ColorRulePanelProps {
  rules: ColorRule[];
  onChange: (rules: ColorRule[]) => void;
  isHebrew: boolean;
}

const EMPTY_DRAFT: RuleConditions = {};

export default function ColorRulePanel({ rules, onChange, isHebrew }: ColorRulePanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RuleConditions>(EMPTY_DRAFT);
  const [draftColor, setDraftColor] = useState(RULE_PALETTE[0]);
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

  const fields: FieldDef[] = isHebrew ? HEBREW_FIELDS : GREEK_FIELDS;

  const hasConditions = Object.values(draft).some((v) => v && v.length > 0);

  function toggleDraft(key: keyof RuleConditions, val: string) {
    setDraft((prev) => {
      const cur = (prev[key] as string[] | undefined) ?? [];
      const next = cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
      const updated = { ...prev, [key]: next.length ? next : undefined };
      // Remove undefined keys for cleanliness
      return Object.fromEntries(
        Object.entries(updated).filter(([, v]) => v !== undefined)
      ) as RuleConditions;
    });
  }

  function addRule() {
    if (!hasConditions) return;
    const label = generateRuleLabel(draft);
    const newRule: ColorRule = {
      id: Date.now().toString(),
      label,
      color: draftColor,
      conditions: { ...draft },
    };
    onChange([...rules, newRule]);
    setDraft(EMPTY_DRAFT);
    setDraftColor(RULE_PALETTE[(rules.length + 1) % RULE_PALETTE.length]);
  }

  function removeRule(id: string) {
    onChange(rules.filter((r) => r.id !== id));
  }

  const triggerClass =
    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors";

  const pillClass = (selected: boolean) =>
    [
      "px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer",
      selected
        ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
        : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
    ].join(" ");

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button onClick={() => setOpen((o) => !o)} className={triggerClass}>
        <span>Color Rules</span>
        {rules.length > 0 && (
          <span className="text-stone-400 dark:text-stone-500">({rules.length})</span>
        )}
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg w-[500px] max-h-[520px] overflow-y-auto p-3">

          {/* Active rules */}
          {rules.length > 0 && (
            <>
              <div className="mb-2 space-y-1">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-stone-50 dark:bg-stone-900"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: rule.color }}
                    />
                    <span className="text-xs flex-1 text-stone-700 dark:text-stone-200">
                      {rule.label}
                    </span>
                    <button
                      onClick={() => removeRule(rule.id)}
                      className="text-stone-400 hover:text-red-500 text-base leading-none transition-colors"
                      title="Remove rule"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--border)] mb-3" />
            </>
          )}

          {/* Builder header */}
          <p className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2">
            Build a Rule
          </p>

          {/* Field groups */}
          {fields.map((field) => {
            const selected = (draft[field.key] as string[] | undefined) ?? [];
            return (
              <div key={field.key} className="mb-2.5">
                <span className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider block mb-1">
                  {field.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {field.values.map((val) => (
                    <button
                      key={val}
                      onClick={() => toggleDraft(field.key, val)}
                      className={pillClass(selected.includes(val))}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Color picker */}
          <div className="flex items-center gap-1.5 mt-3 mb-3">
            <span className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mr-1 shrink-0">
              Color
            </span>
            {RULE_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setDraftColor(c)}
                title={c}
                className={[
                  "w-5 h-5 rounded-full transition-transform shrink-0",
                  draftColor === c
                    ? "scale-125 ring-2 ring-offset-1 ring-stone-400 dark:ring-stone-500"
                    : "",
                ].join(" ")}
                style={{ background: c }}
              />
            ))}
            {/* Custom color input */}
            <div className="relative ml-0.5 shrink-0" title="Custom color">
              <div
                className="w-5 h-5 rounded-full border border-stone-300 dark:border-stone-600 overflow-hidden cursor-pointer"
                style={{ background: RULE_PALETTE.includes(draftColor) ? "#e7e5e4" : draftColor }}
              />
              <input
                type="color"
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                title="Custom color"
              />
            </div>
          </div>

          {/* Add rule */}
          <button
            onClick={addRule}
            disabled={!hasConditions}
            className="w-full py-1.5 rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add Rule
          </button>
        </div>
      )}
    </div>
  );
}
