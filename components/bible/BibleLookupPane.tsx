"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { parseScriptureRefs } from "@/lib/scripture/reference-parser";

const STORAGE_KEY = "structura:bibleLookup:translation";

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
  const [osisRef, setOsisRef]       = useState<string | null>(null);
  const [localTransls, setLocalTransls] = useState<LocalTranslation[]>([]);
  const [hasApiKey, setHasApiKey]   = useState(false);
  const [selected, setSelected]     = useState("");
  const [status, setStatus]         = useState<Status>("idle");
  const [result, setResult]         = useState<Result | null>(null);
  const [copied, setCopied]         = useState(false);
  const [parseError, setParseError] = useState(false);
  const fetchCountRef               = useRef(0);
  const inputRef                    = useRef<HTMLInputElement>(null);

  // Load translations + api key on mount
  useEffect(() => {
    fetch("/api/translations")
      .then((r) => r.json())
      .then((rows: LocalTranslation[]) => { if (Array.isArray(rows)) setLocalTransls(rows); })
      .catch(() => {});
    fetch("/api/credentials/apibible")
      .then((r) => r.json())
      .then((d: { hasApiKey?: boolean }) => setHasApiKey(d.hasApiKey ?? false))
      .catch(() => {});
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelected(stored);
    } catch { /* ignore */ }
    inputRef.current?.focus();
  }, []);

  function changeTranslation(value: string) {
    setSelected(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
  }

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
  }, [osisRef, selected]);

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

        {/* Translation selector */}
        <select
          value={selected}
          onChange={(e) => changeTranslation(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded border outline-none"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
        >
          <option value="">— choose translation —</option>
          {localTransls.length > 0 && (
            <optgroup label="Imported translations">
              {localTransls.map((tr) => (
                <option key={tr.id} value={`local:${tr.id}`}>
                  {tr.abbreviation}{tr.name !== tr.abbreviation ? ` — ${tr.name}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {hasApiKey && (
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

        {result && (
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

            {/* Verse text */}
            <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
              {result.text}
            </p>
          </>
        )}

        {status === "idle" && !result && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Enter a reference above to look up a passage.
          </p>
        )}
      </div>
    </div>
  );
}
