"use client";

import { useEffect, useRef, useState } from "react";
import type { Translation } from "@/lib/db/schema";

const LANGUAGES = [
  "Afrikaans", "Arabic", "Armenian", "Bulgarian",
  "Chinese (Simplified)", "Chinese (Traditional)",
  "Czech", "Danish", "Dutch", "English",
  "Finnish", "French", "German", "Greek",
  "Hebrew (Modern)", "Hindi", "Hungarian",
  "Indonesian", "Italian", "Japanese", "Korean",
  "Latin", "Norwegian", "Polish", "Portuguese",
  "Romanian", "Russian", "Serbian", "Spanish",
  "Swahili", "Swedish", "Tamil", "Turkish",
  "Ukrainian", "Vietnamese",
];

interface TranslationPickerProps {
  availableTranslations: Translation[];
  activeTranslationIds: Set<number>;
  onToggle: (id: number) => void;
}

export default function TranslationPicker({
  availableTranslations,
  activeTranslationIds,
  onToggle,
}: TranslationPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local language state — seeded from props, updated optimistically
  const [languages, setLanguages] = useState<Map<number, string | null>>(
    () => new Map(availableTranslations.map((t) => [t.id, t.language ?? null]))
  );

  // Sync if the translation list changes (e.g. on navigation)
  useEffect(() => {
    setLanguages(new Map(availableTranslations.map((t) => [t.id, t.language ?? null])));
  }, [availableTranslations]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLanguageChange(id: number, lang: string | null) {
    // Optimistic update
    setLanguages((prev) => new Map(prev).set(id, lang));
    try {
      await fetch("/api/translations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, language: lang }),
      });
    } catch {
      // Roll back on network error
      setLanguages((prev) => {
        const next = new Map(prev);
        const original = availableTranslations.find((t) => t.id === id)?.language ?? null;
        next.set(id, original);
        return next;
      });
    }
  }

  const activeCount = availableTranslations.filter((t) => activeTranslationIds.has(t.id)).length;
  const activeAbbrs = availableTranslations
    .filter((t) => activeTranslationIds.has(t.id))
    .map((t) => t.abbreviation);

  const buttonLabel =
    activeCount === 0
      ? "None"
      : activeAbbrs.length <= 2
      ? activeAbbrs.join(", ")
      : `${activeAbbrs[0]}, +${activeAbbrs.length - 1}`;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Select translations to display"
        className={[
          "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          open || activeCount > 0
            ? "bg-emerald-600 text-white"
            : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700",
        ].join(" ")}
      >
        <span className="font-mono">{buttonLabel}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute top-full mt-1 right-0 z-50 rounded-md border shadow-lg py-1"
          style={{
            minWidth: "320px",
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          {availableTranslations.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              No translations imported
            </div>
          ) : (
            <>
              {/* Column header */}
              <div
                className="flex items-center gap-2 px-3 pb-1 pt-0.5"
                style={{ borderBottom: "1px solid var(--border)", marginBottom: "2px" }}
              >
                <span className="w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wide w-14 flex-shrink-0" style={{ color: "var(--text-muted)" }}>Abbr</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide flex-1" style={{ color: "var(--text-muted)" }}>Name</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide w-28 flex-shrink-0" style={{ color: "var(--text-muted)" }}>Language</span>
              </div>

              {availableTranslations.map((t) => {
                const active = activeTranslationIds.has(t.id);
                const lang = languages.get(t.id) ?? null;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--surface-muted)] transition-colors"
                  >
                    {/* Toggle — left portion */}
                    <button
                      onClick={() => onToggle(t.id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      title={active ? `Hide ${t.name}` : `Show ${t.name}`}
                    >
                      {/* Checkbox */}
                      <span
                        className="flex-shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center"
                        style={{
                          borderColor: active ? "#059669" : "var(--border-muted)",
                          backgroundColor: active ? "#059669" : "transparent",
                        }}
                      >
                        {active && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      {/* Abbreviation badge */}
                      <span
                        className="flex-shrink-0 text-xs font-mono font-semibold px-1 py-0.5 rounded w-14 text-center"
                        style={{
                          backgroundColor: active ? "rgba(5,150,105,0.15)" : "var(--surface-muted)",
                          color: active ? "#059669" : "var(--text-muted)",
                        }}
                      >
                        {t.abbreviation}
                      </span>
                      {/* Full name */}
                      <span className="text-xs truncate" style={{ color: "var(--foreground)" }}>
                        {t.name}
                      </span>
                    </button>

                    {/* Language selector — independent of toggle */}
                    <select
                      value={lang ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleLanguageChange(t.id, e.target.value || null);
                      }}
                      className="flex-shrink-0 w-28 text-xs rounded px-1.5 py-0.5 border transition-colors"
                      style={{
                        backgroundColor: "var(--surface-muted)",
                        borderColor: lang ? "var(--border-muted)" : "var(--border-muted)",
                        color: lang ? "var(--foreground)" : "var(--text-muted)",
                      }}
                      title="Set translation language"
                    >
                      <option value="">— unset —</option>
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
