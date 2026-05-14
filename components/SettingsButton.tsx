"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import type { TranslationPref } from "@/components/notes/ScriptureTooltip";
import { LOCALES } from "@/lib/i18n/translations";

export type GreekLexicon  = "AbbottSmith" | "Dodson";
export type HebrewLexicon = "BDB" | "HebrewStrong";

const GREEK_LEX_KEY  = "structura:greekLexicon";
const HEBREW_LEX_KEY = "structura:hebrewLexicon";
const SCRIPTURE_PREF_KEY = (locale: string) => `scripture:tooltipTranslation:${locale}`;

export function getGreekLexicon(): GreekLexicon {
  if (typeof window === "undefined") return "AbbottSmith";
  return (localStorage.getItem(GREEK_LEX_KEY) as GreekLexicon) ?? "AbbottSmith";
}

export function getHebrewLexicon(): HebrewLexicon {
  if (typeof window === "undefined") return "BDB";
  return (localStorage.getItem(HEBREW_LEX_KEY) as HebrewLexicon) ?? "BDB";
}

// Hardcoded well-known api.bible translation IDs per locale
const KNOWN_API_BIBLES: Record<string, Array<{ id: string; name: string }>> = {
  en: [
    { id: "a761ca71e0b3ddcf-01", name: "NASB 2020" },
    { id: "d6e14a625393b4da-01", name: "NLT" },
    { id: "65eec8e0b60e656b-01", name: "NIV (2011)" },
    { id: "9879dbb7cfe39e4d-04", name: "KJV" },
  ],
  vi: [
    { id: "2VSB", name: "Bản Truyền Thống (VIE 1925)" },
  ],
};

interface LocalTranslation {
  id: number;
  name: string;
  abbreviation: string;
  language: string | null;
}

// Serialise a pref to the select value string
function prefToValue(pref: TranslationPref | null): string {
  if (!pref) return "";
  if (pref.source === "local") return `local:${pref.id}`;
  return `api:${pref.bibleId}`;
}

// Deserialise a select value string to a pref
function valueToPref(value: string, localTransls: LocalTranslation[]): TranslationPref | null {
  if (!value) return null;
  if (value.startsWith("local:")) {
    const id = parseInt(value.slice(6), 10);
    const tr = localTransls.find((t) => t.id === id);
    return { source: "local", id, abbr: tr?.abbreviation };
  }
  if (value.startsWith("api:")) {
    const bibleId = value.slice(4);
    const name = Object.values(KNOWN_API_BIBLES).flat().find((b) => b.id === bibleId)?.name;
    return { source: "api", bibleId, abbr: name };
  }
  return null;
}

