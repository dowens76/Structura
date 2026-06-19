"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { OSIS_BOOK_NAMES, OSIS_REF_BOOK_NAMES, MORPHGNT_BOOK_MAP } from "@/lib/utils/osis";
import type { Passage } from "@/lib/db/user-schema";

const NT_OSIS_CODES = new Set(Object.values(MORPHGNT_BOOK_MAP));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Map from normalized key → OSIS code (multiple keys can point to the same OSIS code)
// We also keep a reverse map: OSIS code → all normalized keys, for prefix matching
const OSIS_KEYS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  const add = (osis: string, key: string) => {
    const existing = map.get(osis) ?? [];
    if (!existing.includes(key)) map.set(osis, [...existing, key]);
  };

  for (const osis of Object.keys(OSIS_BOOK_NAMES)) {
    add(osis, norm(osis));
  }
  for (const [osis, name] of Object.entries(OSIS_BOOK_NAMES)) {
    add(osis, norm(name));
  }
  for (const [osis, name] of Object.entries(OSIS_REF_BOOK_NAMES)) {
    add(osis, norm(name));
  }

  const aliases: Record<string, string> = {
    gn: "Gen", ex: "Exod", lv: "Lev", nm: "Num", dt: "Deut",
    jos: "Josh", jdg: "Judg", jgs: "Judg",
    "1s": "1Sam", "2s": "2Sam", "1k": "1Kgs", "2k": "2Kgs",
    "1ch": "1Chr", "2ch": "2Chr",
    ps: "Ps", psa: "Ps", psalms: "Ps",
    prv: "Prov", pro: "Prov",
    sg: "Song", ss: "Song", sos: "Song", canticles: "Song",
    is: "Isa", jr: "Jer", ez: "Ezek", ezk: "Ezek",
    mt: "Matt", mk: "Mark", lk: "Luke", jn: "John",
    ac: "Acts", rm: "Rom",
    "1co": "1Cor", "2co": "2Cor",
    ga: "Gal", ep: "Eph", php: "Phil", phm: "Phlm", phlm: "Phlm",
    "1th": "1Thess", "2th": "2Thess",
    "1ti": "1Tim", "2ti": "2Tim", ti: "Titus",
    hb: "Heb", jm: "Jas", jms: "Jas",
    "1pe": "1Pet", "2pe": "2Pet",
    "1jn": "1John", "2jn": "2John", "3jn": "3John",
    jd: "Jude", rv: "Rev", ap: "Rev",
  };
  for (const [alias, osis] of Object.entries(aliases)) {
    add(osis, norm(alias));
  }
  return map;
})();

type BookResult = { type: "book"; osisCode: string; chapter: number; displayName: string };
type PassageResult = { type: "passage"; passage: Passage; displayName: string };
type Result = BookResult | PassageResult;

/** Parse free-text into all matching book suggestions. */
function parseBookMatches(raw: string): BookResult[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Split trailing number as chapter (e.g. "Matt 5", "1Sam3", "Psalm 23")
  const withChapter = trimmed.match(/^(.*?)[\s.]+(\d+)$/) ?? trimmed.match(/^(.*[a-zA-Z])(\d+)$/);
  let bookPart = trimmed;
  let chapter = 1;
  if (withChapter) {
    bookPart = withChapter[1].trim();
    chapter = parseInt(withChapter[2], 10) || 1;
  }

  const key = norm(bookPart);
  if (key.length < 1) return [];

  const seen = new Set<string>();
  const results: BookResult[] = [];

  for (const [osis, keys] of OSIS_KEYS) {
    if (seen.has(osis)) continue;
    const matches = keys.some((k) => k === key || k.startsWith(key));
    if (matches) {
      seen.add(osis);
      results.push({
        type: "book",
        osisCode: osis,
        chapter,
        displayName: OSIS_REF_BOOK_NAMES[osis] ?? osis,
      });
    }
  }

  return results;
}

/** Filter labeled passages by query: match on label text OR on the passage's book. */
function filterPassages(all: Passage[], raw: string, matchedOsisCodes: Set<string>): PassageResult[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  return all
    .filter((p) => matchedOsisCodes.has(p.book) || p.label.toLowerCase().includes(q))
    .map((p) => ({
      type: "passage" as const,
      passage: p,
      displayName: p.label,
    }));
}

