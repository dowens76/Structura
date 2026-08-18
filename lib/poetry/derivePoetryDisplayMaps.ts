import type { Word, PoetryNotation } from "@/lib/db/schema";

/** Parses a translation-token id (`tv:ABBR:Book.Chapter.Verse.WordIndex`) into
 *  its parts, or returns null for a source Word.wordId (no `tv:` prefix). */
export function parseTvWordId(wordId: string): { abbr: string; book: string; chapter: number; verse: number; wi: number } | null {
  if (!wordId.startsWith("tv:")) return null;
  const [, abbr, ref] = wordId.split(":");
  const parts = ref?.split(".") ?? [];
  if (!abbr || parts.length !== 4) return null;
  const [book, chapterStr, verseStr, wiStr] = parts;
  return { abbr, book, chapter: parseInt(chapterStr, 10), verse: parseInt(verseStr, 10), wi: parseInt(wiStr, 10) };
}

export interface PoetryDisplayMaps {
  poetryWordMarkMap: Map<string, { continuation?: PoetryNotation; requiredness?: PoetryNotation }>;
  poetryRequirednessUnderlineSet: Set<string>;
  poetryRequirednessUnderlineRangesByAbbr: Map<string, { book: string; chapter: number; loKey: number; hiKey: number }[]>;
  poetryClosureWeakSet: Set<string>;
  segLastWordId: Map<string, string>;
  poetryClosureCompleteSet: Set<string>;
  poetryClosureWeakRangesByAbbr: Map<string, { book: string; chapter: number; loKey: number; hiKey: number }[]>;
  poetryClosureCompleteStartIds: Set<string>;
  balanceMarks: PoetryNotation[];
  symmetryMarks: PoetryNotation[];
  similarityMarkByWord: Map<string, { mark: PoetryNotation; startIdx: number; endIdx: number }>;
  /** Similarity "Add word" groups — groupId (a member's own id, see
   *  poetryNotations.similarityGroupId) -> every current member, ordered by
   *  id ascending (= creation order = "Word 1, Word 2, ..."). Marks with no
   *  group don't appear here; callers fall back to `[mark]` for those. */
  similarityGroupMembers: Map<number, PoetryNotation[]>;
  /** Every mark that carries a note, keyed by its startWordId — one lookup
   *  shared across all 6 principles (each anchors a real rendered word there,
   *  even the line/range-based ones), used to show a note indicator badge. */
  poetryNoteMap: Map<string, string>;
}

/**
 * Derives every read-side lookup map/set the Poetry Notation (Gestalt) tool's
 * marks need for rendering, from the raw PoetryNotation rows. Pure and
 * editing-state-free (no editingNotationId/similarityStart) so it can be
 * shared between ChapterDisplay (live, editable view) and ExportTextView
 * (read-only) rather than re-deriving this logic twice and risking the two
 * views drifting out of sync.
 */
