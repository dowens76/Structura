"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { SectionRangeForOutline } from "@/lib/utils/outlineExport";
import { generateOutline } from "@/lib/utils/outlineExport";
import { OSIS_REF_BOOK_NAMES } from "@/lib/utils/osis";
import NoteEditor from "@/components/notes/NoteEditor";
import { useTranslation } from "@/lib/i18n/LocaleContext";

// ── Book abbreviation display helper ─────────────────────────────────────────
function bookAbbr(osisCode: string): string {
  return osisCode.replace(/^(\d+)([A-Za-z])/, "$1 $2");
}

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

function toSubscript(n: number): string {
  return String(n).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉"[parseInt(c)]).join("");
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
  transitional?: boolean;
  /** Set to the continuation book's OSIS code for cross-book outline items. */
  bookCode?: string;
}

interface OutlinePaneProps {
  book: string;
  chapter: number;
  textSource: string;
  sceneBreakMap: Map<string, Array<{ heading: string | null; level: number; verse: number; thematic: boolean; thematicLetter: string | null; transitional: boolean }>>;
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null; transitional?: boolean }[];
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
  continuationBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null; transitional?: boolean }[];
  /** Keys whose sectionRanges end has been extended into the continuation book. */
  crossBookRangeKeys: Set<string>;
  loadingContinuation?: boolean;
  /** When provided (passage view), all breaks whose chapter is in this set are treated as
   *  "current" (scroll behaviour) instead of the single `chapter` prop value. */
  passageChapters?: Set<number>;
  // ── Predecessor book (e.g. 1 Sam when viewing 2 Sam) ─────────────────────
  predecessorBook?: string | null;
  predecessorBookName?: string | null;
  predecessorBreaks?: { wordId: string; heading: string | null; level: number; chapter: number; verse: number; positionInVerse: number; thematic: boolean; thematicLetter: string | null; transitional?: boolean }[];
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
  const { t } = useTranslation();
  const [editKey, setEditKey]       = useState<string | null>(null); // `${wordId}:${level}`
  const [editDraft, setEditDraft]   = useState("");
  // Local overrides for headings edited in other chapters (persisted via API)
  const [headingOverrides, setHeadingOverrides] = useState<Map<string, string | null>>(new Map());
  // Keys deleted from other chapters (bookSceneBreaks is a static prop, so filter locally)
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [copied, setCopied]         = useState(false);

  // Book-level notes
  const [bookNotesOpen, setBookNotesOpen] = useState(() => {
    try { return localStorage.getItem("structura:outlineBookNotes") !== "false"; } catch { return true; }
  });
  const [includeBookNotesInCopy, setIncludeBookNotesInCopy] = useState(() => {
    try { return localStorage.getItem("structura:outlineCopyBookNotes") === "true"; } catch { return false; }
  });
  const [bookNoteContent, setBookNoteContent] = useState("{}");
  const [bookNoteLoaded, setBookNoteLoaded] = useState(false);

  useEffect(() => {
    setBookNoteLoaded(false);
    const key = `book:${book}`;
    fetch(`/api/notes?keys=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((data: Record<string, { content: string }>) => {
        setBookNoteContent(data[key]?.content ?? "{}");
        setBookNoteLoaded(true);
      })
      .catch(() => { setBookNoteContent("{}"); setBookNoteLoaded(true); });
  }, [book]);

  function toggleBookNotes() {
    setBookNotesOpen((v) => {
      const next = !v;
      try { localStorage.setItem("structura:outlineBookNotes", String(next)); } catch {}
      return next;
    });
  }

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
        list.push({ wordId, chapter, verse: br.verse, positionInVerse: wordPositionMap.get(wordId) ?? 1, level: br.level, heading: br.heading, thematic: br.thematic, thematicLetter: br.thematicLetter, transitional: br.transitional });
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

    // Two-pass thematic subscript computation.
    // Pass 1: count how many times each thematic letter appears.
    const thematicTotals = new Map<string, number>();
    for (const br of sortedBreaks) {
      if (br.thematic && br.thematicLetter) {
        const l = br.thematicLetter.toUpperCase();
        thematicTotals.set(l, (thematicTotals.get(l) ?? 0) + 1);
      }
    }
    // Pass 2: assign per-break subscript index (only when total > 1).
    const thematicRunning = new Map<string, number>();
    const thematicSubscripts = new Map<string, number>(); // wordId:level → subscript
    for (const br of sortedBreaks) {
      if (br.thematic && br.thematicLetter) {
        const l = br.thematicLetter.toUpperCase();
        if ((thematicTotals.get(l) ?? 0) > 1) {
          const n = (thematicRunning.get(l) ?? 0) + 1;
          thematicRunning.set(l, n);
          thematicSubscripts.set(`${br.wordId}:${br.level}`, n);
        }
      }
    }

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
      const bookPrefix = isPaired ? `${bookAbbr(itemBook)} ` : "";
      let rangeStr: string;
      if (range) {
        const baseRange = formatRange(br.chapter, br.verse, letter, range.endChapter, range.endVerse);
        rangeStr = isCrossBookRange && continuationBook
          ? `${bookPrefix}${br.chapter}:${br.verse}${letter} – ${bookAbbr(continuationBook)} ${range.endChapter}:${range.endVerse}`
          : `${bookPrefix}${baseRange}`;
      } else {
        rangeStr = `${bookPrefix}${br.chapter}:${br.verse}${letter}`;
      }
      let prefix: string;
      if (br.thematic && br.thematicLetter) {
        const sub = thematicSubscripts.get(key);
        prefix = br.thematicLetter + (sub != null ? toSubscript(sub) : "");
      } else {
        prefix = formatPrefix(br.level, counters[br.level]);
      }
      return {
        ...br,
        heading,
        key,
        prefix,
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
    const breaksForCopy = items.map((it) => ({
      wordId: it.wordId, heading: it.heading, level: it.level,
      chapter: it.chapter, verse: it.verse,
      thematic: it.thematic, thematicLetter: it.thematicLetter,
      bookCode: it.bookCode ?? book,
    }));
    let text = generateOutline(breaksForCopy, sectionRanges);
    if (includeBookNotesInCopy && bookNoteContent && bookNoteContent !== "{}") {
      const { extractTextFromTipTap } = await import("@/lib/utils/tiptap-text");
      const noteText = extractTextFromTipTap(bookNoteContent).trim();
      if (noteText) text = noteText + "\n\n" + text;
    }
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
          {t("outlinePane.title")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={copyOutline}
            disabled={items.length === 0}
            className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--text-muted)", backgroundColor: "var(--nav-bg)" }}
            title="Copy outline as plain text"
          >
            {copied ? t("outlinePane.copied") : t("outlinePane.copy")}
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

      {/* Include book notes in copy toggle */}
      <div
        className="shrink-0 px-4 py-2 border-b flex items-center gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={includeBookNotesInCopy}
            onChange={(e) => {
              const next = e.target.checked;
              setIncludeBookNotesInCopy(next);
              try { localStorage.setItem("structura:outlineCopyBookNotes", String(next)); } catch {}
            }}
            className="rounded"
          />
          {t("outlinePane.includeBookNotesInCopy")}
        </label>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {items.length === 0 ? (
          <p className="text-sm px-2" style={{ color: "var(--text-muted)" }}>
            {t("outlinePane.noSectionBreaks")}
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
                    <div className="group flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors">
                      <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: "1.5rem" }}>
                        {item.prefix}
                      </span>
                      {item.transitional && (
                        <span className="shrink-0 text-[10px] text-sky-500 dark:text-sky-400" title="Transitional (janus)">⇔</span>
                      )}
                      {/* Heading text — click to edit; wraps instead of truncating when the pane is narrow */}
                      <span
                        className={`flex-1 min-w-0 break-words cursor-pointer ${textSize}`}
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

        {/* Book Notes */}
        <div className="mt-4 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            className="w-full flex items-center justify-between px-2 py-2 text-xs font-semibold transition-opacity hover:opacity-70 select-none"
            style={{ color: "var(--text-muted)" }}
            onClick={toggleBookNotes}
            title={bookNotesOpen ? t("outlinePane.collapseBookNotes") : t("outlinePane.expandBookNotes")}
          >
            <span>{t("outlinePane.bookNotes")}</span>
            <span className="text-[10px]">{bookNotesOpen ? "▲" : "▼"}</span>
          </button>
          {bookNotesOpen && (
            <div className="px-1 pb-3">
              {bookNoteLoaded ? (
                <NoteEditor
                  key={`book:${book}`}
                  noteKey={`book:${book}`}
                  noteType="book"
                  initialContent={bookNoteContent}
                  book={book}
                />
              ) : (
                <div className="text-xs px-2 py-2" style={{ color: "var(--text-muted)" }}>{t("notes.loading")}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
