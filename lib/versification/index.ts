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
 *
 * Ezekiel was checked (a book sometimes cited for LXX textual variants) and
 * found to need no chapter-level remapping — all 48 chapters have identical
 * verse counts between OSHB and lxx.db, confirmed with text spot-checks at
 * ch1 and ch40 (the temple-vision section, often cited for variants). Any
 * LXX Ezekiel differences that exist are verse/word-level textual variants,
 * not chapter reordering, and are out of scope for this chapter-level module.
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

  // Jeremiah: MT chs 1-24 are identical to LXX (no segment needed — falls
  // through to the default same-chapter fallback). From MT ch25 on, LXX
  // relocates the "oracles against the nations" (MT chs 46-51) to a block
  // right after its own 25:13, in a different internal order, then resumes
  // the MT ch26-44 narrative material shifted +7 chapters, then appends the
  // short Baruch oracle (MT 45) onto the tail of the same LXX chapter as
  // MT 44, before rejoining MT for the historical appendix (MT 52 = LXX 52).
  //
  // Verified chapter-by-chapter against actual Greek text in lxx.db (opening
  // verse content identifies each chapter unambiguously — e.g. LXX 26:2 "τῇ
  // Αἰγύπτῳ ἐπὶ δύναμιν Φαραω Νεχαω..." = MT 46:2's Egypt/Necho oracle) and
  // cross-checked against verse counts: 24 of 28 mapped chapters match
  // exactly; the other 4 have documented explanations (see below).
  Jer: [
    // MT 25:1-13(-14) = LXX 25 (same number). MT 25:15-38, the "cup of
    // wrath" passed to the nations, is relocated to LXX 32 in full — not
    // representable at chapter granularity since LXX 26-31 in between
    // belong to other MT chapters; the parallel view will show LXX 25's
    // truncated 20 verses rather than the cup material.
    [25, 25, 25, 25],
    [26, 26, 33, 33],   // MT 26 (temple sermon, trial) = LXX 33
    [27, 27, 34, 34],   // MT 27 (yoke oracle) = LXX 34
    [28, 28, 35, 35],   // MT 28 (Hananiah the false prophet) = LXX 35
    [29, 29, 36, 36],   // MT 29 (letter to the exiles) = LXX 36
    [30, 31, 37, 38],   // MT 30-31 ("Book of Consolation") = LXX 37-38
    [32, 32, 39, 39],   // MT 32 (Jeremiah buys the field) = LXX 39
    // MT 33 (Davidic/Levitical covenant) = LXX 40. LXX omits MT 33:14-26
    // entirely — a well-documented LXX minus (26v MT vs 13v LXX).
    [33, 33, 40, 40],
    [34, 34, 41, 41],   // MT 34 (release of slaves reneged) = LXX 41
    [35, 35, 42, 42],   // MT 35 (the Rechabites) = LXX 42
    [36, 36, 43, 43],   // MT 36 (Baruch writes/burns the scroll) = LXX 43
    [37, 37, 44, 44],   // MT 37 (Zedekiah's reign, Jeremiah imprisoned) = LXX 44
    [38, 38, 45, 45],   // MT 38 (Jeremiah in the cistern) = LXX 45
    [39, 39, 46, 46],   // MT 39 (fall of Jerusalem) = LXX 46
    [40, 40, 47, 47],   // MT 40 (Jeremiah released, joins Gedaliah) = LXX 47
    [41, 41, 48, 48],   // MT 41 (Ishmael assassinates Gedaliah) = LXX 48
    [42, 42, 49, 49],   // MT 42 (Johanan seeks Jeremiah's guidance) = LXX 49
    [43, 43, 50, 50],   // MT 43 (flight to Egypt) = LXX 50
    // MT 44 (oracle to the Jews in Egypt, 30v) = LXX 51:1-30. MT 45 (the
    // short Baruch oracle, 5v) is appended onto the same LXX chapter as
    // LXX 51:31-35 (verified: LXX 51:31 "ὁ λόγος ὃν ἐλάλησεν Ιερεμιας ...
    // πρὸς Βαρουχ..." = MT 45:1 word-for-word). 30+5=35 matches LXX 51's
    // total exactly. Both MT chapters point at the same LXX chapter — the
    // parallel view will show all of LXX 51 for either.
    [44, 44, 51, 51],
    [45, 45, 51, 51],
    [46, 46, 26, 26],   // MT 46 (oracle against Egypt) = LXX 26
    [47, 47, 29, 29],   // MT 47 (oracle against the Philistines) = LXX 29
    // MT 48 (oracle against Moab, 47v) = LXX 31 (44v) — a small, documented
    // LXX minus within the Moab oracle.
    [48, 48, 31, 31],
    // MT 49:1-33 (Ammon, Edom, Damascus, Kedar/Hazor — 33v) = LXX 30 (33v,
    // exact match). MT 49:34-39 (Elam, 6v) is relocated separately to
    // LXX 25:14-20, right after the ch25 introduction — not representable
    // at chapter granularity; the parallel view for MT 49 will show LXX 30's
    // Ammon/Edom/Damascus/Kedar content, not the Elam portion.
    [49, 49, 30, 30],
    [50, 51, 27, 28],   // MT 50-51 (oracle against Babylon) = LXX 27-28
    // MT 52 (historical appendix) = LXX 52, identical numbering — no
    // segment needed, falls through to the default same-chapter fallback.
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
