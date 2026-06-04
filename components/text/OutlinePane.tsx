"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import type { SectionRangeForOutline } from "@/lib/utils/outlineExport";
import { generateOutline } from "@/lib/utils/outlineExport";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";

// ── Prefix helpers (mirrors outlineExport.ts) ─────────────────────────────────
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toRoman(n: number): string {
  const vals = [100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}

function formatPrefix(level: number, counter: number): string {
  switch (level) {
    case 1: return toRoman(counter) + ".";
    case 2: return (UPPER[counter - 1] ?? String(counter)) + ".";
    case 3: return String(counter) + ".";
    case 4: return (LOWER[counter - 1] ?? String(counter)) + ".";
    case 5: return "(" + String(counter) + ")";
    case 6: return "(" + (LOWER[counter - 1] ?? String(counter)) + ")";
    default: return String(counter) + ".";
  }
}

function formatRange(
  startChapter: number, startVerse: number, startVerseLetter: string,
  endChapter: number,   endVerse: number,
): string {
  const sv = `${startVerse}${startVerseLetter}`;
  if (startChapter === endChapter) {
    return (startVerse === endVerse && !startVerseLetter)
      ? `${startChapter}:${sv}`
      : `${startChapter}:${sv}–${endVerse}`;
  }
  return `${startChapter}:${sv}–${endChapter}:${endVerse}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawBreak {
  wordId: string;
  chapter: number;
  verse: number;
  positionInVerse: number;
  level: number;
  heading: string | null;
  thematic: boolean;
  thematicLetter: string | null;
  /** Set to the continuation book's OSIS code for cross-book outline items. */
  bookCode?: string;
}

interface OutlinePaneProps {
  book: string;
  chapter: number;
  textSource: string;
  sceneBreakMap: Map<string, Array<{ heading: string | null; level: number; verse: number; thematic: boolean; thematicLetter: string | null }>>;
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[];
  /** wordId → positionInVerse for current-chapter words (covers live sceneBreakMap entries). */
  wordPositionMap: Map<string, number>;
  sectionRanges: Map<string, SectionRangeForOutline>;
  onUpdateCurrentHeading: (wordId: string, level: number, heading: string) => void;
  onDeleteCurrentBreak: (wordId: string, level: number) => void;
  onClose: () => void;
  // ── Cross-book extension (state lives in ChapterDisplay) ──────────────────
  outlineExtended: boolean;
  onToggleExtended: (v: boolean) => void;
  continuationBook: string | null;
  continuationBookName: string | null;
  /** Breaks fetched from the continuation book (already tagged with bookCode). */
  continuationBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[];
  /** Keys whose sectionRanges end has been extended into the continuation book. */
  crossBookRangeKeys: Set<string>;
  loadingContinuation?: boolean;
  /** When provided (passage view), all breaks whose chapter is in this set are treated as
   *  "current" (scroll behaviour) instead of the single `chapter` prop value. */
  passageChapters?: Set<number>;
  // ── Predecessor book (e.g. 1 Sam when viewing 2 Sam) ─────────────────────
  predecessorBook?: string | null;
  predecessorBookName?: string | null;
  predecessorBreaks?: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null }[];
  outlinePredecessorShown?: boolean;
  onTogglePredecessorShown?: (v: boolean) => void;
  loadingPredecessor?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutlinePane({
  book,
  chapter,
  textSource,
  sceneBreakMap,
  bookSceneBreaks,
  sectionRanges,
  onUpdateCurrentHeading,
  onDeleteCurrentBreak,
  onClose,
  outlineExtended,
  onToggleExtended,
  continuationBook,
  continuationBookName,
  continuationBreaks,
  crossBookRangeKeys,
  wordPositionMap,
  loadingContinuation = false,
  passageChapters,
  predecessorBook = null,
  predecessorBookName = null,
  predecessorBreaks = [],
  outlinePredecessorShown = false,
  onTogglePredecessorShown,
  loadingPredecessor = false,
}: OutlinePaneProps) {
  const [editKey, setEditKey]       = useState<string | null>(null); // `${wordId}:${level}`
  const [editDraft, setEditDraft]   = useState("");
  // Local overrides for headings edited in other chapters (persisted via API)
  const [headingOverrides, setHeadingOverrides] = useState<Map<string, string | null>>(new Map());
  // Keys deleted from other chapters (bookSceneBreaks is a static prop, so filter locally)
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [copied, setCopied]         = useState(false);

  const INDENT_PX = 18;

  // Merge current-chapter live state with book-wide static data
  const sortedBreaks = useMemo<RawBreak[]>(() => {
    const list: RawBreak[] = [];
    if (outlinePredecessorShown) {
      for (const b of predecessorBreaks) {
        list.push({ ...b, bookCode: predecessorBook ?? undefined });
      }
    }
    for (const b of bookSceneBreaks) {
      if (b.chapter !== chapter) list.push(b);
    }
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        list.push({ wordId, chapter, verse: br.verse, positionInVerse: wordPositionMap.get(wordId) ?? 1, level: br.level, heading: br.heading, thematic: br.thematic, thematicLetter: br.thematicLetter });
      }
    }
    if (outlineExtended) {
      for (const b of continuationBreaks) {
        list.push({ ...b, bookCode: continuationBook ?? undefined });
      }
    }
    list.sort((a, b) => {
      // Predecessor-book items always sort before current-book; continuation after
      const aIdx = a.bookCode === predecessorBook ? -1 : a.bookCode ? 1 : 0;
      const bIdx = b.bookCode === predecessorBook ? -1 : b.bookCode ? 1 : 0;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.chapter !== b.chapter ? a.chapter - b.chapter :
             a.verse   !== b.verse   ? a.verse   - b.verse   :
             a.positionInVerse !== b.positionInVerse ? a.positionInVerse - b.positionInVerse :
             a.level   - b.level;
    });
    return list;
  }, [bookSceneBreaks, sceneBreakMap, chapter, outlineExtended, continuationBreaks, continuationBook, wordPositionMap, outlinePredecessorShown, predecessorBreaks, predecessorBook]);

  // Precompute per-verse sub-verse letters: for each (bookCode,chapter,verse), sort breaks by
  // positionInVerse and assign "" (pos 1) or "b","c",… (subsequent mid-verse positions).
  const breakLetterMap = useMemo(() => {
    const map = new Map<string, string>(); // wordId → letter
    // Group by (bookCode|""|chapter|verse)
    const groups = new Map<string, RawBreak[]>();
    for (const br of sortedBreaks) {
      const gk = `${br.bookCode ?? ""}|${br.chapter}|${br.verse}`;
      const g = groups.get(gk) ?? [];
      if (!g.some((b) => b.wordId === br.wordId)) g.push(br);
      groups.set(gk, g);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.positionInVerse - b.positionInVerse);
      let midIdx = 0;
      for (const br of group) {
        if (br.positionInVerse === 1) {
          map.set(br.wordId, "");
        } else {
          map.set(br.wordId, String.fromCharCode(97 + 1 + midIdx));
          midIdx++;
        }
      }
    }
    return map;
  }, [sortedBreaks]);

  // Compute display items (prefix counters, ranges, heading overrides applied)
  const items = useMemo(() => {
    const isPaired = outlinePredecessorShown || outlineExtended;
    const counters = [0, 0, 0, 0, 0, 0, 0];
    return sortedBreaks.map((br) => {
      if (!br.thematic) {
        counters[br.level]++;
        for (let l = br.level + 1; l <= 6; l++) counters[l] = 0;
      }
      const key   = `${br.wordId}:${br.level}`;
      const range = sectionRanges.get(key);
      const heading = headingOverrides.has(key)
        ? headingOverrides.get(key) ?? null
        : br.heading;
      const thematicIndent = br.thematic && br.thematicLetter
        ? (br.thematicLetter.toUpperCase().charCodeAt(0) - 65 + 1) * INDENT_PX
        : null;
      const isCrossBookRange = crossBookRangeKeys.has(key);
      const letter = breakLetterMap.get(br.wordId) ?? "";
      const itemBook = br.bookCode ?? book;
      const bookPrefix = isPaired ? `${itemBook} ` : "";
      let rangeStr: string;
      if (range) {
        const baseRange = formatRange(br.chapter, br.verse, letter, range.endChapter, range.endVerse);
        rangeStr = isCrossBookRange && continuationBook
          ? `${bookPrefix}${br.chapter}:${br.verse}${letter} – ${continuationBook} ${range.endChapter}:${range.endVerse}`
          : `${bookPrefix}${baseRange}`;
      } else {
        rangeStr = `${bookPrefix}${br.chapter}:${br.verse}${letter}`;
      }
      return {
        ...br,
        heading,
        key,
        prefix: br.thematic && br.thematicLetter ? br.thematicLetter : formatPrefix(br.level, counters[br.level]),
        rangeStr,
        isCurrent: !br.bookCode && (passageChapters ? passageChapters.has(br.chapter) : br.chapter === chapter),
        thematicIndent,
      };
    });
  }, [sortedBreaks, sectionRanges, headingOverrides, chapter, crossBookRangeKeys, continuationBook, breakLetterMap, passageChapters, book, outlinePredecessorShown, outlineExtended]);

  async function handleDelete(item: (typeof items)[number]) {
    if (item.isCurrent) {
      onDeleteCurrentBreak(item.wordId, item.level);
    } else {
      setDeletedKeys((prev) => { const next = new Set(prev); next.add(item.key); return next; });
      await fetch("/api/scene-breaks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: item.wordId, level: item.level }),
      });
    }
  }

  function startEdit(key: string, heading: string | null) {
    setEditKey(key);
    setEditDraft(heading ?? "");
  }

  async function commitEdit(item: (typeof items)[number]) {
    const trimmed = editDraft.trim();
    if (item.isCurrent) {
      onUpdateCurrentHeading(item.wordId, item.level, trimmed);
    } else {
      // Optimistic local update
      setHeadingOverrides((prev) => {
        const next = new Map(prev);
        next.set(item.key, trimmed || null);
        return next;
      });
      await fetch("/api/scene-breaks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: item.wordId, level: item.level, heading: trimmed || null }),
      });
    }
    setEditKey(null);
  }

  function cancelEdit() {
    setEditKey(null);
  }

  function scrollToVerse(ch: number, v: number) {
    const el = document.querySelector(`[data-osis-ref="${book}.${ch}.${v}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function copyOutline() {
    // Rebuild sortedBreaks with local overrides applied for copy
    const breaksForCopy = items.map((it) => ({
      wordId: it.wordId, heading: it.heading, level: it.level,
      chapter: it.chapter, verse: it.verse,
      thematic: it.thematic, thematicLetter: it.thematicLetter,
      bookCode: it.bookCode ?? book,
    }));
    const text = generateOutline(breaksForCopy, sectionRanges);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--background)", borderLeft: "1px solid var(--border)" }}>
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Outline
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={copyOutline}
            disabled={items.length === 0}
            className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--text-muted)", backgroundColor: "var(--nav-bg)" }}
            title="Copy outline as plain text"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={onClose}
            className="text-lg leading-none px-1 hover:opacity-60 transition-opacity"
            style={{ color: "var(--text-muted)" }}
            title="Close outline"
          >
            ×
          </button>
        </div>
      </div>

      {/* "Include [PredecessorBook]" toggle — only when a contiguous predecessor book exists */}
      {predecessorBook && onTogglePredecessorShown && (
        <div
          className="shrink-0 px-4 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--border)" }}
        >
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={outlinePredecessorShown}
              onChange={(e) => onTogglePredecessorShown(e.target.checked)}
              className="rounded"
            />
            Include{" "}
            <span style={{ color: "var(--foreground)" }}>{predecessorBookName}</span>
            {loadingPredecessor && <span className="opacity-50">…</span>}
          </label>
        </div>
      )}

      {/* "Extend into [Book]" toggle — only when a contiguous successor book exists */}
      {continuationBook && (
        <div
          className="shrink-0 px-4 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--border)" }}
        >
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={outlineExtended}
              onChange={(e) => onToggleExtended(e.target.checked)}
              className="rounded"
            />
            Extend into{" "}
            <span style={{ color: "var(--foreground)" }}>{continuationBookName}</span>
            {loadingContinuation && <span className="opacity-50">…</span>}
          </label>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {items.length === 0 ? (
          <p className="text-sm px-2" style={{ color: "var(--text-muted)" }}>
            No section breaks yet. Use <strong>§</strong> in the toolbar to add section headings.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.filter(item => !deletedKeys.has(item.key)).map((item) => {
              const isEditing = editKey === item.key;
              const indentPx  = item.thematicIndent !== null ? item.thematicIndent : (item.level - 1) * INDENT_PX;
              const textSize  = item.level === 1 ? "text-sm font-semibold"
                : item.level === 2 ? "text-sm font-medium"
                : "text-xs";

              return (
                <li key={item.key} style={{ paddingLeft: indentPx }}>
                  {isEditing ? (
                    <div className="flex items-center gap-1 py-0.5">
                      <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: "1.5rem" }}>
                        {item.prefix}
                      </span>
                      <input
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onBlur={() => commitEdit(item)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitEdit(item); }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        placeholder="Heading…"
                        className="flex-1 text-sm border-b bg-transparent outline-none py-0.5"
                        style={{
                          borderColor: "var(--accent)",
                          color: "var(--foreground)",
                          fontFamily: "Georgia, 'Times New Roman', serif",
                        }}
                      />
                    </div>
                  ) : (
                    <div className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors">
                      <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: "1.5rem" }}>
                        {item.prefix}
                      </span>
                      {/* Heading text — click to edit */}
                      <span
                        className={`flex-1 min-w-0 truncate cursor-pointer ${textSize}`}
                        style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
                        title="Click to edit heading"
                        onClick={() => startEdit(item.key, item.heading)}
                      >
                        {item.heading ?? <em style={{ color: "var(--text-muted)" }}>untitled</em>}
                      </span>
                      {/* Verse range — clicking navigates */}
                      {item.isCurrent ? (
                        <button
                          className="shrink-0 text-[10px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          onClick={() => scrollToVerse(item.chapter, item.verse)}
                          title={`Scroll to verse ${item.rangeStr}`}
                        >
                          {item.rangeStr}
                        </button>
                      ) : (
                        <Link
                          href={`/${encodeURIComponent(item.bookCode ?? book)}/${textSource}/${item.chapter}`}
                          className="shrink-0 text-[10px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          title={`Go to ${item.bookCode ? (OSIS_REF_BOOK_NAMES[item.bookCode] ?? item.bookCode) + " " : ""}chapter ${item.chapter}, verse ${item.verse}`}
                        >
                          {item.rangeStr}
                        </Link>
                      )}
                      {/* Delete button — visible on hover */}
                      <button
                        onClick={() => handleDelete(item)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400"
                        style={{ color: "var(--text-muted)" }}
                        title="Delete section heading"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