function passageUrl(p: Passage): string {
  return `/${encodeURIComponent(p.book)}/${p.textSource}/passage/${p.id}`;
}

function bookUrl(r: BookResult, textSource: string): string {
  const isNT = NT_OSIS_CODES.has(r.osisCode);
  const src = isNT ? "SBLGNT" : (textSource === "SBLGNT" ? "OSHB" : textSource);
  return `/${encodeURIComponent(r.osisCode)}/${src}/${r.chapter}`;
}

interface AddressBarProps {
  open: boolean;
  onClose: () => void;
  textSource: string;
}

export default function AddressBar({ open, onClose, textSource }: AddressBarProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [labeledPassages, setLabeledPassages] = useState<Passage[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load labeled passages once when the bar opens
  useEffect(() => {
    if (!open) return;
    setValue("");
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    fetch("/api/passages/labeled")
      .then((r) => r.json())
      .then((data) => setLabeledPassages(data.passages ?? []))
      .catch(() => {});
  }, [open]);

  const bookMatches = parseBookMatches(value);
  const matchedOsisCodes = new Set(bookMatches.map((r) => r.osisCode));
  const passageMatches = filterPassages(labeledPassages, value, matchedOsisCodes);
  const results: Result[] = [...bookMatches, ...passageMatches];

  // Clamp activeIdx when results list changes
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const navigate = useCallback((result: Result) => {
    const url = result.type === "book" ? bookUrl(result, textSource) : passageUrl(result.passage);
    router.push(url);
    onClose();
  }, [router, onClose, textSource]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      navigate(results[activeIdx]);
    }
  }

  const hasResults = results.length > 0;
  const hasPassages = passageMatches.length > 0;
  const hasBooks = bookMatches.length > 0;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl border overflow-hidden"
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
      >
        {/* Input row */}
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: hasResults ? `1px solid var(--border)` : undefined }}>
          <span className="text-xs font-medium shrink-0" style={{ color: "var(--text-muted)" }}>Go to</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Matt 5, Gen 3, Psalm 23"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--foreground)" }}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border shrink-0" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>Esc</kbd>
        </div>

        {/* Results list */}
        {hasResults ? (
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {hasBooks && (
              <>
                {hasPassages && (
                  <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Books</div>
                )}
                {bookMatches.map((r, i) => {
                  const isActive = i === activeIdx;
                  return (
                    <button
                      key={`book-${r.osisCode}`}
                      data-idx={i}
                      className="w-full text-left px-4 py-2 text-sm flex items-center gap-3"
                      style={{
                        backgroundColor: isActive ? "var(--surface-muted)" : "transparent",
                        color: "var(--foreground)",
                      }}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => navigate(r)}
                    >
                      <span className="font-medium">{r.displayName}</span>
                      {r.chapter > 1 && <span style={{ color: "var(--accent)" }}>{r.chapter}</span>}
                      <span className="ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>{r.osisCode}</span>
                    </button>
                  );
                })}
              </>
            )}
            {hasPassages && (
              <>
                {hasBooks && (
                  <div className="px-4 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>Passages</div>
                )}
                {passageMatches.map((r, i) => {
                  const idx = bookMatches.length + i;
                  const isActive = idx === activeIdx;
                  return (
                    <button
                      key={`passage-${r.passage.id}`}
                      data-idx={idx}
                      className="w-full text-left px-4 py-2 text-sm flex items-center gap-3"
                      style={{
                        backgroundColor: isActive ? "var(--surface-muted)" : "transparent",
                        color: "var(--foreground)",
                      }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => navigate(r)}
                    >
                      <span className="font-medium truncate">{r.displayName}</span>
                      <span className="ml-auto text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                        {OSIS_REF_BOOK_NAMES[r.passage.book] ?? r.passage.book} {r.passage.startChapter}
                        {r.passage.startChapter !== r.passage.endChapter ? `–${r.passage.endChapter}` : ""}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        ) : (
          <div className="px-4 py-3">
            {value.trim() ? (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>No match found</span>
            ) : (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Type a book name and chapter number</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
