"use client";

import type { Word } from "@/lib/db/schema";
import { POS_COLORS, POS_LABELS, formatTense } from "@/lib/morphology/types";
import { getMorphology } from "@/lib/morphology/decode";
import LexiconPane from "./LexiconPane";

interface MorphologyPanelProps {
  word: Word | null;
  useLinguisticTerms?: boolean;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-2 gap-2 py-1.5 border-b border-stone-100 dark:border-stone-800">
      <span className="text-stone-500 dark:text-stone-400 text-sm">{label}</span>
      <span className="text-stone-900 dark:text-stone-100 capitalize text-sm font-medium">{value}</span>
    </div>
  );
}

export default function MorphologyPanel({ word, useLinguisticTerms = false }: MorphologyPanelProps) {
  if (!word) {
    return (
      <div className="h-full flex items-center justify-center text-stone-400 dark:text-stone-600 text-sm">
        Click a word to see its analysis
      </div>
    );
  }

  const morph = getMorphology(word);
  const isHebrew = word.language === "hebrew";

  const posKey = morph.partOfSpeech ?? word.partOfSpeech ?? null;
  const posColor = posKey ? (POS_COLORS[posKey] ?? "#6b7280") : "#6b7280";
  const posLabel = posKey ? (POS_LABELS[posKey] ?? posKey) : null;

  const refLabel = `${word.chapter}:${word.verse}`;

  const displaySurface = (word.surfaceText ?? "").replace(/\//g, "");

  // For Hebrew, the lemma field is the Strong's number string; skip if same as strongNumber
  const showLemma = word.lemma && word.textSource !== "OSHB" && word.textSource !== "STEPBIBLE_LXX";

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {/* Reference */}
      <div className="text-xs text-stone-400 dark:text-stone-500 mb-3">{refLabel}</div>

      {/* Surface text */}
      <div
        className={`text-3xl mb-1 leading-relaxed ${isHebrew ? "text-hebrew text-right" : "text-greek"}`}
        dir={isHebrew ? "rtl" : "ltr"}
        lang={isHebrew ? "he" : "grc"}
      >
        {displaySurface}
      </div>

      {/* Lemma (Greek only) */}
      {showLemma && (
        <div
          className={`text-lg text-stone-500 dark:text-stone-400 mb-2 ${isHebrew ? "text-hebrew" : "text-greek"}`}
          dir={isHebrew ? "rtl" : "ltr"}
          lang={isHebrew ? "he" : "grc"}
        >
          {word.lemma}
        </div>
      )}

      {/* Strong's number */}
      {word.strongNumber && (
        <div className="text-sm font-mono text-stone-400 dark:text-stone-500 mb-4">
          {word.strongNumber}
        </div>
      )}

      {/* POS badge */}
      {posLabel && (
        <div className="mb-4">
          <span
            className="inline-block px-2.5 py-1 rounded-full text-white text-xs font-semibold"
            style={{ backgroundColor: posColor }}
          >
            {posLabel}
          </span>
        </div>
      )}

      {/* Hebrew prefixes */}
      {isHebrew && morph.prefixes && morph.prefixes.length > 0 && (
        <div className="mb-3 text-xs text-stone-500 dark:text-stone-400">
          <span className="font-medium text-stone-600 dark:text-stone-300">Prefixes: </span>
          {morph.prefixes.join(", ")}
        </div>
      )}

      {/* Parsing fields */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {isHebrew && <Field label="Stem" value={morph.stem} />}
        {isHebrew
          ? <Field label="Aspect" value={formatTense(morph.tense, useLinguisticTerms)} />
          : <Field label="Tense" value={morph.tense} />}
        <Field label="Voice" value={morph.voice} />
        <Field label="Mood" value={morph.mood} />
        <Field label="Person" value={morph.person ? `${morph.person}${morph.person === "1" ? "st" : morph.person === "2" ? "nd" : "rd"}` : null} />
        <Field label="Number" value={morph.wordNumber} />
        <Field label="Gender" value={morph.gender} />
        <Field label="Case" value={morph.verbCase} />
        {isHebrew && <Field label="State" value={morph.state} />}
      </div>

      {/* Raw morph code */}
      {word.morphCode && (
        <div className="mt-4 p-2 bg-stone-50 dark:bg-stone-900 rounded text-xs font-mono text-stone-400 dark:text-stone-500">
          {word.morphCode}
        </div>
      )}

      {/* Lexicon entry (Hebrew + Greek only; LXX has no strong numbers) */}
      {word.strongNumber && word.textSource !== "STEPBIBLE_LXX" && (
        <LexiconPane strongNumber={word.strongNumber} isHebrew={isHebrew} />
      )}

      {/* Word ID */}
      <div className="mt-2 text-xs text-stone-300 dark:text-stone-700 font-mono break-all">
        {word.wordId}
      </div>
    </div>
  );
}
