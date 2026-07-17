"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Word } from "@/lib/db/schema";
import { parseOsisRef, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import { pickPassageSource, type LexiconSourceKind } from "@/lib/utils/lexiconRef";
import type { FetchBibleTranslation } from "@/app/api/fetchbible/route";
import { fetchJsonRetry } from "@/lib/utils/fetchJsonRetry";
import ParseTooltip from "./ParseTooltip";

interface Props {
  osisRef: string;       // "Book.Chapter.Verse" — already validated by the click handler
  lexiconSource: string; // "BDB" | "AbbottSmith" | "LSJ"
  useLinguisticTerms?: boolean;
  onClose: () => void;
}

type Status = "loading" | "error" | "empty" | "ready";
type TranslationStatus = "idle" | "loading" | "error" | "not_found" | "no_translation" | "ready";

const TRANSLATION_STORAGE_KEY = "structura:passagePreview:translation";

// Hardcoded api.bible translations (same set as SettingsButton / BibleLookupPane)
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

function PreviewWord({
  word,
  useLinguisticTerms,
  paneRef,
  noLeadingSpace,
}: {
  word: Word;
  useLinguisticTerms: boolean;
  paneRef: React.RefObject<HTMLElement | null>;
  noLeadingSpace?: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const wordRef = useRef<HTMLSpanElement>(null);
  const isHebrew = word.language === "hebrew";
  const display = (word.surfaceText ?? "").replace(/\//g, "");

  function handleMouseEnter() {
    // Same heuristic as WordToken's tooltip flip: near the top of the
    // viewport (which, in this narrow side pane, means right below the
    // pane's own header) there isn't room for the tooltip to open upward
    // without being clipped by the pane's overflow:hidden bounds, so flip
    // it below the word instead.
    if (wordRef.current) {
      const rect = wordRef.current.getBoundingClientRect();
      setFlipped(rect.top < 350);
    }
    setHovering(true);
  }

  const endsWithMaqqef = display.endsWith("־");

  return (
    <span
      ref={wordRef}
      className={`relative inline-block cursor-default ${isHebrew ? "text-hebrew" : "text-greek"}`}
      style={{
        marginInlineStart: noLeadingSpace ? 0 : "0.125rem",
        marginInlineEnd: endsWithMaqqef ? 0 : "0.125rem",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovering(false)}
    >
      {display}
      {hovering && (
        <ParseTooltip word={word} flipped={flipped} useLinguisticTerms={useLinguisticTerms} containerRef={paneRef} />
      )}
    </span>
  );
}

export default function PassagePreviewPane({ osisRef, lexiconSource, useLinguisticTerms = false, onClose }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [words, setWords] = useState<Word[]>([]);
  const fetchKey = useRef("");
  const paneRef = useRef<HTMLDivElement>(null);

  // ── Default translation (persisted across preview opens) ──────────────────
  const [localTransls, setLocalTransls] = useState<LocalTranslation[]>([]);
  const [fetchBibleTransls, setFetchBibleTransls] = useState<FetchBibleTranslation[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [selectedTranslation, setSelectedTranslation] = useState("");
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus>("idle");
  const [translationResult, setTranslationResult] = useState<{ text: string; translation: string } | null>(null);
  const translationFetchKey = useRef("");

  useEffect(() => {
    fetch("/api/translations")
      .then((r) => r.json())
      .then((rows: LocalTranslation[]) => { if (Array.isArray(rows)) setLocalTransls(rows); })
      .catch(() => {});
    fetchJsonRetry<{ hasApiKey?: boolean }>("/api/credentials/apibible").then((d) => {
      if (d) setHasApiKey(d.hasApiKey ?? false);
    });
    fetch("/api/fetchbible")
      .then((r) => r.json())
      .then((rows: FetchBibleTranslation[]) => { if (Array.isArray(rows)) setFetchBibleTransls(rows); })
      .catch(() => {});
    try {
      const stored = localStorage.getItem(TRANSLATION_STORAGE_KEY);
      if (stored) setSelectedTranslation(stored);
    } catch { /* ignore */ }
  }, []);

  function changeTranslation(value: string) {
    setSelectedTranslation(value);
    try { localStorage.setItem(TRANSLATION_STORAGE_KEY, value); } catch { /* quota exceeded */ }
  }

  let parsed: { book: string; chapter: number; verse: number } | null;
  try {
    parsed = parseOsisRef(osisRef);
  } catch {
    parsed = null;
  }

  const source = parsed ? pickPassageSource(lexiconSource as LexiconSourceKind, parsed.book) : null;

  useEffect(() => {
    if (!parsed || !source) return;
    const key = `${parsed.book}.${parsed.chapter}.${parsed.verse}:${source}`;
    if (key === fetchKey.current) return;
    fetchKey.current = key;
    setStatus("loading");

    const params = new URLSearchParams({
      book: parsed.book,
      chapter: String(parsed.chapter),
      verse: String(parsed.verse),
      source,
    });
    fetch(`/api/passage-preview?${params}`)
      .then((r) => r.json())
      .then((data: { words: Word[] }) => {
        if (fetchKey.current !== key) return;
        const ws = data.words ?? [];
        setWords(ws);
        setStatus(ws.length > 0 ? "ready" : "empty");
      })
      .catch(() => { if (fetchKey.current === key) setStatus("error"); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osisRef, lexiconSource]);

  // Fetch the default translation's text for this verse whenever the verse
  // or the selected translation changes.
  useEffect(() => {
    if (!parsed || !selectedTranslation) { setTranslationResult(null); setTranslationStatus("idle"); return; }
    const key = `${parsed.book}.${parsed.chapter}.${parsed.verse}:${selectedTranslation}`;
    if (key === translationFetchKey.current) return;
    translationFetchKey.current = key;
    setTranslationStatus("loading");
    setTranslationResult(null);

    const params = new URLSearchParams({ ref: `${parsed.book}.${parsed.chapter}.${parsed.verse}` });
    if (selectedTranslation.startsWith("local:")) {
      params.set("localId", selectedTranslation.slice(6));
    } else if (selectedTranslation.startsWith("fetchbible:")) {
      const translationId = selectedTranslation.slice(11);
      params.set("fetchBibleId", translationId);
      const abbr = fetchBibleTransls.find((t) => t.id === translationId)?.abbrev;
      if (abbr) params.set("abbr", abbr);
    } else if (selectedTranslation.startsWith("api:")) {
      const bibleId = selectedTranslation.slice(4);
      params.set("bibleId", bibleId);
      const abbr = API_BIBLES.find((b) => b.id === bibleId)?.name;
      if (abbr) params.set("abbr", abbr);
    } else {
      return;
    }

    fetch(`/api/scripture?${params}`)
      .then((r) => r.json())
      .then((d: { text?: string; translation?: string; error?: string }) => {
        if (translationFetchKey.current !== key) return;
        if (d.error === "not_found") setTranslationStatus("not_found");
        else if (d.error === "no_api_key" || d.error === "bad_api_key") setTranslationStatus("no_translation");
        else if (d.error) setTranslationStatus("error");
        else { setTranslationResult({ text: d.text!, translation: d.translation! }); setTranslationStatus("ready"); }
      })
      .catch(() => { if (translationFetchKey.current === key) setTranslationStatus("error"); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osisRef, selectedTranslation, fetchBibleTransls]);

  const isHebrew = source === "OSHB";
  const bookName = parsed ? (OSIS_REF_BOOK_NAMES[parsed.book] ?? parsed.book) : osisRef;
  const label = parsed ? `${bookName} ${parsed.chapter}:${parsed.verse}` : osisRef;

  function openInMainView() {
    if (!parsed || !source) return;
    router.push(`/${encodeURIComponent(parsed.book)}/${source}/${parsed.chapter}?v=${parsed.verse}`);
  }

  return (
    <div ref={paneRef} className="flex flex-col h-full" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{label}</span>
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

      {/* Default translation selector */}
      <div className="px-3 pt-2 pb-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <select
          value={selectedTranslation}
          onChange={(e) => changeTranslation(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded border outline-none"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--foreground)" }}
        >
          <option value="">No translation</option>
          {localTransls.length > 0 && (
            <optgroup label="Imported translations">
              {localTransls.map((tr) => (
                <option key={tr.id} value={`local:${tr.id}`}>
                  {tr.abbreviation}{tr.name !== tr.abbreviation ? ` — ${tr.name}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {fetchBibleTransls.length > 0 && (
            <optgroup label="fetch.bible">
              {fetchBibleTransls.map((t) => (
                <option key={t.id} value={`fetchbible:${t.id}`}>{t.abbrev} — {t.name}</option>
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {!parsed && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Couldn&apos;t read this reference.</p>
        )}
        {parsed && !source && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Can&apos;t determine which text this reference belongs to.
          </p>
        )}
        {parsed && source && status === "loading" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        )}
        {parsed && source && status === "error" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Could not load passage.</p>
        )}
        {parsed && source && status === "empty" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Verse not found in this text.</p>
        )}
        {parsed && source && status === "ready" && (
          <>
            <div
              className="leading-relaxed text-lg"
              dir={isHebrew ? "rtl" : "ltr"}
              lang={isHebrew ? "he" : "grc"}
              style={{ color: "var(--foreground)" }}
            >
              {words.map((w, i) => {
                const prev = i > 0 ? words[i - 1] : null;
                const prevEndsWithMaqqef = !!prev && (prev.surfaceText ?? "").replace(/\//g, "").endsWith("־");
                return (
                  <PreviewWord
                    key={w.wordId}
                    word={w}
                    useLinguisticTerms={useLinguisticTerms}
                    paneRef={paneRef}
                    noLeadingSpace={prevEndsWithMaqqef}
                  />
                );
              })}
            </div>

            {/* Default translation text, shown under the source text */}
            {selectedTranslation && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                {translationStatus === "loading" && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading translation…</p>
                )}
                {translationStatus === "not_found" && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Translation has no text for this verse.</p>
                )}
                {translationStatus === "no_translation" && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Add an api.bible key in Settings to use this translation.
                  </p>
                )}
                {translationStatus === "error" && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Could not load translation.</p>
                )}
                {translationStatus === "ready" && translationResult && (
                  <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
                    {translationResult.text}
                    <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      ({translationResult.translation})
                    </span>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {parsed && source && (
        <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={openInMainView}
            className="w-full text-xs font-medium px-2.5 py-1.5 rounded"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Open in main view
          </button>
        </div>
      )}
    </div>
  );
}
