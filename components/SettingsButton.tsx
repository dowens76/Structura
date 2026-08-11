"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/LocaleContext";
import type { TranslationPref } from "@/components/notes/ScriptureTooltip";
import type { FetchBibleTranslation } from "@/app/api/fetchbible/route";
import { LOCALES } from "@/lib/i18n/translations";
import {
  applyFontSettings,
  readFontSettingsFromStorage,
  FONT_SETTINGS_LS_KEY,
  type FontSettings,
} from "@/lib/fonts";
import {
  applyUiFontSize,
  readUiFontSizeFromStorage,
  writeUiFontSizeToStorage,
  type UiFontSizeKey,
} from "@/lib/uiFontSize";
import { langLabel, readBibleLookupLangs, writeBibleLookupLangs } from "@/lib/utils/bible-lookup-langs";
import FontPickerDialog, { type FontLanguage } from "@/components/FontPickerDialog";
import { fetchJsonRetry } from "@/lib/utils/fetchJsonRetry";

export type GreekLexicon  = "AbbottSmith" | "Dodson" | "UBSGreek";
export type HebrewLexicon = "BDB" | "UBSHebrew";

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

// ISO 639-1 locale → ISO 639-3 language code used by fetch.bible
const LOCALE_LANG: Record<string, string> = { en: "eng", vi: "vie" };

// Serialise a pref to the select value string
function prefToValue(pref: TranslationPref | null): string {
  if (!pref) return "";
  if (pref.source === "local") return `local:${pref.id}`;
  if (pref.source === "fetchbible") return `fetchbible:${pref.translationId}`;
  return `api:${pref.bibleId}`;
}

// Deserialise a select value string to a pref
function valueToPref(
  value: string,
  localTransls: LocalTranslation[],
  fetchBibleTransls: FetchBibleTranslation[],
): TranslationPref | null {
  if (!value) return null;
  if (value.startsWith("local:")) {
    const id = parseInt(value.slice(6), 10);
    const tr = localTransls.find((t) => t.id === id);
    return { source: "local", id, abbr: tr?.abbreviation };
  }
  if (value.startsWith("fetchbible:")) {
    const translationId = value.slice(11);
    const abbr = fetchBibleTransls.find((t) => t.id === translationId)?.abbrev;
    return { source: "fetchbible", translationId, abbr };
  }
  if (value.startsWith("api:")) {
    const bibleId = value.slice(4);
    const name = Object.values(KNOWN_API_BIBLES).flat().find((b) => b.id === bibleId)?.name;
    return { source: "api", bibleId, abbr: name };
  }
  return null;
}

const ALL_SOURCES = ["OSHB", "SBLGNT", "LXX"] as const;
type SourceId = typeof ALL_SOURCES[number];

