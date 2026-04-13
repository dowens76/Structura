"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";

export type GreekLexicon  = "AbbottSmith" | "Dodson";
export type HebrewLexicon = "BDB" | "HebrewStrong";

const GREEK_LEX_KEY  = "structura:greekLexicon";
const HEBREW_LEX_KEY = "structura:hebrewLexicon";

export function getGreekLexicon(): GreekLexicon {
  if (typeof window === "undefined") return "AbbottSmith";
  return (localStorage.getItem(GREEK_LEX_KEY) as GreekLexicon) ?? "AbbottSmith";
}

export function getHebrewLexicon(): HebrewLexicon {
  if (typeof window === "undefined") return "BDB";
  return (localStorage.getItem(HEBREW_LEX_KEY) as HebrewLexicon) ?? "BDB";
}

export default function SettingsButton() {
  const { t } = useTranslation();
  const [open, setOpen]               = useState(false);
  const [greekLex, setGreekLex]       = useState<GreekLexicon>("AbbottSmith");
  const [hebrewLex, setHebrewLex]     = useState<HebrewLexicon>("BDB");
  const panelRef                      = useRef<HTMLDivElement>(null);

  // Load stored preferences on mount
  useEffect(() => {
    setGreekLex(getGreekLexicon());
    setHebrewLex(getHebrewLexicon());
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function changeGreekLex(v: GreekLexicon) {
    setGreekLex(v);
    localStorage.setItem(GREEK_LEX_KEY, v);
    // Notify other components on the same page
    window.dispatchEvent(new CustomEvent("structura:settingsChange", { detail: { greekLexicon: v } }));
  }

  function changeHebrewLex(v: HebrewLexicon) {
    setHebrewLex(v);
    localStorage.setItem(HEBREW_LEX_KEY, v);
    window.dispatchEvent(new CustomEvent("structura:settingsChange", { detail: { hebrewLexicon: v } }));
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("settings.title")}
        title={t("settings.title")}
        className="flex items-center justify-center w-7 h-7 rounded transition-colors"
        style={{ color: open ? "var(--accent)" : "var(--nav-fg-muted)" }}
      >
        {/* Gear icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border shadow-lg z-50 py-3 px-4"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            {t("settings.title")}
          </p>

          {/* Greek Lexicon */}
          <div className="mb-4">
            <p className="text-xs font-medium mb-1.5" style={{ color: "var(--foreground)" }}>
              {t("settings.greekLexicon")}
            </p>
            <div className="flex flex-col gap-1">
              {(
                [
                  ["AbbottSmith", t("settings.abbottSmith")],
                  ["Dodson",      t("settings.dodson")],
                ] as [GreekLexicon, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="greek-lexicon"
                    value={value}
                    checked={greekLex === value}
                    onChange={() => changeGreekLex(value)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm" style={{ color: "var(--foreground)" }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Hebrew Lexicon */}
          <div>
            <p className="text-xs font-medium mb-1.5" style={{ color: "var(--foreground)" }}>
              {t("settings.hebrewLexicon")}
            </p>
            <div className="flex flex-col gap-1">
              {(
                [
                  ["BDB",          t("settings.bdb")],
                  ["HebrewStrong", t("settings.strongHebrew")],
                ] as [HebrewLexicon, string][]
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="hebrew-lexicon"
                    value={value}
                    checked={hebrewLex === value}
                    onChange={() => changeHebrewLex(value)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-sm" style={{ color: "var(--foreground)" }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
