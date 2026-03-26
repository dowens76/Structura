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

  const sourceName = entry.source === "HebrewStrong"
    ? "Brown-Driver-Briggs"
    : entry.source === "AbbottSmith"
    ? "Abbott-Smith"
    : entry.source ?? "";

  return (
    <div className="mt-5 pt-4 border-t border-stone-100 dark:border-stone-800">
      {/* Headword */}
      <div
        className={`text-2xl leading-relaxed mb-0.5 ${isHebrew ? "text-hebrew text-right" : "text-greek"}`}
        dir={isHebrew ? "rtl" : "ltr"}
        lang={isHebrew ? "he" : "grc"}
      >
        {entry.lemma}
      </div>

      {/* Transliteration / pronunciation */}
      {(entry.transliteration || entry.pronunciation) && (
        <div className="text-xs text-stone-400 dark:text-stone-500 italic mb-2">
          {entry.transliteration && <span>{entry.transliteration}</span>}
          {entry.pronunciation && (
            <span className="ml-1 not-italic text-stone-400 dark:text-stone-600">
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

      {/* Full definition (shown only when it adds content beyond the gloss) */}
      {entry.definition && entry.definition !== entry.shortGloss && (
        <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed mb-2">
          {entry.definition}
        </p>
      )}

      {/* Usage / occurrence note */}
      {entry.usage && (
        <p className="text-xs text-stone-400 dark:text-stone-500 italic leading-relaxed mb-2">
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
