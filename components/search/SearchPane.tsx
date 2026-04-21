"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SearchResult } from "@/app/api/search/words/route";
import type { LemmaSuggestion } from "@/app/api/search/lemma-suggest/route";

const SOURCES = ["OSHB", "SBLGNT", "STEPBIBLE_LXX"] as const;
type Source = typeof SOURCES[number];

const SOURCE_LABELS: Record<Source, string> = {
  OSHB: "OSHB",
  SBLGNT: "SBLGNT",
  STEPBIBLE_LXX: "LXX",
};

const SOURCE_ROUTES: Record<Source, string> = {
  OSHB: "OSHB",
  SBLGNT: "SBLGNT",
  STEPBIBLE_LXX: "LXX",
};

type SearchType = "surface" | "lemma" | "morph";

interface MorphFilters {
  partOfSpeech: string;
  person: string;
  gender: string;
  number: string;
  tense: string;
  voice: string;
  mood: string;
  stem: string;
  state: string;
  verbCase: string;
  suffixPerson: string;
  suffixGender: string;
  suffixNumber: string;
}

const EMPTY_FILTERS: MorphFilters = {
  partOfSpeech: "", person: "", gender: "", number: "",
  tense: "", voice: "", mood: "", stem: "", state: "", verbCase: "",
  suffixPerson: "", suffixGender: "", suffixNumber: "",
};

const POS_OPTIONS = [
  "noun", "verb", "adjective", "adverb", "preposition",
  "conjunction", "pronoun", "particle", "article", "interjection",
];

const STEM_OPTIONS = [
  "qal", "niphal", "piel", "pual", "hiphil", "hophal",
  "hithpael", "polel", "polal", "hithpolel", "qal passive",
];

const STATE_OPTIONS = ["absolute", "construct", "determined"];

const HEB_TENSE_OPTIONS = [
  "perfect", "imperfect", "imperative",
  "infinitive construct", "infinitive absolute",
  "participle active", "participle passive",
  "jussive", "cohortative",
];

const GRK_TENSE_OPTIONS = ["present", "imperfect", "future", "aorist", "perfect", "pluperfect"];
const VOICE_OPTIONS = ["active", "middle", "passive"];
const MOOD_OPTIONS = ["indicative", "subjunctive", "optative", "imperative", "infinitive", "participle"];
const CASE_OPTIONS = ["nominative", "genitive", "dative", "accusative", "vocative"];
const PERSON_OPTIONS = ["1st", "2nd", "3rd"];
const GENDER_OPTIONS = ["masculine", "feminine", "neuter", "common"];
const NUMBER_OPTIONS = ["singular", "plural", "dual"];

const COLOR_PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
  "#b91c1c", "#c2410c", "#a16207", "#166534",
  "#0f766e", "#1d4ed8", "#6d28d9", "#be185d",
];

const SESSION_KEY = "structura.search";