export default function SettingsButton() {
  const { t } = useTranslation();
  const [open, setOpen]               = useState(false);
  const [greekLex, setGreekLex]       = useState<GreekLexicon>("AbbottSmith");
  const [hebrewLex, setHebrewLex]     = useState<HebrewLexicon>("BDB");
  const panelRef                      = useRef<HTMLDivElement>(null);

  // Scripture tooltip preferences
  const [apiBibleKeyInput, setApiBibleKeyInput]   = useState("");
  const [hasApiBibleKey,   setHasApiBibleKey]     = useState(false);
  const [savingKey,        setSavingKey]           = useState(false);
  const [localTransls,     setLocalTransls]        = useState<LocalTranslation[]>([]);
  const [scripturePrefs,   setScripturePrefs]      = useState<Record<string, string>>({});

  // Load stored preferences on mount
  useEffect(() => {
    setGreekLex(getGreekLexicon());
    setHebrewLex(getHebrewLexicon());
    // Load scripture pref values from localStorage
    const prefs: Record<string, string> = {};
    for (const locale of LOCALES) {
      try {
        const raw = localStorage.getItem(SCRIPTURE_PREF_KEY(locale));
        if (raw) {
          const pref = JSON.parse(raw) as TranslationPref;
          prefs[locale] = prefToValue(pref);
        }
      } catch { /* ignore */ }
    }
    setScripturePrefs(prefs);
  }, []);

  // Load api.bible key status and local translations when panel opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/credentials/apibible")
      .then((r) => r.json())
      .then((d: { hasApiKey?: boolean }) => setHasApiBibleKey(d.hasApiKey ?? false))
      .catch(() => {});
    fetch("/api/translations")
      .then((r) => r.json())
      .then((rows: LocalTranslation[]) => setLocalTransls(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [open]);

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

  async function saveApiBibleKey() {
    const key = apiBibleKeyInput.trim();
    if (!key) return;
    setSavingKey(true);
    try {
      await fetch("/api/credentials/apibible", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      setHasApiBibleKey(true);
      setApiBibleKeyInput("");
    } finally {
      setSavingKey(false);
    }
  }

  async function clearApiBibleKey() {
    await fetch("/api/credentials/apibible", { method: "DELETE" });
    setHasApiBibleKey(false);
    setApiBibleKeyInput("");
  }

  function changeScripturePref(locale: string, value: string) {
    setScripturePrefs((prev) => ({ ...prev, [locale]: value }));
    const pref = valueToPref(value, localTransls);
    if (pref) {
      localStorage.setItem(SCRIPTURE_PREF_KEY(locale), JSON.stringify(pref));
    } else {
      localStorage.removeItem(SCRIPTURE_PREF_KEY(locale));
    }
  }

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
          <div className="mb-4">
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

          {/* Scripture Tooltips */}
          <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              {t("settings.scriptureTooltips")}
            </p>

            {/* api.bible API key */}
            <div className="mb-3">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--foreground)" }}>
                {t("settings.apiBibleKey")}
              </p>
              <div className="flex gap-1">
                <input
                  type="password"
                  value={apiBibleKeyInput}
                  onChange={(e) => setApiBibleKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveApiBibleKey(); }}
                  placeholder={hasApiBibleKey ? "••••••••" : t("settings.apiBibleKeyPlaceholder")}
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                    color: "var(--foreground)",
                  }}
                />
                <button
                  onClick={saveApiBibleKey}
                  disabled={savingKey || !apiBibleKeyInput.trim()}
                  className="text-xs px-2 py-1 rounded disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  {t("settings.save")}
                </button>
              </div>
              {hasApiBibleKey && (
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("settings.apiBibleKeySaved")}
                  </span>
                  <button
                    onClick={clearApiBibleKey}
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("settings.apiBibleClear")}
                  </button>
                </div>
              )}
            </div>

            {/* Per-locale translation dropdowns */}
            {LOCALES.map((locale) => (
              <div key={locale} className="mb-2">
                <p className="text-xs font-medium mb-1" style={{ color: "var(--foreground)" }}>
                  {t(`settings.tooltipTranslation_${locale}` as Parameters<typeof t>[0])}
                </p>
                <select
                  value={scripturePrefs[locale] ?? ""}
                  onChange={(e) => changeScripturePref(locale, e.target.value)}
                  className="w-full text-xs px-2 py-1 rounded border outline-none"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                    color: "var(--foreground)",
                  }}
                >
                  <option value="">{t("settings.tooltipTranslationAuto")}</option>

                  {localTransls.length > 0 && (
                    <optgroup label={t("settings.tooltipTranslationLocal")}>
                      {localTransls.map((tr) => (
                        <option key={tr.id} value={`local:${tr.id}`}>
                          {tr.abbreviation}{tr.name !== tr.abbreviation ? ` — ${tr.name}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {hasApiBibleKey && KNOWN_API_BIBLES[locale]?.length > 0 && (
                    <optgroup label={t("settings.tooltipTranslationApi")}>
                      {KNOWN_API_BIBLES[locale].map((b) => (
                        <option key={b.id} value={`api:${b.id}`}>{b.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
