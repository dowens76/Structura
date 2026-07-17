"use client";

import { useState } from "react";
import type { Word } from "@/lib/db/schema";
import MorphologyPanel from "./MorphologyPanel";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface ParallelChapterViewProps {
  osisBook: string;
  /** MT/OSHB chapters being shown (e.g. [9, 10] when Ps 9+10 map to LXX Ps 9). */
  oshbChapters: number[];
  /** LXX chapters being shown (e.g. [9], or [114, 115] when MT Ps 116 = LXX 114+115). */
  lxxChapters: number[];
  oshbWords: Word[];
  lxxWords: Word[];
}

interface VerseEntry {
  chapter: number;
  verse: number;
  words: Word[];
}

/** Group a flat word array into [{chapter, verse, words}] ordered by (chapter, verse). */
function groupByChapterVerse(words: Word[]): VerseEntry[] {
  const map = new Map<string, VerseEntry>();
  for (const w of words) {
    const key = `${w.chapter}:${w.verse}`;
    if (!map.has(key)) {
      map.set(key, { chapter: w.chapter, verse: w.verse, words: [] });
    }
    map.get(key)!.words.push(w);
  }
  // Return in order — words are already ordered by (chapter, verse, position), so
  // insertion order in the Map preserves the correct sequence.
  return [...map.values()];
}

/** Format a chapter range as "9–10" or just "9". */
function chapterRangeLabel(chapters: number[]): string {
  if (chapters.length === 0) return "";
  if (chapters.length === 1) return String(chapters[0]);
  return `${chapters[0]}–${chapters[chapters.length - 1]}`;
}

export default function ParallelChapterView({
  osisBook,
  oshbChapters,
  lxxChapters,
  oshbWords,
  lxxWords,
}: ParallelChapterViewProps) {
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const oshbVerses = groupByChapterVerse(oshbWords);
  const lxxVerses  = groupByChapterVerse(lxxWords);

  // Align verse rows positionally: row i of oshbVerses ↔ row i of lxxVerses.
  // The two arrays should have the same length when versification is correct
  // (verified: MT Ps 9(21v)+10(18v)=39 = LXX Ps 9(39v), etc.).
  // Any trailing rows in the longer array will render with an empty partner.
  const rowCount = Math.max(oshbVerses.length, lxxVerses.length);

  const { refBookName: getRefBookName } = useTranslation();
  const bookName = getRefBookName(osisBook);

  const oshbLabel = `${bookName} ${chapterRangeLabel(oshbChapters)}`;
  const lxxLabel  = `${bookName} ${chapterRangeLabel(lxxChapters)}`;

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
            Hebrew — {oshbLabel}
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
            Septuagint — {lxxLabel}
          </div>
        </div>

        {/* Verse rows */}
        <div className="px-0">
          {Array.from({ length: rowCount }, (_, i) => {
            const oshbEntry = oshbVerses[i];
            const lxxEntry  = lxxVerses[i];

            // Show a chapter-break divider when the chapter changes within a multi-chapter column
            const oshbChapterBreak = oshbChapters.length > 1 && oshbEntry &&
              i > 0 && oshbVerses[i - 1] && oshbEntry.chapter !== oshbVerses[i - 1].chapter;
            const lxxChapterBreak = lxxChapters.length > 1 && lxxEntry &&
              i > 0 && lxxVerses[i - 1] && lxxEntry.chapter !== lxxVerses[i - 1].chapter;

            return (
              <div key={i}>
                {/* Chapter break divider (for merged/split chapters) */}
                {(oshbChapterBreak || lxxChapterBreak) && (
                  <div
                    className="grid grid-cols-2 border-b"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div
                      className="border-r px-5 py-1 text-[11px] font-semibold"
                      style={{ borderColor: "var(--border)", color: "var(--accent)", backgroundColor: "rgba(200,155,60,0.08)" }}
                    >
                      {oshbChapterBreak ? `${bookName} ${oshbEntry.chapter}` : ""}
                    </div>
                    <div
                      className="px-5 py-1 text-[11px] font-semibold"
                      style={{ color: "#5b9bd5", backgroundColor: "rgba(100,160,220,0.08)" }}
                    >
                      {lxxChapterBreak ? `${bookName} ${lxxEntry.chapter}` : ""}
                    </div>
                  </div>
                )}

                <div
                  className="grid grid-cols-2 border-b"
                  style={{ borderColor: "var(--border)" }}
                >
                  {/* OSHB column (Hebrew, RTL) */}
                  <div
                    className="px-5 py-3 border-r"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {oshbEntry ? (
                      <div className="flex items-start gap-3" dir="rtl">
                        {/* Verse number — on the start (right) side for Hebrew RTL */}
                        <span
                          className="text-sm font-mono shrink-0 mt-0.5"
                          style={{ color: "var(--text-muted)", minWidth: "2rem", textAlign: "left" }}
                        >
                          {oshbEntry.verse}
                        </span>
                        <span
                          className="text-hebrew leading-loose"
                          lang="he"
                          style={{ fontSize: "var(--hebrew-font-size, 1.375rem)" }}
                        >
                          {oshbEntry.words.map((w) => {
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
                                {surface}{!surface.endsWith("־") && " "}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3" dir="rtl">
                        <span
                          className="text-sm font-mono shrink-0 mt-0.5"
                          style={{ color: "var(--text-muted)", minWidth: "2rem", textAlign: "left" }}
                        />
                        <span className="text-sm italic" style={{ color: "var(--text-muted)" }} dir="ltr">
                          —
                        </span>
                      </div>
                    )}
                  </div>

                  {/* LXX column (Greek, LTR) */}
                  <div className="px-5 py-3">
                    {lxxEntry ? (
                      <div className="flex items-start gap-3">
                        <span
                          className="text-sm font-mono shrink-0 mt-0.5"
                          style={{ color: "var(--text-muted)", minWidth: "2rem" }}
                        >
                          {lxxEntry.verse}
                        </span>
                        <span
                          className="text-greek leading-loose"
                          lang="grc"
                          style={{ fontSize: "var(--greek-font-size, 1.25rem)" }}
                        >
                          {lxxEntry.words.map((w) => {
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
                          })}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <span
                          className="text-sm font-mono shrink-0 mt-0.5"
                          style={{ color: "var(--text-muted)", minWidth: "2rem" }}
                        />
                        <span className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                          —
                        </span>
                      </div>
                    )}
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
