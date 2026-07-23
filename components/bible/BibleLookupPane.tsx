"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { parseScriptureRefs } from "@/lib/scripture/reference-parser";
import type { FetchBibleTranslation } from "@/app/api/fetchbible/route";

import { langLabel, readBibleLookupLangs, writeBibleLookupLangs } from "@/lib/utils/bible-lookup-langs";
import { fetchJsonRetry } from "@/lib/utils/fetchJsonRetry";
import { openExternal } from "@/lib/utils/openExternal";

const STORAGE_KEY = "structura:bibleLookup:translation";

// Hebrew Unicode: base consonants א-ת
const HEBREW_RE      = /[א-ת]/;
// Greek Unicode: basic + extended Greek
const GREEK_RE       = /[Ͱ-Ͽἀ-῿]/;

// Strip vowel points: ְ-ֽ ֿ ׁ ׂ ׄ ׅ ׇ װ
const VOWEL_RE       = /[ְ-ׇֽֿׁׂׅׄ]/g;
// Strip cantillation: ֑-֯
const CANTILLATION_RE = /[֑-֯]/g;

function detectScript(text: string): "hebrew" | "greek" | "other" {
  if (HEBREW_RE.test(text)) return "hebrew";
  if (GREEK_RE.test(text)) return "greek";
  return "other";
}


// Hardcoded api.bible translations (same set as SettingsButton)
const API_BIBLES = [
  { id: "a761ca71e0b3ddcf-01", name: "NASB 2020" },
  { id: "d6e14a625393b4da-01", name: "NLT" },
  { id: "65eec8e0b60e656b-01", name: "NIV (2011)" },
  { id: "9879dbb7cfe39e4d-04", name: "KJV" },
  { id: "2VSB",               name: "Bản Truyền Thống (VIE 1925)" },
];

interface LocalTranslation {
  id: number;
  name: string;
  abbreviation: string;
  language: string | null;
}

type Status = "idle" | "loading" | "not_found" | "no_translation" | "error";

interface Result {
  text: string;
  translation: string;
}

interface Props {
  onClose: () => void;
}

// "John.3.16" → "John 3:16", "Gen.1.1-Gen.1.3" → "Gen 1:1–3"
function formatRef(osisRef: string): string {
  const rangeParts = osisRef.split("-");
  const fmt = (part: string) => {
    const [book, ch, v] = part.split(".");
    if (!ch) return book;
    if (!v) return `${book} ${ch}`;
    return `${book} ${ch}:${v}`;
  };
  if (rangeParts.length === 1) return fmt(rangeParts[0]);
  const start = rangeParts[0].split(".");
  const end   = rangeParts[1].split(".");
  if (start[0] === end[0] && start[1] === end[1])
    return `${start[0]} ${start[1]}:${start[2]}–${end[2]}`;
  if (start[0] === end[0])
    return `${start[0]} ${start[1]}:${start[2]}–${end[1]}:${end[2]}`;
  return `${fmt(rangeParts[0])}–${fmt(rangeParts[1])}`;
}

