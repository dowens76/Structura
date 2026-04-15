"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SearchResult } from "@/app/api/search/words/route";

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
}

const EMPTY_FILTERS: MorphFilters = {
  partOfSpeech: "", person: "", gender: "", number: "",
  tense: "", voice: "", mood: "", stem: "", state: "", verbCase: "",
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

export default function SearchPane({ book, textSource, onClose, onResultsChange, onSaveComplete }: SearchPaneProps) {
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

  const handleSearch = useCallback(async () => {
    setError(null);
    setResults(null);
    setShowSaveForm(false);
    setSaveMsg(null);

    if (searchType !== "morph" && !query.trim()) {
      setError("Enter a search term.");
      return;
    }

    const params = new URLSearchParams();
    params.set("searchType", searchType);
    params.set("source", Array.from(activeSources).join(","));
    if (searchType !== "morph") params.set("q", query.trim());
    if (filters.partOfSpeech) params.set("partOfSpeech", filters.partOfSpeech);
    if (filters.person)       params.set("person",       filters.person);
    if (filters.gender)       params.set("gender",       filters.gender);
    if (filters.number)       params.set("number",       filters.number);
    if (filters.tense)        params.set("tense",        filters.tense);
    if (filters.voice)        params.set("voice",        filters.voice);
    if (filters.mood)         params.set("mood",         filters.mood);
    if (filters.stem)         params.set("stem",         filters.stem);
    if (filters.state)        params.set("state",        filters.state);
    if (filters.verbCase)     params.set("verbCase",     filters.verbCase);

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
      persistResults(data.results, data.total, data.truncated, searchType, query, activeSources, filters);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [searchType, query, activeSources, filters, persistResults]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClose = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    onResultsChange?.([]);
    onClose();
  };

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

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasFilters = Object.values(filters).some(Boolean);

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
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchType === "surface" ? "Surface text…" : hasHebrew && !hasGreek ? "Hebrew word or Strong's number…" : "Lemma or Strong's number…"}
            className="w-full text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
            dir={searchType === "surface" && hasHebrew && !hasGreek ? "rtl" : searchType === "lemma" && hasHebrew ? "auto" : "ltr"}
          />
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
          <SelectFilter label="POS" value={filters.partOfSpeech} options={POS_OPTIONS} onChange={setFilter("partOfSpeech")} />
          {hasHebrew && <SelectFilter label="Stem" value={filters.stem} options={STEM_OPTIONS} onChange={setFilter("stem")} />}
          {hasHebrew && <SelectFilter label="Aspect" value={filters.tense} options={HEB_TENSE_OPTIONS} onChange={setFilter("tense")} />}
          {hasGreek && <SelectFilter label="Tense" value={filters.tense} options={GRK_TENSE_OPTIONS} onChange={setFilter("tense")} />}
          <SelectFilter label="Gender" value={filters.gender} options={GENDER_OPTIONS} onChange={setFilter("gender")} />
          <SelectFilter label="Person" value={filters.person} options={PERSON_OPTIONS} onChange={setFilter("person")} />
          <SelectFilter label="Number" value={filters.number} options={NUMBER_OPTIONS} onChange={setFilter("number")} />
          {hasHebrew && <SelectFilter label="State" value={filters.state} options={STATE_OPTIONS} onChange={setFilter("state")} />}
          {hasGreek && <SelectFilter label="Voice" value={filters.voice} options={VOICE_OPTIONS} onChange={setFilter("voice")} />}
          {hasGreek && <SelectFilter label="Mood" value={filters.mood} options={MOOD_OPTIONS} onChange={setFilter("mood")} />}
          {hasGreek && <SelectFilter label="Case" value={filters.verbCase} options={CASE_OPTIONS} onChange={setFilter("verbCase")} />}
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
                        className="block text-sm text-[var(--foreground)] leading-5"
                        dir={isHebrew ? "rtl" : "ltr"}
                      >
                        {r.surfaceText.replace(/\//g, "")}
                      </span>
                      {r.lemma && (
                        <span className="block text-xs text-stone-400 dark:text-stone-500 leading-4">
                          {r.lemma}
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
