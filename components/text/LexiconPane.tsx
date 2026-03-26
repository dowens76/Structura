"use client";

import { useEffect, useRef, useState } from "react";
import type { LexiconEntry } from "@/lib/db/schema";

interface LexiconPaneProps {
  strongNumber: string; // e.g. "H7225" or "G2316"
  isHebrew: boolean;
}

export default function LexiconPane({ strongNumber, isHebrew }: LexiconPaneProps) {
  const [entry, setEntry] = useState<LexiconEntry | null | "loading">("loading");
  const lastFetched = useRef<string>("");

  useEffect(() => {
    if (!strongNumber || strongNumber === lastFetched.current) return;
    lastFetched.current = strongNumber;
    setEntry("loading");

    // Some OSHB words have compound lemmas like "H430/H7225" — take the first.
    const primary = strongNumber.split(/[/,\s]/)[0].trim();

    fetch(`/api/lexicon?strong=${encodeURIComponent(primary)}`)
      .then((r) => r.json())
      .then((data: { entry: LexiconEntry | null }) => {
        if (lastFetched.current === strongNumber) setEntry(data.entry);
      })
      .catch(() => {
        if (lastFetched.current === strongNumber) setEntry(null);
      });
  }, [strongNumber]);

  if (entry === "loading") {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800 space-y-2 animate-pulse">
        <div className="h-7 w-24 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-4 w-40 bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-full bg-stone-100 dark:bg-stone-800 rounded" />
        <div className="h-3 w-5/6 bg-stone-100 dark:bg-stone-800 rounded" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-400 dark:text-stone-600 italic">
        No lexicon entry found for {strongNumber}.
      </div>
    );
  }

  const sourceName =
    entry.source === "BDB"          ? "Brown-Driver-Briggs (Unabridged)" :
    entry.source === "HebrewStrong" ? "Brown-Driver-Briggs" :
    entry.source === "Dodson"       ? "Dodson Greek Lexicon" :
    entry.source === "AbbottSmith"  ? "Abbott-Smith" :
    (entry.source ?? "");

  // ── Full BDB HTML rendering ─────────────────────────────────────────────────
  // The .bdb-entry CSS class handles <heb> → Ezra SIL and all other styling.
  if (entry.source === "BDB" && entry.definition) {
    return (
      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
        <div
          className="bdb-entry"
          // Content is from a trusted local DB populated from a known academic source.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: entry.definition }}
        />
        <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-3">
          {sourceName}
        </p>
      </div>
    );
  }

  // ── Structured rendering (Dodson / HebrewStrong / Abbott-Smith) ────────────
  //
  // .lexicon-hebrew  sets font-family: Ezra SIL + rtl, no size/line-height side-effects
  // .lexicon-greek   sets font-family: Gentium Plus,    no size/line-height side-effects
  //
  const headwordFont = isHebrew ? "lexicon-hebrew" : "lexicon-greek";
  const headwordDir  = isHebrew ? "rtl" : "ltr";
  const headwordLang = isHebrew ? "he"  : "grc";

  return (
    <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">

      {/* Headword — large, script-appropriate font */}
      <div
        className={`text-2xl leading-snug mb-1 ${headwordFont} ${isHebrew ? "text-right" : ""}`}
        dir={headwordDir}
        lang={headwordLang}
      >
        {entry.lemma}
      </div>

      {/* Sub-headword line:
          • Dodson  → full Greek form, e.g. "θεός, οῦ, ὁ"  (Gentium, muted)
          • BDB/HebrewStrong → Latin transliteration / pronunciation (italic, muted) */}
      {(entry.transliteration || entry.pronunciation) && (
        <div className="mb-2">
          {entry.transliteration && (
            entry.source === "Dodson" ? (
              <span
                className="text-sm lexicon-greek text-stone-500 dark:text-stone-400"
                lang="grc"
              >
                {entry.transliteration}
              </span>
            ) : (
              <span className="text-xs italic text-stone-400 dark:text-stone-500">
                {entry.transliteration}
              </span>
            )
          )}
          {entry.pronunciation && (
            <span className="ml-1 text-xs text-stone-400 dark:text-stone-600">
              ({entry.pronunciation})
            </span>
          )}
        </div>
      )}

      {/* Short gloss */}
      {entry.shortGloss && (
        <p className="text-sm font-semibold text-stone-800 dark:text-stone-200 mb-2">
          {entry.shortGloss}
        </p>
      )}

      {/* Full definition */}
      {entry.definition && entry.definition !== entry.shortGloss && (
        <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed mb-2">
          {entry.definition}
        </p>
      )}

      {/* Usage / occurrence note */}
      {entry.usage && (
        <p className="text-xs italic text-stone-400 dark:text-stone-500 leading-relaxed mb-2">
          {entry.usage}
        </p>
      )}

      {/* Source attribution */}
      <p className="text-[10px] text-stone-300 dark:text-stone-700 mt-1">
        {sourceName}
      </p>
    </div>
  );
}