export default function BibleLookupPane({ onClose }: Props) {
  const [query, setQuery]           = useState("");
  const [osisRef, setOsisRef]               = useState<string | null>(null);
  const [localTransls, setLocalTransls]     = useState<LocalTranslation[]>([]);
  const [fetchBibleTransls, setFetchBibleTransls] = useState<FetchBibleTranslation[]>([]);
  const [hasApiKey, setHasApiKey]           = useState(false);
  // null = "all languages" (no filter); Set = explicit selection (may be empty = none)
  const [selectedLangs, setSelectedLangs]   = useState<Set<string> | null>(new Set(["eng"]));
  const [showLangMenu, setShowLangMenu]     = useState(false);
  const langMenuRef                         = useRef<HTMLDivElement>(null);
  const [selected, setSelected]             = useState("");
  const [status, setStatus]                 = useState<Status>("idle");
  const [result, setResult]                 = useState<Result | null>(null);
  const [copied, setCopied]                 = useState(false);
  const [parseError, setParseError]         = useState(false);
  const [langSearch, setLangSearch]         = useState("");
  const [showVowels, setShowVowels]         = useState(true);
  const [showCantillation, setShowCantillation] = useState(true);
  const [hebrewFontSize, setHebrewFontSize] = useState(1.375);
  const [greekFontSize, setGreekFontSize]   = useState(1.25);
  const fetchCountRef                       = useRef(0);
  const inputRef                            = useRef<HTMLInputElement>(null);

  // Load translations + api key on mount
  useEffect(() => {
    fetch("/api/translations")
      .then((r) => r.json())
      .then((rows: LocalTranslation[]) => { if (Array.isArray(rows)) setLocalTransls(rows); })
      .catch(() => {});
    // A failed check leaves hasApiKey untouched rather than defaulting to
    // false — a transient error shouldn't make api.bible look unconfigured.
    fetchJsonRetry<{ hasApiKey?: boolean }>("/api/credentials/apibible").then((d) => {
      if (d) setHasApiKey(d.hasApiKey ?? false);
    });
    fetch("/api/fetchbible")
      .then((r) => r.json())
      .then((rows: FetchBibleTranslation[]) => { if (Array.isArray(rows)) setFetchBibleTransls(rows); })
      .catch(() => {});
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelected(stored);
      setSelectedLangs(readBibleLookupLangs());
      const hSize = localStorage.getItem("structura:hebrewFontSize");
      if (hSize) setHebrewFontSize(parseFloat(hSize));
      const gSize = localStorage.getItem("structura:greekFontSize");
      if (gSize) setGreekFontSize(parseFloat(gSize));
    } catch { /* ignore */ }
    inputRef.current?.focus();
  }, []);

  function changeTranslation(value: string) {
    setSelected(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
  }

  function changeLangs(next: Set<string> | null) {
    setSelectedLangs(next);
    writeBibleLookupLangs(next);
  }

  function toggleLang(code: string, allLangs: string[]) {
    // If currently "all", start from a full set then remove the toggled one
    const current = selectedLangs ?? new Set(allLangs);
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else next.add(code);
    // If all are now selected, normalise back to null (= "all")
    changeLangs(next.size === allLangs.length ? null : next);
  }

  // Close lang menu on outside click
  useEffect(() => {
    if (!showLangMenu) return;
    function handler(e: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLangMenu]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const matches = parseScriptureRefs(query.trim());
    if (matches.length === 0) {
      setParseError(true);
      return;
    }
    setParseError(false);
    setOsisRef(matches[0].osisRef);
  }

  // Fetch verse text whenever ref or translation changes
  useEffect(() => {
    if (!osisRef || !selected) {
      if (osisRef && !selected) setStatus("no_translation");
      return;
    }

    const myCount = ++fetchCountRef.current;
    setStatus("loading");
    setResult(null);

    const params = new URLSearchParams({ ref: osisRef });
    if (selected.startsWith("local:")) {
      params.set("localId", selected.slice(6));
    } else if (selected.startsWith("fetchbible:")) {
      const translationId = selected.slice(11);
      params.set("fetchBibleId", translationId);
      const abbr = fetchBibleTransls.find((t) => t.id === translationId)?.abbrev;
      if (abbr) params.set("abbr", abbr);
    } else if (selected.startsWith("api:")) {
      const bibleId = selected.slice(4);
      params.set("bibleId", bibleId);
      const abbr = API_BIBLES.find((b) => b.id === bibleId)?.name;
      if (abbr) params.set("abbr", abbr);
    } else {
      return;
    }

    fetch(`/api/scripture?${params}`)
      .then((r) => r.json())
      .then((d: { text?: string; translation?: string; error?: string }) => {
        if (fetchCountRef.current !== myCount) return;
        if (d.error === "not_found") {
          setStatus("not_found");
        } else if (d.error === "no_api_key" || d.error === "bad_api_key") {
          setStatus("no_translation");
        } else if (d.error) {
          setStatus("error");
        } else {
          setResult({ text: d.text!, translation: d.translation! });
          setStatus("idle");
        }
      })
      .catch(() => { if (fetchCountRef.current === myCount) setStatus("error"); });
  }, [osisRef, selected, fetchBibleTransls]);

  const handleCopy = useCallback(() => {
    if (!result || !osisRef) return;
    const header = `${formatRef(osisRef)} (${result.translation})`;
    navigator.clipboard.writeText(`${header}\n${result.text}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [result, osisRef]);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Bible Lookup
        </span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-stone-200 dark:hover:bg-stone-700"
          style={{ color: "var(--text-muted)" }}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
          </svg>
        </button>
      </div>

      {/* ── Controls ── */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        {/* Reference input */}
        <form onSubmit={handleSubmit} className="flex gap-1.5 mb-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setParseError(false); }}
            placeholder="e.g. John 3:16 or Gen 1:1-3"
            className="flex-1 text-sm px-2 py-1 rounded border outline-none"
            style={{
              borderColor: parseError ? "var(--color-pos-verb)" : "var(--border)",
              background: "var(--surface)",
              color: "var(--foreground)",
            }}
          />
          <button
            type="submit"
            className="px-2.5 py-1 text-xs font-medium rounded"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Go
          </button>
        </form>
        {parseError && (
          <p className="text-xs mb-2" style={{ color: "var(--color-pos-verb)" }}>
            Reference not recognised — try "John 3:16" or "Gen 1"
          </p>
        )}

        {/* Language filter — settings button + popover */}
        {fetchBibleTransls.length > 0 && (() => {
          // Only use fetch.bible lang codes (consistent ISO 639-3 codes)
          const allLangs = [...new Set(fetchBibleTransls.map((t) => t.lang))].sort();
          const effectiveSize = selectedLangs === null ? allLangs.length : selectedLangs.size;
          const isFiltered = selectedLangs !== null && selectedLangs.size < allLangs.length;
          const label = selectedLangs === null || selectedLangs.size >= allLangs.length
            ? "All languages"
            : selectedLangs.size === 0
              ? "No languages"
              : selectedLangs.size === 1
                ? langLabel([...selectedLangs][0])
                : `${selectedLangs.size} languages`;
          void effectiveSize; // suppress unused warning
          const searchLower = langSearch.toLowerCase();
          const visibleLangs = searchLower
            ? allLangs.filter((l) => langLabel(l).toLowerCase().includes(searchLower) || l.toLowerCase().includes(searchLower))
            : allLangs;
          return (
            <div ref={langMenuRef} className="relative mb-1.5">
              <button
                type="button"
                onClick={() => { setShowLangMenu((v) => !v); setLangSearch(""); }}
                className="w-full flex items-center justify-between text-xs px-2 py-1 rounded border outline-none"
                style={{
                  borderColor: isFiltered ? "var(--accent)" : "var(--border)",
                  background: "var(--surface)",
                  color: isFiltered ? "var(--accent)" : "var(--foreground)",
                }}
              >
                <span>{label}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
                  <polyline points="2,3 5,7 8,3"/>
                </svg>
              </button>

              {showLangMenu && (
                <div
                  className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border shadow-lg flex flex-col"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", maxHeight: "260px" }}
                >
                  {/* Search + All / None */}
                  <div className="flex-shrink-0 p-2 flex flex-col gap-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                    <input
                      type="text"
                      value={langSearch}
                      onChange={(e) => setLangSearch(e.target.value)}
                      placeholder="Search languages…"
                      autoFocus
                      className="w-full text-xs px-2 py-1 rounded border outline-none"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => changeLangs(null)}
                        className="flex-1 text-[11px] px-2 py-0.5 rounded border transition-colors hover:bg-stone-100 dark:hover:bg-stone-700"
                        style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => changeLangs(new Set())}
                        className="flex-1 text-[11px] px-2 py-0.5 rounded border transition-colors hover:bg-stone-100 dark:hover:bg-stone-700"
                        style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  {/* Scrollable language list */}
                  <div className="overflow-y-auto flex-1 py-1">
                    {visibleLangs.length === 0 && (
                      <p className="text-xs px-3 py-1" style={{ color: "var(--text-muted)" }}>No matches</p>
                    )}
                    {visibleLangs.map((lang) => {
                      const on = selectedLangs === null || selectedLangs.has(lang);
                      return (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => toggleLang(lang, allLangs)}
                          className="w-full flex items-center gap-2 px-3 py-0.5 text-xs text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-700"
                          style={{ color: "var(--foreground)" }}
                        >
                          <span
                            className="flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center"
                            style={{
                              borderColor: on ? "var(--accent)" : "var(--border)",
                              background: on ? "var(--accent)" : "transparent",
                            }}
                          >
                            {on && (
                              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1.5,4 3,5.5 6.5,2"/>
                              </svg>
                            )}
                          </span>
                          <span className="truncate">{langLabel(lang)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Translation selector */}
        <select
          value={selected}
          onChange={(e) => changeTranslation(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded border outline-none"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
        >
          <option value="">— choose translation —</option>
          {(() => {
            // Local translations use user-defined language strings, not ISO codes.
            // Show them only when no fetch.bible lang filter is active.
            const filteredLocal = selectedLangs === null ? localTransls : [];
            return filteredLocal.length > 0 ? (
              <optgroup label="Imported translations">
                {filteredLocal.map((tr) => (
                  <option key={tr.id} value={`local:${tr.id}`}>
                    {tr.abbreviation}{tr.name !== tr.abbreviation ? ` — ${tr.name}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })()}
          {fetchBibleTransls.length > 0 && (() => {
            const filtered = selectedLangs === null
              ? fetchBibleTransls
              : fetchBibleTransls.filter((t) => selectedLangs.has(t.lang));
            if (filtered.length === 0) return null;
            return (
              <optgroup label="fetch.bible">
                {filtered.map((t) => (
                  <option key={t.id} value={`fetchbible:${t.id}`}>
                    {t.abbrev} — {t.name}
                  </option>
                ))}
              </optgroup>
            );
          })()}
          {hasApiKey && (selectedLangs === null || selectedLangs.has("eng")) && (
            <optgroup label="api.bible">
              {API_BIBLES.map((b) => (
                <option key={b.id} value={`api:${b.id}`}>{b.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* ── Result area ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {status === "loading" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        )}
        {status === "not_found" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Verse not found.</p>
        )}
        {status === "no_translation" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Select a translation above, or add an api.bible key in Settings.
          </p>
        )}
        {status === "error" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Could not load passage.</p>
        )}

        {result && (() => {
          const script = detectScript(result.text);
          const isHebrew = script === "hebrew";
          const isGreek  = script === "greek";
          let displayText = result.text;
          if (isHebrew) {
            if (!showCantillation) displayText = displayText.replace(CANTILLATION_RE, "");
            if (!showVowels)       displayText = displayText.replace(VOWEL_RE, "");
          }
          const textStyle: React.CSSProperties = isHebrew
            ? { fontFamily: "var(--hebrew-font-family)", fontSize: `${hebrewFontSize}rem`, direction: "rtl", lineHeight: 2 }
            : isGreek
              ? { fontFamily: "var(--greek-font-family)", fontSize: `${greekFontSize}rem`, lineHeight: 1.9 }
              : { lineHeight: 1.7 };

          return (
          <>
            {/* Result header: ref + translation + copy button */}
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                {osisRef && formatRef(osisRef)}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {result.translation}
                </span>
                <button
                  onClick={handleCopy}
                  title={copied ? "Copied!" : "Copy passage"}
                  className="flex items-center justify-center w-5 h-5 rounded transition-colors"
                  style={{ color: copied ? "var(--accent)" : "var(--text-muted)" }}
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2,6 5,9 10,3"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="1" width="7" height="8" rx="1"/>
                      <path d="M2 4H1.5A.5.5 0 0 0 1 4.5v6A.5.5 0 0 0 1.5 11H8a.5.5 0 0 0 .5-.5V10"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Hebrew vowel / cantillation toggles */}
            {isHebrew && (
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={() => setShowVowels((v) => !v)}
                  title={showVowels ? "Hide vowel points" : "Show vowel points"}
                  className={[
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors border",
                    showVowels
                      ? "border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      : "border-amber-400 bg-amber-500 text-white",
                  ].join(" ")}
                >
                  Vowels
                </button>
                <button
                  onClick={() => setShowCantillation((v) => !v)}
                  title={showCantillation ? "Hide cantillation marks" : "Show cantillation marks"}
                  className={[
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors border",
                    showCantillation
                      ? "border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                      : "border-amber-400 bg-amber-500 text-white",
                  ].join(" ")}
                >
                  Cantillation
                </button>
              </div>
            )}

            {/* Verse text */}
            <p className="leading-relaxed" style={{ color: "var(--foreground)", fontSize: "0.875rem", ...textStyle }}>
              {displayText}
            </p>

            {/* CC BY-SA attribution for VCB */}
            {result.translation === "VCB" && (
              <p className="text-xs mt-3 leading-snug" style={{ color: "var(--text-muted)" }}>
                Vietnamese Contemporary Bible (VCB) Copyright © 1998, 2002, 2015 by Biblica, Inc.®
                Used with permission. All rights reserved worldwide.{" "}
                <a
                  href="https://creativecommons.org/licenses/by-sa/4.0/"
                  onClick={(e) => { e.preventDefault(); openExternal("https://creativecommons.org/licenses/by-sa/4.0/"); }}
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  CC BY-SA 4.0
                </a>
              </p>
            )}
          </>
          );
        })()}

        {status === "idle" && !result && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Enter a reference above to look up a passage.
          </p>
        )}
      </div>
    </div>
  );
}
