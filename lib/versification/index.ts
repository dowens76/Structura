/**
 * Versification mapping for Structura.
 *
 * Maps between MT (OSHB/Hebrew) chapter numbering and LXX (Septuagint) chapter
 * numbering, using MT as the canonical pivot.
 *
 * Segment format: [mtChStart, mtChEnd, lxxChStart, lxxChEnd]
 *
 * Three kinds of segments:
 *   1:1 block — same count each side, chapters mapped proportionally by offset
 *   Merge (N:1) — multiple MT chapters → one LXX chapter (e.g. MT Ps 9+10 = LXX Ps 9)
 *   Split (1:N) — one MT chapter → multiple LXX chapters (e.g. MT Ps 116 = LXX Ps 114+115)
 */

type Seg = readonly [number, number, number, number]; // [mtS, mtE, lxxS, lxxE]

/**
 * Known MT ↔ LXX chapter-range differences.
 * Only books that have differences are listed; all other books are treated as 1:1.
 *
 * Verified against actual word data in source.db (OSHB) and lxx.db (STEPBIBLE_LXX).
 * Verse counts match: MT Ps 9(21v)+10(18v)=39 = LXX Ps 9(39v); etc.
 */
const MT_LXX_SEGS: Readonly<Record<string, ReadonlyArray<Seg>>> = {
  Ps: [
    [1,   8,   1,   8  ],  // 1:1 identical
    [9,   10,  9,   9  ],  // 2:1 merge   — MT 9+10 = LXX 9
    [11,  113, 10,  112],  // 1:1 offset −1
    [114, 115, 113, 113],  // 2:1 merge   — MT 114+115 = LXX 113
    [116, 116, 114, 115],  // 1:2 split   — MT 116 = LXX 114+115
    [117, 146, 116, 145],  // 1:1 offset −1
    [147, 147, 146, 147],  // 1:2 split   — MT 147 = LXX 146+147
    [148, 150, 148, 150],  // 1:1 identical
    // LXX Ps 151 (7 verses) has no MT equivalent — handled via LXX_ONLY_CHAPTERS
  ],
};

/** LXX chapters that have no MT equivalent, keyed by OSIS book code. */
export const LXX_ONLY_CHAPTERS: Readonly<Record<string, ReadonlyArray<number>>> = {
  Ps: [151],
};

// ── Low-level segment lookup ──────────────────────────────────────────────────

function findMtSeg(osisBook: string, mtCh: number): Seg | null {
  const segs = MT_LXX_SEGS[osisBook];
  if (!segs) return null;
  for (const s of segs) {
    if (mtCh >= s[0] && mtCh <= s[1]) return s;
  }
  return null;
}

function findLxxSeg(osisBook: string, lxxCh: number): Seg | null {
  const segs = MT_LXX_SEGS[osisBook];
  if (!segs) return null;
  for (const s of segs) {
    if (lxxCh >= s[2] && lxxCh <= s[3]) return s;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Given an MT chapter, return the set of MT chapters and LXX chapters that
 * form one parallel display unit.
 *
 * For 1:1 blocks each MT chapter is its own unit.
 * For merge/split blocks the whole block is one unit.
 *
 * Returns null when the book has no versification differences (most books).
 */
export function getParallelGroup(
  osisBook: string,
  mtCh: number
): { mtChapters: number[]; lxxChapters: number[] } | null {
  const seg = findMtSeg(osisBook, mtCh);
  if (!seg) return null;

  const [ms, me, ls, le] = seg;
  const mtCount  = me - ms + 1;
  const lxxCount = le - ls + 1;

  if (mtCount === lxxCount) {
    // 1:1: this single chapter is its own unit
    const offset = mtCh - ms;
    return {
      mtChapters:  [mtCh],
      lxxChapters: [ls + offset],
    };
  }
  // Merge or split: whole segment is one display unit
  return {
    mtChapters:  Array.from({ length: mtCount  }, (_, i) => ms + i),
    lxxChapters: Array.from({ length: lxxCount }, (_, i) => ls + i),
  };
}

/**
 * Given an LXX chapter, return the corresponding MT chapter range.
 * Returns null for LXX-only chapters (e.g. Ps 151).
 */
export function getLxxGroup(
  osisBook: string,
  lxxCh: number
): { mtChapters: number[]; lxxChapters: number[] } | null {
  const seg = findLxxSeg(osisBook, lxxCh);
  if (!seg) return null; // LXX-only

  const [ms, me, ls, le] = seg;
  const mtCount  = me - ms + 1;
  const lxxCount = le - ls + 1;

  if (mtCount === lxxCount) {
    const offset = lxxCh - ls;
    return {
      mtChapters:  [ms + offset],
      lxxChapters: [lxxCh],
    };
  }
  return {
    mtChapters:  Array.from({ length: mtCount  }, (_, i) => ms + i),
    lxxChapters: Array.from({ length: lxxCount }, (_, i) => ls + i),
  };
}

/**
 * Return the canonical (first/entry) MT chapter for the group that contains
 * the given MT chapter.  For non-mapped books returns the chapter unchanged.
 */
export function canonicalizeMtChapter(osisBook: string, mtCh: number): number {
  const group = getParallelGroup(osisBook, mtCh);
  return group ? group.mtChapters[0] : mtCh;
}

/**
 * Is the given MT chapter the canonical entry point for its parallel group?
 * Non-canonical chapters are those consumed within a merge block (e.g. MT Ps 10).
 */
export function isCanonicalMtChapter(osisBook: string, mtCh: number): boolean {
  return canonicalizeMtChapter(osisBook, mtCh) === mtCh;
}

/**
 * Return the MT chapter to navigate to AFTER the current one in parallel mode.
 * For merge blocks, skips all consumed chapters and returns the first chapter
 * of the next group.
 */
export function nextParallelMtChapter(osisBook: string, mtCh: number): number {
  const seg = findMtSeg(osisBook, mtCh);
  if (!seg) return mtCh + 1;

  const [ms, me, , ] = seg;
  const mtCount  = me - ms + 1;
  const lxxCount = seg[3] - seg[2] + 1;

  if (mtCount === lxxCount) {
    // 1:1 block: simply advance one, but canonicalize in case next chapter is
    // the non-canonical tail of a merge block (shouldn't happen but be safe).
    return canonicalizeMtChapter(osisBook, mtCh + 1);
  }
  // Merge (advance past all consumed MT chapters) or split (single MT chapter):
  return me + 1;
}

/**
 * Return the MT chapter to navigate to BEFORE the current one in parallel mode.
 * For merge blocks, returns the canonical start of the preceding group.
 */
export function prevParallelMtChapter(osisBook: string, mtCh: number): number {
  const seg = findMtSeg(osisBook, mtCh);
  if (!seg) {
    return canonicalizeMtChapter(osisBook, mtCh - 1);
  }

  const [ms, , ,] = seg;
  const mtCount  = seg[1] - seg[0] + 1;
  const lxxCount = seg[3] - seg[2] + 1;

  if (mtCount === lxxCount) {
    // 1:1: go to previous chapter, canonicalized
    return canonicalizeMtChapter(osisBook, mtCh - 1);
  }
  // Merge or split: go to the chapter before the whole block, canonicalized
  return canonicalizeMtChapter(osisBook, ms - 1);
}

/**
 * Does the given book have any MT↔LXX versification differences?
 */
export function hasVersificationDifference(osisBook: string): boolean {
  return osisBook in MT_LXX_SEGS;
}
