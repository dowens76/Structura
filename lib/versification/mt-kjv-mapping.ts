/**
 * MT → KJV/Protestant verse mapping.
 *
 * ULT and VCB both follow KJV-style versification, which differs from MT in
 * dozens of OT books (see the SBL Handbook of Style versification table).
 * Every entry below was derived from — and cross-checked against — the
 * actual MAX(verse) per chapter in source.db (OSHB/MT) vs ult.db (KJV-style
 * English), plus spot-checks of real verse text at each boundary (e.g. Num
 * 16:36 ULT and Num 17:1 ULT are both "And Yahweh spoke to Moses, saying,"
 * confirming that's genuinely where MT chapter 17 begins). VCB has identical
 * verse counts to ULT everywhere checked, so one table serves both.
 *
 * Covered so far (all cross-chapter or same-chapter boundary shifts that are
 * clean, monotonic renumbering — NOT the books/chapters below that involve
 * non-monotonic verse *reordering*, which this range+offset model cannot
 * represent and which are intentionally left unmapped for now):
 *  - Jonah, Joel, Mal, Ps — as before.
 *  - Exod 7/8, 21/22; Lev 5/6; Num 16/17, 29/30; Deut 12/13, 22/23, 28/29;
 *    1Sam 21 (partial — see note below), 23/24; 2Sam 18/19; 2Kgs 11/12;
 *    1Chr 5/6, 12 (same-chapter merge); 2Chr 1/2, 13/14; Neh 3/4, 9/10;
 *    Job 40/41; Eccl 4/5; Song 6/7; Isa 8/9, 63/64 (partial); Jer 8/9;
 *    Ezek 20/21; Dan 3/4, 5/6; Hos 1/2, 11/12, 13/14; Mic 4/5; Nah 1/2;
 *    Zech 1/2.
 *
 * Explicitly NOT covered (non-monotonic reorders or multi-chapter
 * restructuring — a per-verse lookup table would be needed, not a range/
 * offset instruction): Gen 31/32/35; Exod 20:13-15, chs 35-40; Num 1, 6,
 * 25/26; Josh (verified no actual MT/KJV difference in the data despite the
 * SBL note — likely an LXX-placement issue, not English/Hebrew); 1 Kings
 * (extensive, includes mid-verse clause splits not representable at
 * verse-level at all); Proverbs 15-16, 20, 24-31; Jer 25-52 (large-scale
 * chapter reassignment, needs its own dedicated table).
 *
 * A couple of entries are deliberately *partial*: 1Sam 21 v1 and Isa 64 v2
 * have no clean single English verse counterpart (their content is fused
 * into the tail of the previous English verse — e.g. ULT 1Sam 20:42 reads as
 * one sentence but contains what MT numbers as 21:1). Rather than showing
 * wrong content, those specific MT verses simply have no instruction match
 * and return nothing — the same tradeoff already used by PS_OFFSET_2 (MT
 * verse 2 of those Psalms is likewise left unmapped).
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
  3, 4, 5, 6, 7, 8, 9, 12, 13, 18, 19, 20, 21, 22, 30, 31, 34, 36, 38, 39, 40,
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

  // ── Pentateuch ───────────────────────────────────────────────────────────
  Exod: {
    // MT Exod 7:1-25 = KJV 7:1-25 (direct); MT 7:26-29 = KJV 8:1-4
    7: [
      { kjvChapter: 7, kjvVerseStart: 1, kjvVerseEnd: 25, mtVerseOffset: 0 },
      { kjvChapter: 8, kjvVerseStart: 1, kjvVerseEnd: 4,  mtVerseOffset: 25 },
    ],
    // MT Exod 8:1-28 = KJV 8:5-32
    8: [
      { kjvChapter: 8, kjvVerseStart: 5, kjvVerseEnd: 999, mtVerseOffset: -4 },
    ],
    // MT Exod 21:1-36 = KJV 21:1-36 (direct); MT 21:37 = KJV 22:1
    21: [
      { kjvChapter: 21, kjvVerseStart: 1, kjvVerseEnd: 36, mtVerseOffset: 0 },
      { kjvChapter: 22, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 36 },
    ],
    // MT Exod 22:1-30 = KJV 22:2-31
    22: [
      { kjvChapter: 22, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Lev: {
    // MT Lev 5:1-19 = KJV 5:1-19 (direct); MT 5:20-26 = KJV 6:1-7
    5: [
      { kjvChapter: 5, kjvVerseStart: 1, kjvVerseEnd: 19, mtVerseOffset: 0 },
      { kjvChapter: 6, kjvVerseStart: 1, kjvVerseEnd: 7,  mtVerseOffset: 19 },
    ],
    // MT Lev 6:1-23 = KJV 6:8-30
    6: [
      { kjvChapter: 6, kjvVerseStart: 8, kjvVerseEnd: 999, mtVerseOffset: -7 },
    ],
  },
  Num: {
    // MT Num 16:1-35 = KJV 16:1-35 (direct — KJV 16:36-50 belongs to MT 17)
    16: [
      { kjvChapter: 16, kjvVerseStart: 1, kjvVerseEnd: 35, mtVerseOffset: 0 },
    ],
    // MT Num 17:1-15 = KJV 16:36-50; MT 17:16-28 = KJV 17:1-13
    // (verified: ULT Num 16:36 and 17:1 are both "And Yahweh spoke to Moses, saying,")
    17: [
      { kjvChapter: 16, kjvVerseStart: 36, kjvVerseEnd: 50,  mtVerseOffset: -35 },
      { kjvChapter: 17, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 15  },
    ],
    // MT Num 29:1-39 = KJV 29:1-39 (direct — KJV 29:40 belongs to MT 30)
    29: [
      { kjvChapter: 29, kjvVerseStart: 1, kjvVerseEnd: 39, mtVerseOffset: 0 },
    ],
    // MT Num 30:1 = KJV 29:40; MT 30:2-17 = KJV 30:1-16
    30: [
      { kjvChapter: 29, kjvVerseStart: 40, kjvVerseEnd: 40,  mtVerseOffset: -39 },
      { kjvChapter: 30, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  Deut: {
    // MT Deut 12:1-31 = KJV 12:1-31 (direct); MT 13:1 = KJV 12:32
    12: [
      { kjvChapter: 12, kjvVerseStart: 1, kjvVerseEnd: 31, mtVerseOffset: 0 },
    ],
    // MT Deut 13:1 = KJV 12:32; MT 13:2-19 = KJV 13:1-18
    13: [
      { kjvChapter: 12, kjvVerseStart: 32, kjvVerseEnd: 32,  mtVerseOffset: -31 },
      { kjvChapter: 13, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
    // MT Deut 22:1-29 = KJV 22:1-29 (direct); MT 23:1 = KJV 22:30
    22: [
      { kjvChapter: 22, kjvVerseStart: 1, kjvVerseEnd: 29, mtVerseOffset: 0 },
    ],
    // MT Deut 23:1 = KJV 22:30; MT 23:2-26 = KJV 23:1-25
    23: [
      { kjvChapter: 22, kjvVerseStart: 30, kjvVerseEnd: 30,  mtVerseOffset: -29 },
      { kjvChapter: 23, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
    // MT Deut 28:1-68 = KJV 28:1-68 (direct); MT 28:69 = KJV 29:1
    28: [
      { kjvChapter: 28, kjvVerseStart: 1, kjvVerseEnd: 68, mtVerseOffset: 0 },
      { kjvChapter: 29, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 68 },
    ],
    // MT Deut 29:1-28 = KJV 29:2-29
    29: [
      { kjvChapter: 29, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },

  // ── Historical books ─────────────────────────────────────────────────────
  "1Sam": {
    // MT 1Sam 20:1-42 = KJV 20:1-42 (direct). ULT's v42 fuses MT 20:42 with
    // MT 21:1's content into one sentence, so no explicit instruction is
    // needed here — the default direct query is the best available match.
    //
    // MT 1Sam 21:2-16 = KJV 21:1-15. MT 21:1 has no separate KJV verse (its
    // content is fused into the tail of KJV 20:42 above) — intentionally
    // left unmapped, same tradeoff as PS_OFFSET_2's MT-verse-2 gap.
    21: [
      { kjvChapter: 21, kjvVerseStart: 1, kjvVerseEnd: 15, mtVerseOffset: 1 },
    ],
    // MT 1Sam 23:1-28 = KJV 23:1-28 (direct); MT 24:1 = KJV 23:29
    23: [
      { kjvChapter: 23, kjvVerseStart: 1, kjvVerseEnd: 28, mtVerseOffset: 0 },
    ],
    // MT 1Sam 24:1 = KJV 23:29; MT 24:2-23 = KJV 24:1-22
    24: [
      { kjvChapter: 23, kjvVerseStart: 29, kjvVerseEnd: 29,  mtVerseOffset: -28 },
      { kjvChapter: 24, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  "2Sam": {
    // MT 2Sam 18:1-32 = KJV 18:1-32 (direct); MT 19:1 = KJV 18:33
    18: [
      { kjvChapter: 18, kjvVerseStart: 1, kjvVerseEnd: 32, mtVerseOffset: 0 },
    ],
    // MT 2Sam 19:1 = KJV 18:33; MT 19:2-44 = KJV 19:1-43
    19: [
      { kjvChapter: 18, kjvVerseStart: 33, kjvVerseEnd: 33,  mtVerseOffset: -32 },
      { kjvChapter: 19, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  "2Kgs": {
    // MT 2Kgs 11:1-20 = KJV 11:1-20 (direct); MT 12:1 = KJV 11:21
    11: [
      { kjvChapter: 11, kjvVerseStart: 1, kjvVerseEnd: 20, mtVerseOffset: 0 },
    ],
    // MT 2Kgs 12:1 = KJV 11:21; MT 12:2-22 = KJV 12:1-21
    12: [
      { kjvChapter: 11, kjvVerseStart: 21, kjvVerseEnd: 21,  mtVerseOffset: -20 },
      { kjvChapter: 12, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  "1Chr": {
    // MT 1Chr 5:1-26 = KJV 5:1-26 (direct); MT 5:27-41 = KJV 6:1-15
    5: [
      { kjvChapter: 5, kjvVerseStart: 1, kjvVerseEnd: 26, mtVerseOffset: 0 },
      { kjvChapter: 6, kjvVerseStart: 1, kjvVerseEnd: 15, mtVerseOffset: 26 },
    ],
    // MT 1Chr 6:1-66 = KJV 6:16-81. Ch 12 (below) is a separate, same-chapter case.
    6: [
      { kjvChapter: 6, kjvVerseStart: 16, kjvVerseEnd: 999, mtVerseOffset: -15 },
    ],
    // MT 1Chr 12:1-3 = KJV 12:1-3 (direct); MT 12:4-5 fuse into KJV 12:4
    // (name-list verse boundary — same combined-verse pattern as PS_OFFSET_2);
    // MT 12:6-41 = KJV 12:5-40. MT verse 5 is intentionally left unmapped.
    12: [
      { kjvChapter: 12, kjvVerseStart: 1, kjvVerseEnd: 3,   mtVerseOffset: 0 },
      { kjvChapter: 12, kjvVerseStart: 4, kjvVerseEnd: 4,   mtVerseOffset: 0 },
      { kjvChapter: 12, kjvVerseStart: 5, kjvVerseEnd: 999, mtVerseOffset: 1 },
    ],
  },
  "2Chr": {
    // MT 2Chr 1:1-17 = KJV 1:1-17 (direct); MT 1:18 = KJV 2:1
    1: [
      { kjvChapter: 1, kjvVerseStart: 1, kjvVerseEnd: 17, mtVerseOffset: 0 },
      { kjvChapter: 2, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 17 },
    ],
    // MT 2Chr 2:1-17 = KJV 2:2-18
    2: [
      { kjvChapter: 2, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
    // MT 2Chr 13:1-22 = KJV 13:1-22 (direct); MT 13:23 = KJV 14:1
    13: [
      { kjvChapter: 13, kjvVerseStart: 1, kjvVerseEnd: 22, mtVerseOffset: 0 },
      { kjvChapter: 14, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 22 },
    ],
    // MT 2Chr 14:1-14 = KJV 14:2-15
    14: [
      { kjvChapter: 14, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Neh: {
    // MT Neh 3:1-32 = KJV 3:1-32 (direct); MT 3:33-38 = KJV 4:1-6
    3: [
      { kjvChapter: 3, kjvVerseStart: 1, kjvVerseEnd: 32, mtVerseOffset: 0 },
      { kjvChapter: 4, kjvVerseStart: 1, kjvVerseEnd: 6,  mtVerseOffset: 32 },
    ],
    // MT Neh 4:1-17 = KJV 4:7-23
    4: [
      { kjvChapter: 4, kjvVerseStart: 7, kjvVerseEnd: 999, mtVerseOffset: -6 },
    ],
    // MT Neh 9:1-37 = KJV 9:1-37 (direct); MT 10:1 = KJV 9:38
    9: [
      { kjvChapter: 9, kjvVerseStart: 1, kjvVerseEnd: 37, mtVerseOffset: 0 },
    ],
    // MT Neh 10:1 = KJV 9:38; MT 10:2-40 = KJV 10:1-39
    10: [
      { kjvChapter: 9,  kjvVerseStart: 38, kjvVerseEnd: 38,  mtVerseOffset: -37 },
      { kjvChapter: 10, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },

  // ── Wisdom / poetic books ────────────────────────────────────────────────
  Job: {
    // MT Job 40:1-24 = KJV 40:1-24 (direct); MT 40:25-32 = KJV 41:1-8
    40: [
      { kjvChapter: 40, kjvVerseStart: 1, kjvVerseEnd: 24, mtVerseOffset: 0 },
      { kjvChapter: 41, kjvVerseStart: 1, kjvVerseEnd: 8,  mtVerseOffset: 24 },
    ],
    // MT Job 41:1-26 = KJV 41:9-34
    41: [
      { kjvChapter: 41, kjvVerseStart: 9, kjvVerseEnd: 999, mtVerseOffset: -8 },
    ],
  },
  Eccl: {
    // MT Eccl 4:1-16 = KJV 4:1-16 (direct); MT 4:17 = KJV 5:1
    4: [
      { kjvChapter: 4, kjvVerseStart: 1, kjvVerseEnd: 16, mtVerseOffset: 0 },
      { kjvChapter: 5, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 16 },
    ],
    // MT Eccl 5:1-19 = KJV 5:2-20
    5: [
      { kjvChapter: 5, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Song: {
    // MT Song 6:1-12 = KJV 6:1-12 (direct); MT 7:1 = KJV 6:13
    6: [
      { kjvChapter: 6, kjvVerseStart: 1, kjvVerseEnd: 12, mtVerseOffset: 0 },
    ],
    // MT Song 7:1 = KJV 6:13; MT 7:2-14 = KJV 7:1-13
    7: [
      { kjvChapter: 6, kjvVerseStart: 13, kjvVerseEnd: 13,  mtVerseOffset: -12 },
      { kjvChapter: 7, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },

  // ── Prophets ─────────────────────────────────────────────────────────────
  Isa: {
    // MT Isa 8:1-22 = KJV 8:1-22 (direct); MT 8:23 = KJV 9:1
    8: [
      { kjvChapter: 8, kjvVerseStart: 1, kjvVerseEnd: 22, mtVerseOffset: 0 },
      { kjvChapter: 9, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 22 },
    ],
    // MT Isa 9:1-20 = KJV 9:2-21
    9: [
      { kjvChapter: 9, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
    // MT Isa 63 = KJV 63 (direct, no instruction needed — verified identical
    // counts). MT Isa 64:1 = KJV 64:1 (offset 0); ULT further splits MT 64:1's
    // content into an extra KJV 64:2, which has no separate MT verse and is
    // intentionally left unmapped; MT 64:2-11 = KJV 64:3-12.
    64: [
      { kjvChapter: 64, kjvVerseStart: 1, kjvVerseEnd: 1,   mtVerseOffset: 0  },
      { kjvChapter: 64, kjvVerseStart: 3, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Jer: {
    // MT Jer 8:1-22 = KJV 8:1-22 (direct); MT 8:23 = KJV 9:1
    // (chs 25-52's large-scale restructuring is NOT covered here — see file header)
    8: [
      { kjvChapter: 8, kjvVerseStart: 1, kjvVerseEnd: 22, mtVerseOffset: 0 },
      { kjvChapter: 9, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 22 },
    ],
    // MT Jer 9:1-25 = KJV 9:2-26
    9: [
      { kjvChapter: 9, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Ezek: {
    // MT Ezek 20:1-44 = KJV 20:1-44 (direct); MT 21:1-5 = KJV 20:45-49
    20: [
      { kjvChapter: 20, kjvVerseStart: 1, kjvVerseEnd: 44, mtVerseOffset: 0 },
    ],
    // MT Ezek 21:1-5 = KJV 20:45-49; MT 21:6-37 = KJV 21:1-32
    21: [
      { kjvChapter: 20, kjvVerseStart: 45, kjvVerseEnd: 49,  mtVerseOffset: -44 },
      { kjvChapter: 21, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 5   },
    ],
  },
  Dan: {
    // MT Dan 3:1-30 = KJV 3:1-30 (direct); MT 3:31-33 = KJV 4:1-3
    3: [
      { kjvChapter: 3, kjvVerseStart: 1, kjvVerseEnd: 30, mtVerseOffset: 0 },
      { kjvChapter: 4, kjvVerseStart: 1, kjvVerseEnd: 3,  mtVerseOffset: 30 },
    ],
    // MT Dan 4:1-34 = KJV 4:4-37
    4: [
      { kjvChapter: 4, kjvVerseStart: 4, kjvVerseEnd: 999, mtVerseOffset: -3 },
    ],
    // MT Dan 5:1-30 = KJV 5:1-30 (direct); MT 6:1 = KJV 5:31
    5: [
      { kjvChapter: 5, kjvVerseStart: 1, kjvVerseEnd: 30, mtVerseOffset: 0 },
    ],
    // MT Dan 6:1 = KJV 5:31; MT 6:2-29 = KJV 6:1-28
    6: [
      { kjvChapter: 5, kjvVerseStart: 31, kjvVerseEnd: 31,  mtVerseOffset: -30 },
      { kjvChapter: 6, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  Hos: {
    // MT Hos 1:1-9 = KJV 1:1-9 (direct); MT 2:1-2 = KJV 1:10-11
    1: [
      { kjvChapter: 1, kjvVerseStart: 1, kjvVerseEnd: 9, mtVerseOffset: 0 },
    ],
    // MT Hos 2:1-2 = KJV 1:10-11; MT 2:3-25 = KJV 2:1-23
    2: [
      { kjvChapter: 1, kjvVerseStart: 10, kjvVerseEnd: 11,  mtVerseOffset: -9 },
      { kjvChapter: 2, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 2  },
    ],
    // MT Hos 11:1-11 = KJV 11:1-11 (direct); MT 12:1 = KJV 11:12
    11: [
      { kjvChapter: 11, kjvVerseStart: 1, kjvVerseEnd: 11, mtVerseOffset: 0 },
    ],
    // MT Hos 12:1 = KJV 11:12; MT 12:2-15 = KJV 12:1-14
    12: [
      { kjvChapter: 11, kjvVerseStart: 12, kjvVerseEnd: 12,  mtVerseOffset: -11 },
      { kjvChapter: 12, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
    // MT Hos 13:1-15 = KJV 13:1-15 (direct); MT 14:1 = KJV 13:16
    13: [
      { kjvChapter: 13, kjvVerseStart: 1, kjvVerseEnd: 15, mtVerseOffset: 0 },
    ],
    // MT Hos 14:1 = KJV 13:16; MT 14:2-10 = KJV 14:1-9
    14: [
      { kjvChapter: 13, kjvVerseStart: 16, kjvVerseEnd: 16,  mtVerseOffset: -15 },
      { kjvChapter: 14, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  Mic: {
    // MT Mic 4:1-13 = KJV 4:1-13 (direct); MT 4:14 = KJV 5:1
    4: [
      { kjvChapter: 4, kjvVerseStart: 1, kjvVerseEnd: 13, mtVerseOffset: 0 },
      { kjvChapter: 5, kjvVerseStart: 1, kjvVerseEnd: 1,  mtVerseOffset: 13 },
    ],
    // MT Mic 5:1-14 = KJV 5:2-15
    5: [
      { kjvChapter: 5, kjvVerseStart: 2, kjvVerseEnd: 999, mtVerseOffset: -1 },
    ],
  },
  Nah: {
    // MT Nah 1:1-14 = KJV 1:1-14 (direct); MT 2:1 = KJV 1:15
    1: [
      { kjvChapter: 1, kjvVerseStart: 1, kjvVerseEnd: 14, mtVerseOffset: 0 },
    ],
    // MT Nah 2:1 = KJV 1:15; MT 2:2-14 = KJV 2:1-13
    2: [
      { kjvChapter: 1, kjvVerseStart: 15, kjvVerseEnd: 15,  mtVerseOffset: -14 },
      { kjvChapter: 2, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 1   },
    ],
  },
  Zech: {
    // MT Zech 1:1-17 = KJV 1:1-17 (direct); MT 2:1-4 = KJV 1:18-21
    1: [
      { kjvChapter: 1, kjvVerseStart: 1, kjvVerseEnd: 17, mtVerseOffset: 0 },
    ],
    // MT Zech 2:1-4 = KJV 1:18-21; MT 2:5-17 = KJV 2:1-13
    2: [
      { kjvChapter: 1, kjvVerseStart: 18, kjvVerseEnd: 21,  mtVerseOffset: -17 },
      { kjvChapter: 2, kjvVerseStart: 1,  kjvVerseEnd: 999, mtVerseOffset: 4   },
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
  // ULT/VCB store Psalm descriptive titles as verse 0 (kjvVerseStart: 0).
  // PS_OFFSET_1: one superscription verse in MT → verse 0 + offset 1 = MT verse 1.
  // PS_OFFSET_2: two superscription verses in MT → verse 0 maps to MT verse 1
  //              (combined text); content verses shift by 2.
  if (book === "Ps") {
    if (PS_OFFSET_2.has(mtChapter)) {
      return [
        { kjvChapter: mtChapter, kjvVerseStart: 0, kjvVerseEnd: 0,   mtVerseOffset: 1 },
        { kjvChapter: mtChapter, kjvVerseStart: 1, kjvVerseEnd: 999, mtVerseOffset: 2 },
      ];
    }
    if (PS_OFFSET_1.has(mtChapter)) {
      return [{ kjvChapter: mtChapter, kjvVerseStart: 0, kjvVerseEnd: 999, mtVerseOffset: 1 }];
    }
  }

  return null; // no remapping needed
}

/**
 * Returns the KJV display label for a given MT verse in a chapter that has
 * cross-chapter remapping (Jonah ch2, Joel ch3-4, Malachi ch3 tail).
 *
 * Returns a string like "1:17" when the KJV reference differs from the MT
 * reference, so the UI can show e.g. "[1:17]" next to MT Jonah 2:1.
 * Returns null when:
 *  - No cross-chapter remap applies to this book+chapter, OR
 *  - The KJV chapter:verse for this MT verse is identical to the MT chapter:verse
 *    (i.e. no label is needed), OR
 *  - The verse falls outside all known instruction ranges.
 *
 * NOTE: Psalm superscription offsets are same-chapter and are intentionally
 * excluded — those use the simpler `translationVerseOffset` integer mechanism.
 */
export function getKjvVerseLabel(
  book: string,
  mtChapter: number,
  mtVerse: number,
): string | null {
  const instrs = getMtToKjvInstructions(book, mtChapter);
  if (!instrs) return null;

  // Only applies to cross-chapter remap (Jonah/Joel/Malachi), not Psalm offsets.
  const hasCrossChapter = instrs.some((i) => i.kjvChapter !== mtChapter);
  if (!hasCrossChapter) return null;

  for (const instr of instrs) {
    const kjvVerse = mtVerse - instr.mtVerseOffset;
    const verseEnd = instr.kjvVerseEnd === 999 ? 999_999 : instr.kjvVerseEnd;
    if (kjvVerse >= instr.kjvVerseStart && kjvVerse <= verseEnd) {
      // Suppress label when the KJV chapter:verse is identical to MT chapter:verse
      if (instr.kjvChapter === mtChapter && kjvVerse === mtVerse) return null;
      return `${instr.kjvChapter}:${kjvVerse}`;
    }
  }
  return null;
}