export function derivePoetryDisplayMaps(
  poetryNotations: PoetryNotation[],
  words: Word[],
  wordToParaStart: Map<string, string>,
  wordIndexMap: Map<string, number>
): PoetryDisplayMaps {
  // Per-word map of continuation/requiredness (arrow-subtype only) marks, keyed by wordId.
  const poetryWordMarkMap = new Map<string, { continuation?: PoetryNotation; requiredness?: PoetryNotation }>();
  for (const n of poetryNotations) {
    if (n.principle !== "continuation" && n.principle !== "requiredness") continue;
    if (n.principle === "requiredness" && n.subtype === "underline") continue;
    const entry = poetryWordMarkMap.get(n.startWordId) ?? {};
    if (n.principle === "continuation") entry.continuation = n;
    else entry.requiredness = n;
    poetryWordMarkMap.set(n.startWordId, entry);
  }

  // Words covered by a "requiredness — underline" range (inclusive, chapter-wide order).
  const poetryRequirednessUnderlineSet = new Set<string>();
  for (const n of poetryNotations) {
    if (n.principle !== "requiredness" || n.subtype !== "underline" || !n.endWordId) continue;
    if (n.startWordId === n.endWordId) { poetryRequirednessUnderlineSet.add(n.startWordId); continue; }
    const lo = wordIndexMap.get(n.startWordId);
    const hi = wordIndexMap.get(n.endWordId);
    if (lo === undefined || hi === undefined) {
      poetryRequirednessUnderlineSet.add(n.startWordId);
      poetryRequirednessUnderlineSet.add(n.endWordId);
      continue;
    }
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    for (let i = from; i <= to; i++) { const w = words[i]; if (w) poetryRequirednessUnderlineSet.add(w.wordId); }
  }

  // Requiredness-underline ranges anchored on TRANSLATION text, grouped by translation abbreviation.
  const poetryRequirednessUnderlineRangesByAbbr = new Map<string, { book: string; chapter: number; loKey: number; hiKey: number }[]>();
  for (const n of poetryNotations) {
    if (n.principle !== "requiredness" || n.subtype !== "underline" || !n.endWordId) continue;
    const start = parseTvWordId(n.startWordId);
    const end = parseTvWordId(n.endWordId);
    if (!start || !end) continue;
    if (start.abbr !== end.abbr || start.book !== end.book || start.chapter !== end.chapter) continue;
    const key = (v: number, wi: number) => v * 100000 + wi;
    const a = key(start.verse, start.wi);
    const b = key(end.verse, end.wi);
    const [loKey, hiKey] = a <= b ? [a, b] : [b, a];
    const arr = poetryRequirednessUnderlineRangesByAbbr.get(start.abbr) ?? [];
    arr.push({ book: start.book, chapter: start.chapter, loKey, hiKey });
    poetryRequirednessUnderlineRangesByAbbr.set(start.abbr, arr);
  }

  // Words covered by a "closure — weak" range (inclusive, chapter-wide order).
  const poetryClosureWeakSet = new Set<string>();
  for (const n of poetryNotations) {
    if (n.principle !== "closure" || n.subtype !== "weak" || !n.endWordId) continue;
    if (n.startWordId === n.endWordId) { poetryClosureWeakSet.add(n.startWordId); continue; }
    const lo = wordIndexMap.get(n.startWordId);
    const hi = wordIndexMap.get(n.endWordId);
    if (lo === undefined || hi === undefined) {
      poetryClosureWeakSet.add(n.startWordId);
      poetryClosureWeakSet.add(n.endWordId);
      continue;
    }
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    for (let i = from; i <= to; i++) { const w = words[i]; if (w) poetryClosureWeakSet.add(w.wordId); }
  }

  // Last word of every segment marked "closure — complete".
  const segLastWordId = new Map<string, string>();
  {
    let curSeg: string | null = null;
    for (const w of words) {
      const seg = wordToParaStart.get(w.wordId) ?? w.wordId;
      if (seg !== curSeg) curSeg = seg;
      segLastWordId.set(curSeg as string, w.wordId);
    }
  }
  const poetryClosureCompleteSet = new Set<string>();
  for (const n of poetryNotations) {
    if (n.principle !== "closure" || n.subtype !== "complete") continue;
    const lastId = segLastWordId.get(n.startWordId);
    if (lastId) poetryClosureCompleteSet.add(lastId);
  }

  // Closure-weak ranges anchored on TRANSLATION text, grouped by translation abbreviation.
  const poetryClosureWeakRangesByAbbr = new Map<string, { book: string; chapter: number; loKey: number; hiKey: number }[]>();
  for (const n of poetryNotations) {
    if (n.principle !== "closure" || n.subtype !== "weak" || !n.endWordId) continue;
    const start = parseTvWordId(n.startWordId);
    const end = parseTvWordId(n.endWordId);
    if (!start || !end) continue;
    if (start.abbr !== end.abbr || start.book !== end.book || start.chapter !== end.chapter) continue;
    const key = (v: number, wi: number) => v * 100000 + wi;
    const a = key(start.verse, start.wi);
    const b = key(end.verse, end.wi);
    const [loKey, hiKey] = a <= b ? [a, b] : [b, a];
    const arr = poetryClosureWeakRangesByAbbr.get(start.abbr) ?? [];
    arr.push({ book: start.book, chapter: start.chapter, loKey, hiKey });
    poetryClosureWeakRangesByAbbr.set(start.abbr, arr);
  }

  // Raw startWordId of every "closure — complete" mark, source or translation.
  const poetryClosureCompleteStartIds = new Set<string>();
  for (const n of poetryNotations) {
    if (n.principle === "closure" && n.subtype === "complete") poetryClosureCompleteStartIds.add(n.startWordId);
  }

  // Balance/Imbalance and Symmetry — both raw lists now (not grouped by
  // segment): PoetryMarginOverlay resolves every mark's anchor(s) against the
  // full line+gap anchor sequence itself, since either principle can now
  // anchor to a between-lines gap, not just a line.
  const balanceMarks = poetryNotations.filter((n) => n.principle === "balance");
  const symmetryMarks = poetryNotations.filter((n) => n.principle === "symmetry");

  // Similarity — saved marks, resolved to the local grapheme range they cover
  // in each word they touch (a mark's start/end word may be the same word, or
  // two adjacent words in the same line).
  const similarityMarkByWord = new Map<string, { mark: PoetryNotation; startIdx: number; endIdx: number }>();
  for (const n of poetryNotations) {
    if (n.principle !== "similarity" || n.startGraphemeIndex == null) continue;
    if (!n.endWordId || n.startWordId === n.endWordId) {
      similarityMarkByWord.set(n.startWordId, { mark: n, startIdx: n.startGraphemeIndex, endIdx: n.endGraphemeIndex ?? n.startGraphemeIndex });
      continue;
    }
    similarityMarkByWord.set(n.startWordId, { mark: n, startIdx: n.startGraphemeIndex, endIdx: 9999 });
    if (n.endGraphemeIndex != null) {
      similarityMarkByWord.set(n.endWordId, { mark: n, startIdx: 0, endIdx: n.endGraphemeIndex });
    }
  }

  // Similarity "Add word" groups — group by similarityGroupId, ordered by id
  // ascending. poetryNotations is already in insertion (id) order from the
  // API, but sort explicitly since callers shouldn't depend on that.
  const similarityGroupMembers = new Map<number, PoetryNotation[]>();
  for (const n of poetryNotations) {
    if (n.principle !== "similarity" || n.similarityGroupId == null) continue;
    const arr = similarityGroupMembers.get(n.similarityGroupId);
    if (arr) arr.push(n);
    else similarityGroupMembers.set(n.similarityGroupId, [n]);
  }
  for (const members of similarityGroupMembers.values()) members.sort((a, b) => a.id - b.id);

  // Note indicator lookup — every mark with a non-empty note, keyed by the
  // LAST word it touches, for inline display alongside the source/translation
  // text: for a single-word mark that's startWordId itself; for a range
  // (closure — weak, requiredness — underline, a two-word similarity span),
  // endWordId is always the chapter-later of the two (see
  // handleClosureWordClick / handleRequirednessWordClick /
  // handleGraphemeClick's ordering), so the note reads right after the
  // series it covers rather than before it; closure — complete stores
  // startWordId as the line's FIRST word but visibly renders on the line's
  // LAST word, so it resolves through segLastWordId the same way its
  // edit-popover anchor already does. Balance/Symmetry are excluded — their
  // startWordId/endWordId are LINE anchors (not real word-level marks), and
  // their notes already display in the right-side margin overlay via that
  // glyph's own tooltip; including them here would show the same note twice.
  const poetryNoteMap = new Map<string, string>();
  for (const n of poetryNotations) {
    if (!n.note || !n.note.trim()) continue;
    if (n.principle === "balance" || n.principle === "symmetry") continue;
    const anchorWordId =
      n.principle === "closure" && n.subtype === "complete"
        ? segLastWordId.get(n.startWordId) ?? n.startWordId
        : n.endWordId && n.endWordId !== n.startWordId
          ? n.endWordId
          : n.startWordId;
    poetryNoteMap.set(anchorWordId, n.note);
  }

  return {
    poetryWordMarkMap,
    poetryRequirednessUnderlineSet,
    poetryRequirednessUnderlineRangesByAbbr,
    poetryClosureWeakSet,
    segLastWordId,
    poetryClosureCompleteSet,
    poetryClosureWeakRangesByAbbr,
    poetryClosureCompleteStartIds,
    balanceMarks,
    symmetryMarks,
    similarityMarkByWord,
    similarityGroupMembers,
    poetryNoteMap,
  };
}
