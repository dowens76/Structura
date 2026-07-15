"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Word } from "@/lib/db/schema";
import { parseOsisRef, OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import { pickPassageSource, type LexiconSourceKind } from "@/lib/utils/lexiconRef";
import ParseTooltip from "./ParseTooltip";

interface Props {
  osisRef: string;       // "Book.Chapter.Verse" — already validated by the click handler
  lexiconSource: string; // "BDB" | "AbbottSmith" | "LSJ"
  useLinguisticTerms?: boolean;
  onClose: () => void;
}

type Status = "loading" | "error" | "empty" | "ready";

function PreviewWord({ word, useLinguisticTerms }: { word: Word; useLinguisticTerms: boolean }) {
  const [hovering, setHovering] = useState(false);
  const isHebrew = word.language === "hebrew";
  const display = (word.surfaceText ?? "").replace(/\//g, "");
  return (
    <span
      className={`relative inline-block mx-0.5 cursor-default ${isHebrew ? "text-hebrew" : "text-greek"}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {display}
      {hovering && <ParseTooltip word={word} useLinguisticTerms={useLinguisticTerms} />}
    </span>
  );
}

export default function PassagePreviewPane({ osisRef, lexiconSource, useLinguisticTerms = false, onClose }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [words, setWords] = useState<Word[]>([]);
  const fetchKey = useRef("");

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

  const isHebrew = source === "OSHB";
  const bookName = parsed ? (OSIS_REF_BOOK_NAMES[parsed.book] ?? parsed.book) : osisRef;
  const label = parsed ? `${bookName} ${parsed.chapter}:${parsed.verse}` : osisRef;

  function openInMainView() {
    if (!parsed || !source) return;
    router.push(`/${encodeURIComponent(parsed.book)}/${source}/${parsed.chapter}?v=${parsed.verse}`);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>
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
          <p
            className="leading-relaxed text-lg"
            dir={isHebrew ? "rtl" : "ltr"}
            lang={isHebrew ? "he" : "grc"}
            style={{ color: "var(--foreground)" }}
          >
            {words.map((w) => (
              <PreviewWord key={w.wordId} word={w} useLinguisticTerms={useLinguisticTerms} />
            ))}
          </p>
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
