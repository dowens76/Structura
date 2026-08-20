"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
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
  /** `${wordId}:${level}` as it was in the untouched prop data (current-chapter
   *  items just reuse their own live key here). This never changes even after
   *  a heading/level edit shifts the *displayed* key, so it's the stable
   *  lookup key for `overrides` below — otherwise a second edit on an
   *  already-edited item couldn't find its own prior override. */
  rawKey: string;
}

/** Local, optimistic edits layered on top of the static book/continuation/predecessor
 *  props (which only refetch on navigation) — keyed by RawBreak.rawKey. Current-chapter
 *  items never need this; they're edited straight through live parent state instead. */
interface BreakOverride {
  heading?: string | null;
  level?: number;
  deleted?: boolean;
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
  /** Moves one current-chapter heading from its level to a new one (1-6), like the
   *  "Change level" buttons in the in-text section-break editor. Used by the pane's
   *  multi-select "increase/decrease indent" bulk action. */
  onChangeCurrentLevel: (wordId: string, fromLevel: number, toLevel: number, verse: number) => void | Promise<void>;
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
  onChangeCurrentLevel,
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
  // Local edits (heading text, level, delete) for headings from other chapters/books —
  // those come from static props that only refetch on navigation, so edits are applied
  // here and persisted via direct API calls. Keyed by RawBreak.rawKey (see above).
  const [overrides, setOverrides] = useState<Map<string, BreakOverride>>(new Map());

