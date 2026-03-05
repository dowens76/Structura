"use client";

import type { Word } from "@/lib/db/schema";
import { getMorphology } from "@/lib/morphology/decode";
import { formatTense } from "@/lib/morphology/types";

interface ParseTooltipProps {
  word: Word;
  flipped?: boolean;
  useLinguisticTerms?: boolean;
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

export default function ParseTooltip({ word, flipped = false, useLinguisticTerms = false }: ParseTooltipProps) {
  const isHebrew = word.language === "hebrew";
  const morph = getMorphology(word);
  const displaySurface = (word.surfaceText ?? "").replace(/\//g, "");

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
        >
          {displaySurface}
        </div>
        {word.lemma && word.textSource !== "OSHB" && word.textSource !== "STEPBIBLE_LXX" && (
          <div
            className={`text-stone-400 text-xs mt-0.5 ${isHebrew ? "text-hebrew" : "text-greek"}`}
            dir={isHebrew ? "rtl" : "ltr"}
            lang={isHebrew ? "he" : "grc"}
          >
            {word.lemma}
          </div>
        )}
        {word.strongNumber && (
          <div className="text-stone-500 text-[10px] font-mono mt-0.5">{word.strongNumber}</div>
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
      className={`absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col ${flipped ? "top-full mt-1" : "bottom-full mb-1"}`}
      style={{ minWidth: "180px" }}
    >
      {flipped ? arrowUp : null}
      {box}
      {!flipped ? arrowDown : null}
    </div>
  );
}
