/**
 * MT → KJV/Protestant verse mapping.
 *
 * ULT and VCB both follow KJV-style versification, which differs from MT in:
 *  - Jonah:   chapter 2 boundary (MT 2:1 = KJV 1:17; MT 2:2-11 = KJV 2:1-10)
 *  - Joel:    chapters 3-4 (MT 3:1-5 = KJV 2:28-32; MT 4:1-21 = KJV 3:1-21)
 *  - Mal:     chapter 3 tail (MT 3:19-24 = KJV 4:1-6)
 *  - Ps:      superscription verses (MT counts heading as v1; KJV/ULT does not)
 *             → 58 chapters with offset 1, 4 chapters with offset 2
 *             (verified against actual data in source.db / ult.db)
 *
 * Usage: call getMtToKjvInstructions(book, mtChapter).
 * If it returns null, a direct `WHERE book=? AND chapter=?` query is correct.
 * Otherwise, execute one query per instruction and remap verse numbers via
 *   mt_verse = kjv_verse + instruction.mtVerseOffset
 */

export interface KjvFetchInstruction {
  kjvChapter: number;
  kjvVerseStart: number;
  /** Inclusive upper bound; use 999 for "all remaining verses". */
  kjvVerseEnd: number;
  /** Add this to the KJV verse number to obtain the MT verse number. */
  mtVerseOffset: number;
}

// ── Psalm superscription offsets ──────────────────────────────────────────────
// Verified by comparing MAX(verse) per chapter between OSHB (source.db) and
// ULT (ult.db).  VCB has identical verse counts to ULT for all Psalms.

/** Psalms where ULT/VCB verse 1 = MT verse 2 (one superscription verse in MT). */
const PS_OFFSET_1 = new Set<number>([
  3, 4, 5, 6, 7, 8, 9, 12, 18, 19, 20, 21, 22, 30, 31, 34, 36, 38, 39, 40,
  41, 42, 44, 45, 46, 47, 48, 49, 53, 55, 56, 57, 58, 59, 61, 62, 63, 64, 65,
  67, 68, 69, 70, 75, 76, 77, 80, 81, 83, 84, 85, 88, 89, 92, 102, 108, 140, 142,
]);

/** Psalms where ULT/VCB verse 1 = MT verse 3 (two superscription verses in MT). */
const PS_OFFSET_2 = new Set<number>([51, 52, 54, 60]);

// ── Cross-chapter mappings for Jonah / Joel / Malachi ─────────────────────────

const MT_KJV_INSTRUCTIONS: Readonly<
  Record<string, Readonly<Record<number, KjvFetchInstruction[]>>>
> = {
  Jonah: {
    // MT Jonah 1 has 16 verses; KJV/ULT Jonah 1 has 17 (v17 = fish = MT 2:1).
    // We limit to vv1-16 so that the fish verse is never double-counted here.
    1: [
      { kjvChapter: 1, kjvVerseStart: 1, kjvVerseEnd: 16, mtVerseOffset: 0 },
    ],
    // MT Jonah 2:1  = KJV/ULT Jonah 1:17  (1:17 + −16 = 2:1)
    // MT Jonah 2:2-11 = KJV/ULT Jonah 2:1-10 (2:N + 1 = MT 2:(N+1))
    2: [
      { kjvChapter: 1, kjvVerseStart: 17, kjvVerseEnd: 17, mtVerseOffset: -16 },
      { kjvChapter: 2, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1  },
    ],
  },
  Joel: {
    // MT Joel 3:1-5  = KJV/ULT Joel 2:28-32  (2:N + −27 = MT 3:(N−27))
    3: [
      { kjvChapter: 2, kjvVerseStart: 28, kjvVerseEnd: 32, mtVerseOffset: -27 },
    ],
    // MT Joel 4:1-21 = KJV/ULT Joel 3:1-21   (direct, no offset)
    4: [
      { kjvChapter: 3, kjvVerseStart: 1, kjvVerseEnd: 999, mtVerseOffset: 0 },
    ],
  },
  Mal: {
    // MT Mal 3:1-18  = KJV/ULT Mal 3:1-18    (same)
    // MT Mal 3:19-24 = KJV/ULT Mal 4:1-6     (4:N + 18 = MT 3:(N+18))
    3: [
      { kjvChapter: 3, kjvVerseStart: 1,  kjvVerseEnd: 18, mtVerseOffset: 0  },
      { kjvChapter: 4, kjvVerseStart: 1,  kjvVerseEnd: 6,  mtVerseOffset: 18 },
    ],
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the fetch instructions needed to retrieve ULT/VCB verses for a given
 * MT (OSHB) book + chapter, remapped so that the returned verse numbers match
 * MT verse numbers.
 *
 * Returns null when no remapping is required (a plain
 * `WHERE book=? AND chapter=?` query with unmodified verse numbers is correct).
 */
export function getMtToKjvInstructions(
  book: string,
  mtChapter: number,
): KjvFetchInstruction[] | null {
  // Jonah / Joel / Malachi — cross-chapter remapping
  const bookMap = MT_KJV_INSTRUCTIONS[book];
  if (bookMap) {
    const instrs = bookMap[mtChapter];
    if (instrs) return instrs;
  }

  // Psalms — superscription verse offset
  if (book === "Ps") {
    if (PS_OFFSET_2.has(mtChapter)) {
      return [{ kjvChapter: mtChapter, kjvVerseStart: 1, kjvVerseEnd: 999, mtVerseOffset: 2 }];
    }
    if (PS_OFFSET_1.has(mtChapter)) {
      return [{ kjvChapter: mtChapter, kjvVerseStart: 1, kjvVerseEnd: 999, mtVerseOffset: 1 }];
    }
  }

  return null; // no remapping needed
}