export function getHiddenSources(): SourceId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem("structura:hiddenSources");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function SettingsButton() {
  const { t } = useTranslation();
  const [open, setOpen]               = useState(false);
  const [greekLex, setGreekLex]       = useState<GreekLexicon>("AbbottSmith");
  const [hebrewLex, setHebrewLex]     = useState<HebrewLexicon>("BDB");
  const [hiddenSources, setHiddenSources] = useState<SourceId[]>([]);
  const [uiFontSize, setUiFontSize]   = useState<UiFontSizeKey>("md");
  const panelRef                      = useRef<HTMLDivElement>(null);

  // Custom font settings
  const [fontInputs, setFontInputs] = useState<Required<FontSettings>>({
    hebrew: "", greek: "", translation: "", transliteration: "",
  });
  const [savingFonts, setSavingFonts] = useState(false);
  const [fontSaved,   setFontSaved]   = useState(false);
  /** Which language's font picker is currently open, or null if closed. */
  const [pickerOpen, setPickerOpen]   = useState<FontLanguage | null>(null);

  // Scripture tooltip preferences
  const [apiBibleKeyInput, setApiBibleKeyInput]       = useState("");
  const [hasApiBibleKey,   setHasApiBibleKey]         = useState(false);
  const [savingKey,        setSavingKey]               = useState(false);
  const [localTransls,     setLocalTransls]            = useState<LocalTranslation[]>([]);
  const [fetchBibleTransls, setFetchBibleTransls]     = useState<FetchBibleTranslation[]>([]);
  const [scripturePrefs,   setScripturePrefs]          = useState<Record<string, string>>({});

  // Bible Lookup language filter
  const [bibleLangs,      setBibleLangs]      = useState<Set<string> | null>(null);
  const [bibleLangSearch, setBibleLangSearch] = useState("");

  // Zotero credentials
  const [zoteroUserId,    setZoteroUserId]    = useState("");
  const [zoteroApiKey,    setZoteroApiKey]    = useState("");
  const [hasZoteroKey,    setHasZoteroKey]    = useState(false);
  const [savingZotero,    setSavingZotero]    = useState(false);
  const [zoteroSaved,     setZoteroSaved]     = useState(false);

  // Load stored preferences on mount
  useEffect(() => {
    setGreekLex(getGreekLexicon());
    setHebrewLex(getHebrewLexicon());
    setUiFontSize(readUiFontSizeFromStorage());
    // Populate font inputs from localStorage (fast, no network round-trip)
    const saved = readFontSettingsFromStorage();
    setFontInputs({
      hebrew:          saved.hebrew          ?? "",
      greek:           saved.greek           ?? "",
      translation:     saved.translation     ?? "",
      transliteration: saved.transliteration ?? "",
    });
    fetch("/api/settings/hidden-sources")
      .then((r) => r.json())
      .then((d: { hidden?: string[] }) => {
        const hidden = (d.hidden ?? []) as SourceId[];
        setHiddenSources(hidden);
        sessionStorage.setItem("structura:hiddenSources", JSON.stringify(hidden));
      })
      .catch(() => {});
    setBibleLangs(readBibleLookupLangs());
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

  // Load api.bible key status, Zotero credentials, local translations, and fetch.bible list when panel opens.
  // Uses fetchJsonRetry so a transient failure doesn't overwrite a previously-confirmed
  // "configured" state with a false negative — null means "couldn't check", not "not configured".
  useEffect(() => {
    if (!open) return;
    fetchJsonRetry<{ hasApiKey?: boolean }>("/api/credentials/apibible").then((d) => {
      if (d) setHasApiBibleKey(d.hasApiKey ?? false);
    });
    fetchJsonRetry<{ userId?: string; hasApiKey?: boolean }>("/api/credentials/zotero").then((d) => {
      if (d) {
        setZoteroUserId(d.userId ?? "");
        setHasZoteroKey(d.hasApiKey ?? false);
      }
    });
    fetch("/api/translations")
      .then((r) => r.json())
      .then((rows: LocalTranslation[]) => setLocalTransls(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    if (fetchBibleTransls.length === 0) {
      fetch("/api/fetchbible")
        .then((r) => r.json())
        .then((rows: FetchBibleTranslation[]) => setFetchBibleTransls(Array.isArray(rows) ? rows : []))
        .catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function saveZoteroCredentials() {
    const uid = zoteroUserId.trim();
    const key = zoteroApiKey.trim();
    if (!uid) return;
    setSavingZotero(true);
    setZoteroSaved(false);
    try {
      const res = await fetch("/api/credentials/zotero", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, apiKey: key || undefined }),
      });
      if (res.ok) {
        setHasZoteroKey(true);
        setZoteroApiKey("");
        setZoteroSaved(true);
        setTimeout(() => setZoteroSaved(false), 3000);
      }
    } finally {
      setSavingZotero(false);
    }
  }

  async function clearZoteroCredentials() {
    await fetch("/api/credentials/zotero", { method: "DELETE" });
    setZoteroUserId("");
    setZoteroApiKey("");
    setHasZoteroKey(false);
  }

  function changeScripturePref(locale: string, value: string) {
    setScripturePrefs((prev) => ({ ...prev, [locale]: value }));
    const pref = valueToPref(value, localTransls, fetchBibleTransls);
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

  function changeUiFontSize(v: UiFontSizeKey) {
    setUiFontSize(v);
    writeUiFontSizeToStorage(v);
    applyUiFontSize(v);
    fetch("/api/settings/ui-font-size", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: v }),
    }).catch(() => {});
  }

  async function saveFontsImmediate(inputs: Required<FontSettings>) {
    if (savingFonts) return;
    setSavingFonts(true);
    try {
      const payload: FontSettings = {
        hebrew:          inputs.hebrew.trim()          || undefined,
        greek:           inputs.greek.trim()           || undefined,
        translation:     inputs.translation.trim()     || undefined,
        transliteration: inputs.transliteration.trim() || undefined,
      };
      await fetch("/api/settings/fonts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      localStorage.setItem(FONT_SETTINGS_LS_KEY, JSON.stringify(payload));
      applyFontSettings(payload);
      setFontSaved(true);
      setTimeout(() => setFontSaved(false), 2000);
    } finally {
      setSavingFonts(false);
    }
  }

  function saveFonts() {
    return saveFontsImmediate(fontInputs);
  }

  async function toggleHiddenSource(src: SourceId, hide: boolean) {
    const next = hide
      ? [...hiddenSources.filter((s) => s !== src), src]
      : hiddenSources.filter((s) => s !== src);
    setHiddenSources(next);
    sessionStorage.setItem("structura:hiddenSources", JSON.stringify(next));
    await fetch("/api/settings/hidden-sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: next }),
    });
    window.dispatchEvent(new CustomEvent("structura:hiddenSourcesChange", { detail: { hidden: next } }));
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
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border shadow-lg z-50 py-3 px-4 overflow-y-auto"
          style={{
            maxHeight: "calc(100vh - 60px)",
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
                  ["UBSGreek",    t("settings.ubsGreek")],
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
                  ["UBSHebrew",    t("settings.ubsHebrew")],
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

          {/* Interface Font Size */}
          <div className="pt-3 border-t mb-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-medium mb-1.5" style={{ color: "var(--foreground)" }}>
              {t("settings.interfaceFontSize")}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["sm", t("settings.fontSizeSmall")],
                  ["md", t("settings.fontSizeMedium")],
                  ["lg", t("settings.fontSizeLarge")],
                  ["xl", t("settings.fontSizeXLarge")],
                ] as [UiFontSizeKey, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeUiFontSize(value)}
                  className="text-xs px-1.5 py-1 rounded border transition-colors truncate"
                  style={{
                    borderColor: uiFontSize === value ? "var(--accent)" : "var(--border)",
                    color: uiFontSize === value ? "var(--accent)" : "var(--foreground)",
                    fontWeight: uiFontSize === value ? 600 : 400,
                    backgroundColor: "var(--surface-muted)",
                  }}
                  title={label}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Fonts */}
          <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              Custom Fonts
            </p>

            {(
              [
                { key: "hebrew"          as const, label: "Hebrew",          sampleDir: "rtl" as const },
                { key: "greek"           as const, label: "Greek",           sampleDir: "ltr" as const },
                { key: "translation"     as const, label: "Translation",     sampleDir: "ltr" as const },
                { key: "transliteration" as const, label: "Transliteration", sampleDir: "ltr" as const },
              ]
            ).map(({ key, label, sampleDir }) => {
              const activeFont = fontInputs[key];
              return (
                <div key={key} className="mb-2">
                  <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </p>
                  <div className="flex items-center gap-1">
                    {/* Current font display — click to open picker */}
                    <button
                      onClick={() => setPickerOpen(key)}
                      className="flex-1 min-w-0 text-left text-xs px-2 py-1.5 rounded border transition-colors truncate"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--surface-muted)",
                        color: activeFont ? "var(--foreground)" : "var(--text-muted)",
                        fontFamily: activeFont || undefined,
                        fontStyle: key === "transliteration" ? "italic" : undefined,
                        direction: sampleDir,
                      }}
                      title={activeFont || "Default (click to choose)"}
                    >
                      {activeFont || "Default"}
                    </button>
                    {/* Clear button — only shown when a custom font is set */}
                    {activeFont && (
                      <button
                        onClick={() => {
                          const next = { ...fontInputs, [key]: "" };
                          setFontInputs(next);
                          saveFontsImmediate(next);
                        }}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
                        style={{ color: "var(--text-muted)" }}
                        title="Reset to default"
                        aria-label="Reset font"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {fontSaved && (
              <p className="text-[10px] mt-1 text-right" style={{ color: "var(--accent)" }}>
                ✓ Saved
              </p>
            )}
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

            {/* Zotero credentials */}
            <div className="pt-3 border-t mb-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                {t("settings.zoteroSection")}
              </p>
              <div className="flex gap-1 mb-1">
                <input
                  type="text"
                  value={zoteroUserId}
                  onChange={(e) => setZoteroUserId(e.target.value)}
                  placeholder={t("settings.zoteroUserIdPlaceholder")}
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                />
              </div>
              <div className="flex gap-1">
                <input
                  type="password"
                  value={zoteroApiKey}
                  onChange={(e) => setZoteroApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveZoteroCredentials(); }}
                  placeholder={hasZoteroKey ? t("settings.zoteroApiKeyUpdate") : t("settings.zoteroApiKeyPlaceholder")}
                  className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                />
                <button
                  onClick={saveZoteroCredentials}
                  disabled={savingZotero || !zoteroUserId.trim()}
                  className="text-xs px-2 py-1 rounded disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  {t("settings.save")}
                </button>
              </div>
              {(hasZoteroKey || zoteroSaved) && (
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {t("settings.zoteroSaved")}
                  </span>
                  <button
                    onClick={clearZoteroCredentials}
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t("settings.zoteroClear")}
                  </button>
                </div>
              )}
            </div>

            {/* Bible Lookup — language filter */}
            {fetchBibleTransls.length > 0 && (() => {
              const allLangs = [...new Set(fetchBibleTransls.map((t) => t.lang))].sort();
              const searchLower = bibleLangSearch.toLowerCase();
              const visible = searchLower
                ? allLangs.filter((l) => langLabel(l).toLowerCase().includes(searchLower))
                : allLangs;
              const activeCount = bibleLangs === null ? allLangs.length : bibleLangs.size;
              function toggleLang(code: string) {
                const current = bibleLangs ?? new Set(allLangs);
                const next = new Set(current);
                if (next.has(code)) next.delete(code); else next.add(code);
                const normalized = next.size === allLangs.length ? null : next;
                setBibleLangs(normalized);
                writeBibleLookupLangs(normalized);
              }
              function setAll() { setBibleLangs(null); writeBibleLookupLangs(null); }
              function setNone() { setBibleLangs(new Set()); writeBibleLookupLangs(new Set()); }
              return (
                <div className="pt-3 border-t mb-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Bible Lookup Languages
                    </p>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {activeCount} / {allLangs.length}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={bibleLangSearch}
                    onChange={(e) => setBibleLangSearch(e.target.value)}
                    placeholder="Filter languages…"
                    className="w-full text-xs px-2 py-1 rounded border outline-none mb-1.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                  />
                  <div className="flex gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={setAll}
                      className="flex-1 text-[11px] px-2 py-0.5 rounded border transition-colors hover:bg-stone-100 dark:hover:bg-stone-700"
                      style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={setNone}
                      className="flex-1 text-[11px] px-2 py-0.5 rounded border transition-colors hover:bg-stone-100 dark:hover:bg-stone-700"
                      style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                    >
                      None
                    </button>
                  </div>
                  <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                    {visible.map((lang) => {
                      const on = bibleLangs === null || bibleLangs.has(lang);
                      return (
                        <label key={lang} className="flex items-center gap-2 cursor-pointer py-0.5">
                          <span
                            className="flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center"
                            style={{
                              borderColor: on ? "var(--accent)" : "var(--border)",
                              background: on ? "var(--accent)" : "transparent",
                            }}
                            onClick={() => toggleLang(lang)}
                          >
                            {on && (
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1.5,4 3,5.5 6.5,2"/>
                              </svg>
                            )}
                          </span>
                          <span className="text-xs truncate" style={{ color: "var(--foreground)" }} onClick={() => toggleLang(lang)}>
                            {langLabel(lang)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Source Text Visibility */}
            <div className="pt-3 border-t mb-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                Source Texts
              </p>
              <div className="flex flex-col gap-1">
                {(
                  [
                    ["OSHB",   "Hebrew Bible (OSHB)"],
                    ["SBLGNT", "Greek NT (SBLGNT)"],
                    ["LXX",    "Septuagint (LXX)"],
                  ] as [SourceId, string][]
                ).map(([src, label]) => (
                  <label key={src} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hiddenSources.includes(src)}
                      onChange={(e) => toggleHiddenSource(src, !e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm" style={{ color: "var(--foreground)" }}>{label}</span>
                  </label>
                ))}
              </div>
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

                  {(() => {
                    const lang = LOCALE_LANG[locale];
                    const filtered = lang
                      ? fetchBibleTransls.filter((t) => t.lang === lang)
                      : [];
                    return filtered.length > 0 ? (
                      <optgroup label="fetch.bible (free)">
                        {filtered.map((t) => (
                          <option key={t.id} value={`fetchbible:${t.id}`}>
                            {t.abbrev} — {t.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })()}

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

      {/* Font picker dialog — rendered outside the settings panel so it can
          cover the full viewport as a modal overlay */}
      {pickerOpen && (
        <FontPickerDialog
          language={pickerOpen}
          current={fontInputs[pickerOpen]}
          onApply={(family) => {
            const next = { ...fontInputs, [pickerOpen]: family };
            setFontInputs(next);
            setPickerOpen(null);
            saveFontsImmediate(next);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </div>
  );
}