interface StoredSearch {
  searchType: SearchType;
  query: string;
  sources: Source[];
  filters: MorphFilters;
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

interface WordRef {
  wordId: string;
  book: string;
  chapter: number;
  textSource: string;
}

export interface SearchPaneProps {
  book: string;
  textSource: string;
  onClose: () => void;
  onResultsChange?: (results: SearchResult[]) => void;
  onSaveComplete?: (tagId: number, name: string, color: string, wordRefs: WordRef[]) => void;
  /** When set (nonce changes), auto-populate the search fields and run a search. */
  searchRequest?: { query: string; source: string; nonce: number } | null;
}

function SelectFilter({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-stone-500 dark:text-stone-400 w-16 shrink-0">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] px-1.5 py-0.5"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export default function SearchPane({ book, textSource, onClose, onResultsChange, onSaveComplete, searchRequest }: SearchPaneProps) {
  // ── Restore from sessionStorage on mount ───────────────────────────────────
  const restored = useRef(false);

  const [activeSources, setActiveSources] = useState<Set<Source>>(() => {
    const src = textSource as Source;
    return SOURCES.includes(src) ? new Set([src]) : new Set(["OSHB" as Source]);
  });
  const [searchType, setSearchType] = useState<SearchType>("surface");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MorphFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);

  // Restore persisted search state on mount (sessionStorage, client-side only)
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const stored: StoredSearch = JSON.parse(raw);
      setActiveSources(new Set(stored.sources));
      setSearchType(stored.searchType);
      setQuery(stored.query);
      setFilters(stored.filters);
      setResults(stored.results);
      setTotal(stored.total);
      setTruncated(stored.truncated);
      onResultsChange?.(stored.results);
    } catch {
      // ignore parse errors
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = (key: keyof MorphFilters) => (v: string) =>
    setFilters((prev) => ({ ...prev, [key]: v }));

  const hasHebrew = activeSources.has("OSHB");
  const hasGreek  = activeSources.has("SBLGNT") || activeSources.has("STEPBIBLE_LXX");

  const toggleSource = (src: Source) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) {
        if (next.size === 1) return prev;
        next.delete(src);
      } else {
        next.add(src);
      }
      return next;
    });
  };

  // ── Lemma autocomplete ───────────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<LemmaSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryIsHebrew = /[\u05D0-\u05EA]/.test(query);

  useEffect(() => {
    if (searchType !== "lemma" || !queryIsHebrew || !hasHebrew || !query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/lemma-suggest?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json() as { suggestions: LemmaSuggestion[] };
          setSuggestions(data.suggestions);
          setShowSuggestions(data.suggestions.length > 0);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
  }, [query, searchType, queryIsHebrew, hasHebrew]);

  // ── Results ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Save-as-list state ──────────────────────────────────────────────────────
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [listName, setListName] = useState("");
  const [listColor, setListColor] = useState(COLOR_PALETTE[5]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const persistResults = useCallback((r: SearchResult[], t: number, tr: boolean, type: SearchType, q: string, srcs: Source[], f: MorphFilters) => {
    try {
      const stored: StoredSearch = { searchType: type, query: q, sources: Array.from(srcs), filters: f, results: r, total: t, truncated: tr };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    } catch { /* ignore quota errors */ }
    onResultsChange?.(r);
  }, [onResultsChange]);

  const runSearch = useCallback(async (
    type: SearchType,
    q: string,
    srcs: Set<Source>,
    f: MorphFilters,
  ) => {
    setError(null);
    setResults(null);
    setShowSaveForm(false);
    setSaveMsg(null);

    if (type !== "morph" && !q.trim()) {
      setError("Enter a search term.");
      return;
    }

    const params = new URLSearchParams();
    params.set("searchType", type);
    params.set("source", Array.from(srcs).join(","));
    if (type !== "morph") params.set("q", q.trim());
    if (f.partOfSpeech) params.set("partOfSpeech", f.partOfSpeech);
    if (f.person)       params.set("person",       f.person);
    if (f.gender)       params.set("gender",       f.gender);
    if (f.number)       params.set("number",       f.number);
    if (f.tense)        params.set("tense",        f.tense);
    if (f.voice)        params.set("voice",        f.voice);
    if (f.mood)         params.set("mood",         f.mood);
    if (f.stem)         params.set("stem",         f.stem);
    if (f.state)        params.set("state",        f.state);
    if (f.verbCase)     params.set("verbCase",     f.verbCase);

    setLoading(true);
    try {
      const res = await fetch(`/api/search/words?${params}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? "Search failed.");
        return;
      }
      const data = await res.json() as { results: SearchResult[]; total: number; truncated: boolean };
      setResults(data.results);
      setTotal(data.total);
      setTruncated(data.truncated);
      persistResults(data.results, data.total, data.truncated, type, q, [...srcs], f);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [persistResults]);

  const handleSearch = useCallback(async () => {
    await runSearch(searchType, query, activeSources, filters);
  }, [runSearch, searchType, query, activeSources, filters]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClose = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    onResultsChange?.([]);
    onClose();
  };

  // ── External search trigger (from word pane) ─────────────────────────────────
  useEffect(() => {
    if (!searchRequest) return;
    const src = searchRequest.source as Source;
    const newSources = new Set(SOURCES.includes(src) ? [src] : (["OSHB"] as Source[]));
    setSearchType("lemma");
    setQuery(searchRequest.query);
    setActiveSources(newSources);
    setFilters(EMPTY_FILTERS);
    runSearch("lemma", searchRequest.query, newSources, EMPTY_FILTERS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequest?.nonce]);

  const handleSave = async () => {
    if (!results || results.length === 0 || !listName.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    const wordRefs = results.map((r) => ({
      wordId: r.wordId, book: r.book, chapter: r.chapter, textSource: r.textSource,
    }));
    try {
      const res = await fetch("/api/search/save-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: listName.trim(), color: listColor, wordRefs }),
      });
      const data = await res.json() as { tagId?: number; tagged?: number; skipped?: number; error?: string };
      if (!res.ok || !data.tagId) { setSaveMsg(`Error: ${data.error ?? "Failed"}`); return; }
      setSaveMsg(
        data.skipped && data.skipped > 0
          ? `Saved ${data.tagged} words (${data.skipped} already tagged, skipped)`
          : `Saved ${data.tagged} words as "${listName.trim()}"`
      );
      setShowSaveForm(false);
      // Notify parent so it can switch from temp highlights to tag highlights
      onSaveComplete?.(data.tagId, listName.trim(), listColor, wordRefs);
      setListName("");
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const [showSuffix, setShowSuffix] = useState(false);

  const clearFilters = () => { setFilters(EMPTY_FILTERS); setShowSuffix(false); };
  const hasFilters = Object.values(filters).some(Boolean);

  // ── POS-based field visibility ───────────────────────────────────────────────
  const pos = filters.partOfSpeech;
  const isNominal    = ["noun", "adjective", "pronoun"].includes(pos);
  const isVerbal     = pos === "verb";
  const isParticle   = ["particle", "preposition", "article"].includes(pos);
  const isUninflected = ["conjunction", "adverb", "interjection"].includes(pos);
  const posFiltered  = !!pos;

  const showStem      = hasHebrew && (!posFiltered || isVerbal);
  const showAspect    = hasHebrew && (!posFiltered || isVerbal);
  const showGreekTense = hasGreek && (!posFiltered || isVerbal);
  const showPerson    = !posFiltered || isVerbal;
  const showGender    = !posFiltered || isNominal || isVerbal;
  const showNumber    = !posFiltered || isNominal || isVerbal;
  const showState     = hasHebrew && (!posFiltered || isNominal || isParticle);
  const showVoice     = hasGreek && (!posFiltered || isVerbal);
  const showMood      = hasGreek && (!posFiltered || isVerbal);
  const showCase      = hasGreek && (!posFiltered || isNominal || isParticle);
  const showAnything  = !isUninflected || !posFiltered;

  return (
    <div className="flex flex-col h-full bg-[var(--background)] border-l border-[var(--border)] shadow-[-4px_0_16px_rgba(0,0,0,0.1)]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Search</h2>
        <button
          onClick={handleClose}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Controls — capped height so results list always gets visible space */}
      <div className="overflow-y-auto max-h-[45vh] min-h-[100px] shrink-0 px-3 py-3 border-b border-[var(--border)] space-y-3">

        {/* Source toggles */}
        <div className="flex gap-1.5 flex-wrap">
          {SOURCES.map((src) => (
            <button
              key={src}
              onClick={() => toggleSource(src)}
              className={[
                "px-2 py-0.5 rounded-full text-xs font-medium border transition-colors",
                activeSources.has(src)
                  ? "bg-amber-500 border-amber-500 text-white"
                  : "border-[var(--border)] text-stone-500 dark:text-stone-400 hover:border-amber-400 hover:text-amber-600",
              ].join(" ")}
            >
              {SOURCE_LABELS[src]}
            </button>
          ))}
        </div>

        {/* Search type */}
        <div className="flex rounded-md overflow-hidden border border-[var(--border)] text-xs">
          {(["surface", "lemma", "morph"] as SearchType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSearchType(t)}
              className={[
                "flex-1 py-1 font-medium transition-colors",
                searchType === t
                  ? "bg-stone-700 dark:bg-stone-200 text-white dark:text-stone-900"
                  : "bg-[var(--surface)] text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800",
              ].join(" ")}
            >
              {t === "surface" ? "Surface" : t === "lemma" ? "Lemma" : "Morph Only"}
            </button>
          ))}
        </div>

        {/* Text input */}
        {searchType !== "morph" && (
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder={searchType === "surface" ? "Surface text…" : hasHebrew && !hasGreek ? "Hebrew word or Strong's number…" : "Lemma or Strong's number…"}
              className="w-full text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
              dir={searchType === "surface" && hasHebrew && !hasGreek ? "rtl" : searchType === "lemma" && hasHebrew ? "auto" : "ltr"}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-[var(--surface)] border border-[var(--border)] rounded shadow-lg max-h-52 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={`${i}-${s.surfaceNorm}-${s.strongNumber}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent blur before click
                      setQuery(s.surfaceNorm);
                      setShowSuggestions(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors text-left"
                  >
                    <span dir="rtl" className="text-sm text-[var(--foreground)] shrink-0">{s.surfaceNorm}</span>
                    {s.strongNumber && (
                      <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0">{s.strongNumber}</span>
                    )}
                    {s.gloss && (
                      <span className="text-xs text-stone-500 dark:text-stone-400 truncate flex-1">{s.gloss}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Morphology filters */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Morphology</span>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
                Clear
              </button>
            )}
          </div>

          {/* POS always shown */}
          <SelectFilter label="POS" value={filters.partOfSpeech} options={POS_OPTIONS} onChange={setFilter("partOfSpeech")} />

          {showAnything && (<>
            {/* Verbal fields: Stem, Aspect/Tense, Person, Gender, Number */}
            {showStem      && <SelectFilter label="Stem"   value={filters.stem}    options={STEM_OPTIONS}      onChange={setFilter("stem")} />}
            {showAspect    && <SelectFilter label="Aspect" value={filters.tense}   options={HEB_TENSE_OPTIONS} onChange={setFilter("tense")} />}
            {showGreekTense && <SelectFilter label="Tense" value={filters.tense}   options={GRK_TENSE_OPTIONS} onChange={setFilter("tense")} />}
            {showPerson    && <SelectFilter label="Person" value={filters.person}  options={PERSON_OPTIONS}    onChange={setFilter("person")} />}

            {/* Shared: Gender, Number */}
            {showGender    && <SelectFilter label="Gender" value={filters.gender}  options={GENDER_OPTIONS}    onChange={setFilter("gender")} />}
            {showNumber    && <SelectFilter label="Number" value={filters.number}  options={NUMBER_OPTIONS}    onChange={setFilter("number")} />}

            {/* Nominal / particle fields */}
            {showState     && <SelectFilter label="State"  value={filters.state}   options={STATE_OPTIONS}     onChange={setFilter("state")} />}

            {/* Greek-only verbal */}
            {showVoice     && <SelectFilter label="Voice"  value={filters.voice}   options={VOICE_OPTIONS}     onChange={setFilter("voice")} />}
            {showMood      && <SelectFilter label="Mood"   value={filters.mood}    options={MOOD_OPTIONS}      onChange={setFilter("mood")} />}
            {showCase      && <SelectFilter label="Case"   value={filters.verbCase} options={CASE_OPTIONS}     onChange={setFilter("verbCase")} />}

            {/* Hebrew verb suffix */}
            {hasHebrew && isVerbal && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowSuffix((v) => !v)}
                  className="flex items-center gap-1 text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"
                    className={`w-3 h-3 transition-transform ${showSuffix ? "rotate-90" : ""}`}>
                    <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L9.19 8 6.22 5.03a.75.75 0 0 1 0-1.06Z" clipRule="evenodd"/>
                  </svg>
                  Suffix
                </button>
                {showSuffix && (
                  <div className="mt-1.5 pl-3 space-y-1.5 border-l-2 border-stone-200 dark:border-stone-700">
                    <SelectFilter label="Person" value={filters.suffixPerson} options={PERSON_OPTIONS} onChange={setFilter("suffixPerson")} />
                    <SelectFilter label="Gender" value={filters.suffixGender} options={GENDER_OPTIONS} onChange={setFilter("suffixGender")} />
                    <SelectFilter label="Number" value={filters.suffixNumber} options={NUMBER_OPTIONS} onChange={setFilter("suffixNumber")} />
                  </div>
                )}
              </div>
            )}
          </>)}
        </div>

        {/* Search button */}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="w-full py-1.5 rounded text-xs font-semibold transition-colors bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white"
        >
          {loading ? "Searching…" : "Search"}
        </button>

        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Results header */}
      {results !== null && (
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-stone-50 dark:bg-stone-900">
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {total === 0 ? "No results" : truncated ? `First ${total} results` : `${total} result${total === 1 ? "" : "s"}`}
            {truncated && <span className="ml-1 text-amber-600 dark:text-amber-400">(limit reached)</span>}
          </span>
          {total > 0 && (
            <button
              onClick={() => { setShowSaveForm((v) => !v); setSaveMsg(null); }}
              className="text-xs px-2 py-0.5 rounded border border-[var(--border)] hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 transition-colors"
            >
              Save as List
            </button>
          )}
        </div>
      )}

      {/* Save-as-list inline form */}
      {showSaveForm && results && results.length > 0 && (
        <div className="shrink-0 px-3 py-3 border-b border-[var(--border)] bg-amber-50 dark:bg-amber-950/30 space-y-2">
          <p className="text-xs font-medium text-stone-700 dark:text-stone-300">Save {total} result{total !== 1 ? "s" : ""} as a list</p>
          <input
            type="text"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="List name…"
            className="w-full text-xs rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] px-2 py-1 focus:outline-none focus:border-amber-400"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setListColor(c)}
                className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: listColor === c ? "var(--foreground)" : "transparent" }}
                aria-label={c}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !listName.trim()}
              className="flex-1 py-1 rounded text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setShowSaveForm(false)}
              className="px-3 py-1 rounded text-xs border border-[var(--border)] hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {saveMsg && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border)] bg-green-50 dark:bg-green-950/30">
          <p className="text-xs text-green-700 dark:text-green-400">{saveMsg}</p>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-20">
            <span className="text-xs text-stone-400">Searching…</span>
          </div>
        )}
        {!loading && results !== null && results.length === 0 && (
          <div className="flex items-center justify-center h-20">
            <span className="text-xs text-stone-400">No results found.</span>
          </div>
        )}
        {!loading && results && results.length > 0 && (
          <ul className="divide-y divide-[var(--border)]">
            {results.map((r) => {
              const route = SOURCE_ROUTES[r.textSource as Source] ?? r.textSource;
              const href = `/${r.book}/${route}/${r.chapter}`;
              const isHebrew = r.language === "Hebrew" || r.language === "hebrew";
              return (
                <li key={r.wordId}>
                  <a
                    href={href}
                    className="flex items-start gap-2 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors cursor-pointer"
                  >
                    <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 w-24 leading-5">
                      {r.bookName} {r.chapter}:{r.verse}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={`block leading-6 ${isHebrew ? "text-hebrew" : "text-greek"} text-[var(--foreground)]`}
                        dir={isHebrew ? "rtl" : "ltr"}
                      >
                        {r.surfaceText.replace(/\//g, "")}
                      </span>
                      {(r.lemma || r.morphCode) && (
                        <span className="block text-xs text-stone-400 dark:text-stone-500 leading-4 mt-0.5">
                          {r.lemma && <span>{r.lemma}</span>}
                          {r.lemma && r.morphCode && <span className="mx-1 opacity-40">·</span>}
                          {r.morphCode && <span className="font-mono">{r.morphCode}</span>}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
