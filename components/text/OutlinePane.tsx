"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import type { SectionRangeForOutline } from "@/lib/utils/outlineExport";
import { generateOutline } from "@/lib/utils/outlineExport";

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
  startChapter: number, startVerse: number,
  endChapter: number,   endVerse: number,
): string {
  if (startChapter === endChapter) {
    return startVerse === endVerse
      ? `${startChapter}:${startVerse}`
      : `${startChapter}:${startVerse}–${endVerse}`;
  }
  return `${startChapter}:${startVerse}–${endChapter}:${endVerse}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawBreak {
  wordId: string;
  chapter: number;
  verse: number;
  level: number;
  heading: string | null;
}

interface OutlinePaneProps {
  book: string;
  chapter: number;
  textSource: string;
  sceneBreakMap: Map<string, Array<{ heading: string | null; level: number; verse: number }>>;
  bookSceneBreaks: { wordId: string; heading: string | null; level: number; chapter: number; verse: number }[];
  sectionRanges: Map<string, SectionRangeForOutline>;
  onUpdateCurrentHeading: (wordId: string, level: number, heading: string) => void;
  onClose: () => void;
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
  onClose,
}: OutlinePaneProps) {
  const [editKey, setEditKey]       = useState<string | null>(null); // `${wordId}:${level}`
  const [editDraft, setEditDraft]   = useState("");
  // Local overrides for headings edited in other chapters (persisted via API)
  const [headingOverrides, setHeadingOverrides] = useState<Map<string, string | null>>(new Map());
  const [copied, setCopied]         = useState(false);

  // Merge current-chapter live state with book-wide static data
  const sortedBreaks = useMemo<RawBreak[]>(() => {
    const list: RawBreak[] = [];
    for (const b of bookSceneBreaks) {
      if (b.chapter !== chapter) list.push(b);
    }
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        list.push({ wordId, chapter, verse: br.verse, level: br.level, heading: br.heading });
      }
    }
    list.sort((a, b) =>
      a.chapter !== b.chapter ? a.chapter - b.chapter :
      a.verse   !== b.verse   ? a.verse   - b.verse   :
      a.level   - b.level
    );
    return list;
  }, [bookSceneBreaks, sceneBreakMap, chapter]);

  // Compute display items (prefix counters, ranges, heading overrides applied)
  const items = useMemo(() => {
    const counters = [0, 0, 0, 0, 0, 0, 0];
    return sortedBreaks.map((br) => {
      counters[br.level]++;
      for (let l = br.level + 1; l <= 6; l++) counters[l] = 0;
      const key   = `${br.wordId}:${br.level}`;
      const range = sectionRanges.get(key);
      const heading = headingOverrides.has(key)
        ? headingOverrides.get(key) ?? null
        : br.heading;
      return {
        ...br,
        heading,
        key,
        prefix:  formatPrefix(br.level, counters[br.level]),
        rangeStr: range
          ? formatRange(br.chapter, br.verse, range.endChapter, range.endVerse)
          : `${br.chapter}:${br.verse}`,
        isCurrent: br.chapter === chapter,
      };
    });
  }, [sortedBreaks, sectionRanges, headingOverrides, chapter]);

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

  function scrollToVerse(v: number) {
    const el = document.querySelector(`[data-osis-ref="${book}.${chapter}.${v}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function copyOutline() {
    // Rebuild sortedBreaks with local overrides applied for copy
    const breaksForCopy = items.map((it) => ({
      wordId: it.wordId, heading: it.heading, level: it.level,
      chapter: it.chapter, verse: it.verse,
    }));
    const text = generateOutline(breaksForCopy, sectionRanges);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const INDENT_PX = 18;

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

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-3 px-2">
        {items.length === 0 ? (
          <p className="text-sm px-2" style={{ color: "var(--text-muted)" }}>
            No section breaks yet. Use <strong>§</strong> in the toolbar to add section headings.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item) => {
              const isEditing = editKey === item.key;
              const indentPx  = (item.level - 1) * INDENT_PX;
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
                    <div className="group flex items-baseline gap-1.5 rounded px-1 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors">
                      <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: "1.5rem" }}>
                        {item.prefix}
                      </span>
                      {/* Heading text — double-click to edit */}
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
                          onClick={() => scrollToVerse(item.verse)}
                          title={`Scroll to verse ${item.rangeStr}`}
                        >
                          {item.rangeStr}
                        </button>
                      ) : (
                        <Link
                          href={`/${encodeURIComponent(book)}/${textSource}/${item.chapter}`}
                          className="shrink-0 text-[10px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          title={`Go to chapter ${item.chapter}, verse ${item.verse}`}
                        >
                          {item.rangeStr}
                        </Link>
                      )}
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
