"use client";

import { useState } from "react";
import type { Word } from "@/lib/db/schema";
import MorphologyPanel from "./MorphologyPanel";
import { OSIS_BOOK_NAMES } from "@/lib/utils/osis";

interface ParallelChapterViewProps {
  osisBook: string;
  chapter: number;
  oshbWords: Word[];
  lxxWords: Word[];
}

/** Groups an array of Words by verse number. */
function groupByVerse(words: Word[]): Map<number, Word[]> {
  const map = new Map<number, Word[]>();
  for (const w of words) {
    const arr = map.get(w.verse) ?? [];
    arr.push(w);
    map.set(w.verse, arr);
  }
  return map;
}

export default function ParallelChapterView({
  osisBook,
  chapter,
  oshbWords,
  lxxWords,
}: ParallelChapterViewProps) {
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const oshbByVerse = groupByVerse(oshbWords);
  const lxxByVerse  = groupByVerse(lxxWords);

  // Build a sorted union of all verse numbers that appear in either source.
  const verseNums = [...new Set([...oshbByVerse.keys(), ...lxxByVerse.keys()])].sort(
    (a, b) => a - b
  );

  const bookName = OSIS_BOOK_NAMES[osisBook] ?? osisBook;

  function handleSelectWord(word: Word) {
    setSelectedWord(word);
    setPanelOpen(true);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Scrollable parallel columns */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Column headers */}
        <div
          className="sticky top-0 z-10 grid grid-cols-2 border-b shrink-0"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div
            className="px-6 py-2 text-xs font-semibold border-r"
            style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
          >
            <span
              className="inline-block px-1.5 py-0.5 rounded font-mono text-[11px] mr-1"
              style={{ backgroundColor: "rgba(200,155,60,0.15)", color: "var(--accent)" }}
            >
              OSHB
            </span>
            Hebrew — {bookName} {chapter}
          </div>
          <div
            className="px-6 py-2 text-xs font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="inline-block px-1.5 py-0.5 rounded font-mono text-[11px] mr-1"
              style={{ backgroundColor: "rgba(100,160,220,0.15)", color: "#5b9bd5" }}
            >
              LXX
            </span>
            Septuagint — {bookName} {chapter}
          </div>
        </div>

        {/* Verse rows */}
        <div className="px-0">
          {verseNums.map((vn) => {
            const oshbVerse = oshbByVerse.get(vn) ?? [];
            const lxxVerse  = lxxByVerse.get(vn)  ?? [];

            return (
              <div
                key={vn}
                className="grid grid-cols-2 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                {/* OSHB column (Hebrew, RTL) */}
                <div
                  className="px-5 py-3 border-r"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-start gap-3" dir="rtl">
                    {/* Verse number — placed on the start (right) side for Hebrew */}
                    <span
                      className="text-sm font-mono shrink-0 mt-0.5"
                      style={{ color: "var(--text-muted)", minWidth: "2rem", textAlign: "left" }}
                    >
                      {vn}
                    </span>
                    <span
                      className="text-hebrew leading-loose"
                      lang="he"
                      style={{ fontSize: "var(--hebrew-font-size, 1.375rem)" }}
                    >
                      {oshbVerse.length === 0 ? (
                        <span className="text-sm italic" style={{ color: "var(--text-muted)" }} dir="ltr">
                          —
                        </span>
                      ) : (
                        oshbVerse.map((w) => {
                          const surface = (w.surfaceText ?? "").replace(/\//g, "");
                          const isSelected = selectedWord?.wordId === w.wordId;
                          return (
                            <span
                              key={w.wordId}
                              onClick={() => handleSelectWord(w)}
                              className="cursor-pointer rounded px-0.5 transition-colors"
                              style={
                                isSelected
                                  ? { backgroundColor: "rgba(200,155,60,0.35)" }
                                  : undefined
                              }
                            >
                              {surface}{" "}
                            </span>
                          );
                        })
                      )}
                    </span>
                  </div>
                </div>

                {/* LXX column (Greek, LTR) */}
                <div className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="text-sm font-mono shrink-0 mt-0.5"
                      style={{ color: "var(--text-muted)", minWidth: "2rem" }}
                    >
                      {vn}
                    </span>
                    <span
                      className="text-greek leading-loose"
                      lang="grc"
                      style={{ fontSize: "var(--greek-font-size, 1.25rem)" }}
                    >
                      {lxxVerse.length === 0 ? (
                        <span className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                          —
                        </span>
                      ) : (
                        lxxVerse.map((w) => {
                          const isSelected = selectedWord?.wordId === w.wordId;
                          return (
                            <span
                              key={w.wordId}
                              onClick={() => handleSelectWord(w)}
                              className="cursor-pointer rounded px-0.5 transition-colors"
                              style={
                                isSelected
                                  ? { backgroundColor: "rgba(91,155,213,0.3)" }
                                  : undefined
                              }
                            >
                              {w.surfaceText}{" "}
                            </span>
                          );
                        })
                      )}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Word analysis side panel */}
      {panelOpen && (
        <div
          className="w-72 border-l flex flex-col shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b shrink-0"
            style={{ borderColor: "var(--border)" }}
          >
            <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Word Analysis
            </h2>
            <button
              onClick={() => setPanelOpen(false)}
              className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <MorphologyPanel word={selectedWord} />
          </div>
        </div>
      )}
    </div>
  );
}
