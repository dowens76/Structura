"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Word } from "@/lib/db/schema";
import { getMorphology } from "@/lib/morphology/decode";
import { formatTense } from "@/lib/morphology/types";
import { getGreekLexicon, getHebrewLexicon } from "@/components/SettingsButton";

// Module-level cache: "G2316:AbbottSmith" → "a god, God"
const glossCache = new Map<string, string | null>();

interface ParseTooltipProps {
  word: Word;
  flipped?: boolean;
  useLinguisticTerms?: boolean;
  /** Ref to a clipping ancestor (e.g. a narrow side pane) to keep the
   *  tooltip's left/right edges within. When omitted, the tooltip stays
   *  centered on the word with no horizontal clamping (existing behavior). */
  containerRef?: React.RefObject<HTMLElement | null>;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <tr>
      <td className="pr-3 text-stone-400 text-right">{label}</td>
      <td className="capitalize font-medium">{value}</td>
    </tr>
  );
}

export default function ParseTooltip({ word, flipped = false, useLinguisticTerms = false, containerRef }: ParseTooltipProps) {
  const isHebrew = word.language === "hebrew";
  const morph = getMorphology(word);
  const displaySurface = (word.surfaceText ?? "").replace(/\//g, "");

  const [gloss, setGloss] = useState<string | null>(null);
  const [prefixGlosses, setPrefixGlosses] = useState<Record<string, string | null>>({});

  // When containerRef is given, clamp the tooltip's horizontal position so it
  // doesn't overflow past that ancestor's edges (which, in a narrow side pane
  // clipped by overflow:hidden, would otherwise make part of it invisible).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shiftX, setShiftX] = useState(0);
  const shiftXRef = useRef(0);

  useLayoutEffect(() => {
    if (!containerRef?.current || !wrapperRef.current) { setShiftX(0); shiftXRef.current = 0; return; }

    // getBoundingClientRect() reflects the CURRENT transform, so back out
    // whatever shift is already applied (tracked in shiftXRef, not the
    // `shiftX` state, to avoid re-running this effect on every shift change)
    // to get the tooltip's natural, centered position. Recomputing from that
    // fixed reference every time keeps this idempotent — measuring the
    // already-shifted rect directly (without backing it out) fed into
    // itself and caused an infinite update loop.
    const tipRect = wrapperRef.current.getBoundingClientRect();
    const naturalLeft = tipRect.left - shiftXRef.current;

    const margin = 6;
    const containerRect = containerRef.current.getBoundingClientRect();
    const minLeft = containerRect.left + margin;
    const maxLeft = containerRect.right - margin - tipRect.width;
    // Clamp into [minLeft, maxLeft] in one step (rather than checking each
    // edge separately) so correcting one side's overflow can never itself
    // push the other side out of bounds. When the container is narrower
    // than the tooltip + margins, maxLeft < minLeft and this falls back to
    // favoring the right edge — an unavoidable compromise, not a bug.
    const clampedLeft = Math.min(Math.max(naturalLeft, minLeft), maxLeft);
    const shift = clampedLeft - naturalLeft;
    shiftXRef.current = shift;
    setShiftX(shift);
  });

  useEffect(() => {
    // Greek: look up by lemma. Hebrew: look up by Strong's number.
    const useGreekLemma   = !isHebrew && !!word.lemma;
    const useHebrewStrong = isHebrew  && !!word.strongNumber;
    if (!useGreekLemma && !useHebrewStrong) return;

    const source   = isHebrew ? getHebrewLexicon() : getGreekLexicon();
    const lookupId = isHebrew
      ? word.strongNumber!.split(/[/,\s]/)[0].trim()
      : word.lemma!;
    const cacheKey = `${lookupId}:${source}`;

    if (glossCache.has(cacheKey)) {
      setGloss(glossCache.get(cacheKey) ?? null);
      return;
    }

    const url = isHebrew
      ? `/api/lexicon?strong=${encodeURIComponent(lookupId)}&source=${encodeURIComponent(source)}`
      : `/api/lexicon?lemma=${encodeURIComponent(lookupId)}&source=${encodeURIComponent(source)}`;

    fetch(url)
      .then((r) => r.json())
      .then((data: { entry: { shortGloss?: string | null } | null }) => {
        const g = data.entry?.shortGloss ?? null;
        glossCache.set(cacheKey, g);
        setGloss(g);
      })
      .catch(() => { glossCache.set(cacheKey, null); });
  }, [word.lemma, word.strongNumber, isHebrew]);

  // Hebrew bound prefixes (e.g. ב, ו, ה) only exist in BDB; fetch each
  // resolvable prefix's own short gloss so the tooltip shows the whole
  // compound word, not just its root.
  useEffect(() => {
    const keys = isHebrew
      ? morph.prefixes.map((p) => p.lexiconKey).filter((k): k is string => !!k)
      : [];
    if (keys.length === 0) { setPrefixGlosses({}); return; }

    let cancelled = false;
    (async () => {
      const results: Record<string, string | null> = {};
      for (const key of keys) {
        const cacheKey = `${key}:BDB`;
        if (glossCache.has(cacheKey)) {
          results[key] = glossCache.get(cacheKey) ?? null;
          continue;
        }
        try {
          const res = await fetch(`/api/lexicon?strong=${encodeURIComponent(key)}&source=BDB`);
          const data: { entry: { shortGloss?: string | null } | null } = await res.json();
          const g = data.entry?.shortGloss ?? null;
          glossCache.set(cacheKey, g);
          results[key] = g;
        } catch {
          glossCache.set(cacheKey, null);
          results[key] = null;
        }
      }
      if (!cancelled) setPrefixGlosses(results);
    })();
    return () => { cancelled = true; };
  }, [isHebrew, word.morphCode, word.surfaceText]);

  const arrowUp = (
    <div className="flex justify-center">
      <div className="w-2 h-2 bg-stone-900 border-l border-t border-stone-700 rotate-45 -mb-1" />
    </div>
  );

  const arrowDown = (
    <div className="flex justify-center">
      <div className="w-2 h-2 bg-stone-900 border-r border-b border-stone-700 rotate-45 -mt-1" />
    </div>
  );

  const box = (
    <div className="bg-stone-900 text-stone-100 rounded-lg shadow-xl px-3 py-2.5 text-left text-xs border border-stone-700">
      {/* Surface text + lemma */}
      <div className="mb-1.5 pb-1.5 border-b border-stone-700">
        <div
          className={`text-lg leading-tight ${isHebrew ? "text-hebrew text-right" : "text-greek"}`}
          dir={isHebrew ? "rtl" : "ltr"}
          lang={isHebrew ? "he" : "grc"}
          style={{ color: "#f5f5f4" /* stone-100 — .text-hebrew/[lang] force color: var(--foreground), which is unreadable on this box's black background */ }}
        >
          {displaySurface}
        </div>
        {word.lemma && word.textSource !== "OSHB" && word.textSource !== "STEPBIBLE_LXX" && (
          <div
            className={`text-stone-400 text-xs mt-0.5 ${isHebrew ? "text-hebrew" : "text-greek"}`}
            dir={isHebrew ? "rtl" : "ltr"}
            lang={isHebrew ? "he" : "grc"}
            style={{ color: "#a8a29e" /* stone-400, same override reason as above */ }}
          >
            {word.lemma}
          </div>
        )}
        {word.strongNumber && (
          <div className="text-stone-500 text-[10px] font-mono mt-0.5">{word.strongNumber}</div>
        )}
        {/* Lexicon gloss */}
        {gloss && (
          <div className="text-stone-300 text-xs mt-1 italic">
            {gloss}
          </div>
        )}

        {/* Bound prefixes (e.g. ב, ו, ה) — each with its own BDB gloss */}
        {isHebrew && morph.prefixes.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {morph.prefixes.map((p, idx) => (
              <div key={idx} className="text-[10px] leading-tight">
                <span className="text-stone-400">{p.label}</span>
                {p.lexiconKey && prefixGlosses[p.lexiconKey] && (
                  <span className="text-stone-500 italic"> — {prefixGlosses[p.lexiconKey]}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Parsing table */}
      <table className="w-full">
        <tbody>
          {morph.partOfSpeech && (
            <Row label="POS" value={morph.partOfSpeech} />
          )}
          {isHebrew && <Row label="Stem" value={morph.stem} />}
          {isHebrew
            ? <Row label="Aspect" value={formatTense(morph.tense, useLinguisticTerms)} />
            : <Row label="Tense" value={morph.tense} />}
          <Row label="Voice" value={morph.voice} />
          <Row label="Mood" value={morph.mood} />
          <Row label="Person" value={morph.person} />
          <Row label="Number" value={morph.wordNumber} />
          <Row label="Gender" value={morph.gender} />
          <Row label="Case" value={morph.verbCase} />
          {isHebrew && <Row label="State" value={morph.state} />}
        </tbody>
      </table>

      {/* Raw morph code */}
      {word.morphCode && (
        <div className="mt-1.5 pt-1 border-t border-stone-700 text-stone-500 text-[10px] font-mono">
          {word.morphCode}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={wrapperRef}
      className={`absolute left-1/2 z-50 pointer-events-none flex flex-col ${flipped ? "top-full mt-1" : "bottom-full mb-1"}`}
      style={{ minWidth: "180px", transform: `translateX(calc(-50% + ${shiftX}px))` }}
    >
      {flipped ? arrowUp : null}
      {box}
      {!flipped ? arrowDown : null}
    </div>
  );
}