  function patchOverride(rawKey: string, patch: BreakOverride) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(rawKey, { ...next.get(rawKey), ...patch });
      return next;
    });
  }

  const [copied, setCopied]         = useState(false);

  // Multi-select "increase/decrease indent" mode — mirrors a word processor's
  // Tab/Shift-Tab: select one or more headings, then shift each one's level
  // up/down by one relative to its own current level.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // True while a bulk indent is running its sequential batch of requests
  // (handleIndent below) — guards against a second click starting an
  // overlapping batch that could interleave with the first and corrupt data.
  const [applyingIndent, setApplyingIndent] = useState(false);

  function toggleSelectMode() {
    setSelectMode((v) => {
      if (v) setSelectedKeys(new Set());
      return !v;
    });
  }

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  // Applies any local override for a static (non-current) break, using its
  // untouched wordId+level as the lookup key, and returns null if it's been
  // deleted. `rawKey` is stamped onto the result so later edits (a second
  // level shift, a heading edit, a delete) can keep finding this same slot.
  function applyOverride(
    b: { wordId: string; level: number; heading: string | null }
  ): { wordId: string; level: number; heading: string | null; rawKey: string } | null {
    const rawKey = `${b.wordId}:${b.level}`;
    const ov = overrides.get(rawKey);
    if (ov?.deleted) return null;
    return {
      wordId: b.wordId,
      level: ov?.level ?? b.level,
      heading: ov?.heading !== undefined ? ov.heading : b.heading,
      rawKey,
    };
  }

  // Merge current-chapter live state with book-wide static data
  const sortedBreaks = useMemo<RawBreak[]>(() => {
    const list: RawBreak[] = [];
    if (outlinePredecessorShown) {
      for (const b of predecessorBreaks) {
        const ov = applyOverride(b);
        if (ov) list.push({ ...b, ...ov, bookCode: predecessorBook ?? undefined });
      }
    }
    for (const b of bookSceneBreaks) {
      if (b.chapter !== chapter) {
        const ov = applyOverride(b);
        if (ov) list.push({ ...b, ...ov });
      }
    }
    for (const [wordId, arr] of sceneBreakMap) {
      for (const br of arr) {
        const key = `${wordId}:${br.level}`;
        list.push({ wordId, chapter, verse: br.verse, positionInVerse: wordPositionMap.get(wordId) ?? 1, level: br.level, heading: br.heading, thematic: br.thematic, thematicLetter: br.thematicLetter, transitional: br.transitional, rawKey: key });
      }
    }
    if (outlineExtended) {
      for (const b of continuationBreaks) {
        const ov = applyOverride(b);
        if (ov) list.push({ ...b, ...ov, bookCode: continuationBook ?? undefined });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookSceneBreaks, sceneBreakMap, chapter, outlineExtended, continuationBreaks, continuationBook, wordPositionMap, outlinePredecessorShown, predecessorBreaks, predecessorBook, overrides]);

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
      // br.heading already reflects any local override — applied earlier, in
      // sortedBreaks, via applyOverride().
      const heading = br.heading;
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
  }, [sortedBreaks, sectionRanges, chapter, crossBookRangeKeys, continuationBook, breakLetterMap, passageChapters, book, outlinePredecessorShown, outlineExtended]);

  // ── Keep the pane scrolled to the section nearest the chapter/passage on
  // screen ─────────────────────────────────────────────────────────────────
  // The outline can run to hundreds of entries across a long book, so without
  // this the reader has to manually hunt for their place every time they
  // navigate. Prefer the first heading that actually starts in the current
  // chapter(s); if this chapter opens no new heading of its own (the common
  // case — most chapters continue the previous section), fall back to the
  // last heading at or before it, i.e. the section the reader is currently
  // inside. Only same-book items are eligible — continuation/predecessor
  // entries never resolve as the target.
  const scrollTargetKey = useMemo(() => {
    const current = items.find((it) => it.isCurrent);
    if (current) return current.key;
    let nearest: (typeof items)[number] | null = null;
    for (const it of items) {
      if (it.bookCode) continue;
      if (it.chapter <= chapter) nearest = it;
      else break;
    }
    return nearest?.key ?? null;
  }, [items, chapter]);

  const outlineBodyRef = useRef<HTMLDivElement>(null);
  const outlineItemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // The book-notes editor and the continuation/predecessor sections below the
  // list all grow the scroll container asynchronously after first paint (the
  // notes editor in particular mounts a placeholder, then swaps in the real
  // TipTap editor once its own content fetch resolves), so a single centering
  // pass right after mount ends up based on a too-short pre-load height. A
  // ResizeObserver re-centers on every actual height change instead of
  // guessing which prop flips mark "settled" — debounced so a burst of
  // layout changes only triggers one adjustment, and capped at a few seconds
  // so it stops before it could fight the reader's own later scrolling.
  useEffect(() => {
    if (!scrollTargetKey) return;
    const container = outlineBodyRef.current;
    if (!container) return;

    function centerOnTarget() {
      const target = outlineItemRefs.current.get(scrollTargetKey!);
      if (!container || !target) return;
      // target.offsetTop is relative to its nearest *positioned* ancestor,
      // which here is a distant layout wrapper, not this (position: static)
      // scroll container — so it can't be used directly.
      // getBoundingClientRect() gives an accurate offset regardless of the
      // positioning context in between.
      const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      const centeredTop = targetTop - container.clientHeight / 2 + target.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, centeredTop), behavior: "smooth" });
    }

    centerOnTarget();

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(centerOnTarget, 150);
    });
    observer.observe(container);
    const stopWatching = setTimeout(() => observer.disconnect(), 3000);

    return () => {
      observer.disconnect();
      clearTimeout(stopWatching);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [scrollTargetKey]);

  // Moves one non-current heading's level, mirroring what onChangeCurrentLevel
  // does for a live current-chapter break: toggle the old level off, the new
  // level on, then restore the heading text (the toggle endpoint only adds/
  // removes bare breaks). Applied optimistically via `overrides`, rolled back
  // on failure. Uses the item's own book/chapter (not the current-word lookup
  // ChapterDisplay's handler relies on, which only knows the loaded chapter).
  async function changeNonCurrentLevel(item: (typeof items)[number], toLevel: number) {
    const fromLevel = item.level;
    const heading = item.heading;
    patchOverride(item.rawKey, { level: toLevel });
    try {
      const bookCode = item.bookCode ?? book;
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: item.wordId, book: bookCode, chapter: item.chapter, verse: item.verse, source: textSource, level: fromLevel }) });
      await fetch("/api/scene-breaks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: item.wordId, book: bookCode, chapter: item.chapter, verse: item.verse, source: textSource, level: toLevel }) });
      if (heading) {
        await fetch("/api/scene-breaks", { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: item.wordId, book: bookCode, chapter: item.chapter, level: toLevel, heading }) });
      }
    } catch {
      patchOverride(item.rawKey, { level: fromLevel });
    }
  }

  // Shifts every selected heading's level by `delta` (±1), relative to each
  // heading's own level — like Increase/Decrease Indent in a word processor.
  // Headings already at the 1/6 boundary, or whose target level would collide
  // with another break already on the same word (levels are unique per word),
  // are silently skipped rather than blocking the rest of the batch. The
  // selection is carried forward onto each item's new level so repeated
  // clicks keep indenting the same headings further.
  // True when `item` already has a heading nested one level deeper somewhere
  // within its own section (i.e. before the next heading at item.level or
  // shallower). Increasing item's indent to that same level would make it a
  // sibling of its own child instead of that child's parent — silently
  // flattening the hierarchy — so this is only meaningful (and only checked)
  // for increases, never decreases: promoting a heading to a shallower level
  // is the normal, always-valid word-processor operation.
  // Shifts every selected heading's level by `delta` (±1), relative to each
  // heading's own level — like Increase/Decrease Indent in a word processor.
  //
  // Collisions (same word already at that level, or a child heading already
  // sitting at that level within the section) are only real blockers when the
  // other break in question ISN'T also part of this same selection. If a
  // parent and its child are selected together, the child moves out of the
  // target level in the very same batch, so the parent doesn't actually
  // collide with it — both should shift as a unit, preserving their relative
  // nesting. `finalLevelOf` resolves this by using a selected item's proposed
  // level instead of its current one when checking for collisions.
  function handleIndent(delta: 1 | -1) {
    if (applyingIndent) return;
    const selected = items.filter((it) => selectedKeys.has(it.key));
    if (selected.length === 0) return;

    const proposedLevel = new Map<string, number>();
    for (const item of selected) {
      proposedLevel.set(item.key, Math.min(6, Math.max(1, item.level + delta)));
    }
    function finalLevelOf(it: (typeof items)[number]): number {
      return proposedLevel.get(it.key) ?? it.level;
    }

    const targets: { item: (typeof items)[number]; to: number }[] = [];
    for (const item of selected) {
      const to = proposedLevel.get(item.key)!;
      if (to === item.level) continue;

      const wordCollision = items.some((it) => it !== item && it.wordId === item.wordId && finalLevelOf(it) === to);
      if (wordCollision) continue;

      if (delta === 1) {
        const idx = items.indexOf(item);
        let childCollision = false;
        for (let i = idx + 1; i < items.length; i++) {
          const it = items[i];
          if ((it.bookCode ?? null) !== (item.bookCode ?? null)) break;
          if (it.level <= item.level) break; // next heading at item's own level (or shallower) — item's section ends here
          if (finalLevelOf(it) === to) { childCollision = true; break; }
        }
        if (childCollision) continue;
      }

      targets.push({ item, to });
    }
    if (targets.length === 0) return;

    // Same-word moves are add/remove pairs at the DB level (toggle old level
    // off, new level on), so a parent+child pair sharing a word — e.g. a
    // heading and its very first subsection both starting on the same word —
    // would race if fired concurrently: the parent could try to claim a
    // level its child hasn't vacated yet. Processing deepest-level-first on
    // increase (and shallowest-first on decrease) guarantees each level is
    // vacated before anything else tries to claim it, so run the whole batch
    // sequentially in that order rather than firing it all at once.
    const ordered = [...targets].sort((a, b) =>
      delta === 1 ? b.item.level - a.item.level : a.item.level - b.item.level
    );
    setApplyingIndent(true);
    (async () => {
      for (const { item, to } of ordered) {
        if (item.isCurrent) await onChangeCurrentLevel(item.wordId, item.level, to, item.verse);
        else await changeNonCurrentLevel(item, to);
      }
      setApplyingIndent(false);
    })();

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const { item, to } of targets) {
        next.delete(item.key);
        next.add(`${item.wordId}:${to}`);
      }
      return next;
    });
  }

  async function handleDelete(item: (typeof items)[number]) {
    if (item.isCurrent) {
      onDeleteCurrentBreak(item.wordId, item.level);
    } else {
      patchOverride(item.rawKey, { deleted: true });
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
      patchOverride(item.rawKey, { heading: trimmed || null });
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
            onClick={toggleSelectMode}
            disabled={items.length === 0}
            className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
            style={selectMode
              ? { color: "#fff", backgroundColor: "var(--accent)" }
              : { color: "var(--nav-fg-muted)", backgroundColor: "var(--nav-bg)" }}
            title="Select headings to change their level (like Tab / Shift-Tab)"
          >
            {selectMode ? "Done" : "Select"}
          </button>
          <button
            onClick={copyOutline}
            disabled={items.length === 0}
            className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--nav-fg-muted)", backgroundColor: "var(--nav-bg)" }}
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

      {/* Select-mode action bar — increase/decrease indent for the selected headings */}
      {selectMode && (
        <div
          className="shrink-0 px-4 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {applyingIndent
              ? "Applying…"
              : selectedKeys.size === 0
              ? "Select headings below…"
              : `${selectedKeys.size} selected`}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => handleIndent(-1)}
              disabled={selectedKeys.size === 0 || applyingIndent}
              className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--nav-fg-muted)", backgroundColor: "var(--nav-bg)" }}
              title="Decrease indent (promote toward level 1)"
            >
              ⇤ Decrease
            </button>
            <button
              onClick={() => handleIndent(1)}
              disabled={selectedKeys.size === 0 || applyingIndent}
              className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--nav-fg-muted)", backgroundColor: "var(--nav-bg)" }}
              title="Increase indent (demote toward level 6)"
            >
              Increase ⇥
            </button>
          </div>
        </div>
      )}

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
      {/* overflowAnchor: none — the browser's own scroll-anchoring would otherwise
          fight the ResizeObserver-driven re-centering above as async content
          (book notes, continuation/predecessor sections) grows this container. */}
      <div ref={outlineBodyRef} className="flex-1 overflow-y-auto py-3 px-2" style={{ overflowAnchor: "none" }}>
        {items.length === 0 ? (
          <p className="text-sm px-2" style={{ color: "var(--text-muted)" }}>
            {t("outlinePane.noSectionBreaks")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item) => {

              const isEditing = editKey === item.key;
              const indentPx  = item.thematicIndent !== null ? item.thematicIndent : (item.level - 1) * INDENT_PX;
              const textSize  = item.level === 1 ? "text-sm font-semibold"
                : item.level === 2 ? "text-sm font-medium"
                : "text-xs";

              return (
                <li
                  key={item.key}
                  ref={(el) => {
                    if (el) outlineItemRefs.current.set(item.key, el);
                    else outlineItemRefs.current.delete(item.key);
                  }}
                  style={{ paddingLeft: indentPx }}
                >
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
                    <div
                      className="group flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors"
                      style={selectMode && selectedKeys.has(item.key) ? { backgroundColor: "var(--accent-muted, rgba(99,102,241,0.12))" } : undefined}
                      onClick={selectMode ? () => toggleSelected(item.key) : undefined}
                    >
                      {selectMode && (
                        <span className="shrink-0 flex items-center" style={{ minHeight: "1.25rem" }}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(item.key)}
                            onChange={() => toggleSelected(item.key)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded"
                            title="Select this heading"
                          />
                        </span>
                      )}
                      <span className="shrink-0 text-xs font-mono" style={{ color: "var(--text-muted)", minWidth: "1.5rem" }}>
                        {item.prefix}
                      </span>
                      {item.transitional && (
                        <span className="shrink-0 text-[10px] text-sky-500 dark:text-sky-400" title="Transitional (janus)">⇔</span>
                      )}
                      {/* Heading text — click to edit (or, in select mode, click anywhere in the row to select); wraps instead of truncating when the pane is narrow */}
                      <span
                        className={`flex-1 min-w-0 break-words ${selectMode ? "" : "cursor-pointer"} ${textSize}`}
                        style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
                        title={selectMode ? undefined : "Click to edit heading"}
                        onClick={selectMode ? undefined : () => startEdit(item.key, item.heading)}
                      >
                        {item.heading ?? <em style={{ color: "var(--text-muted)" }}>untitled</em>}
                      </span>
                      {/* Verse range — clicking navigates */}
                      {item.isCurrent ? (
                        <button
                          className="shrink-0 text-[10px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          onClick={(e) => { e.stopPropagation(); scrollToVerse(item.chapter, item.verse); }}
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
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.rangeStr}
                        </Link>
                      )}
                      {/* Delete button — visible on hover */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
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
