import type { PoetryNotation } from "@/lib/db/schema";
import { buildAnchorSequence, buildAnchorIndex, midpointAnchor, isGapAnchor, gapBelowLineId } from "./anchorPoints";

/** Vertical px between stacked occurrences' centers at one anchor — must
 *  comfortably clear a single glyph's own rendered height (~28-33px at the
 *  1.75rem glyph size PoetryMarginOverlay uses) so two stacked glyphs don't
 *  visually overlap. Shared by the overlay's own stacking math and the
 *  extra-row-spacing calculation below so the two can't drift out of sync. */
export const POETRY_STACK_STEP_PX = 34;
/** Base clearance (px) added on top of any stacking requirement. */
export const POETRY_STACK_BASE_PX = 4;

export interface AnchorOccurrence {
  type: "balance" | "symmetry";
  mark: PoetryNotation;
  /** Symmetry only — which end of its pair this anchor is. */
  role?: "start" | "end";
  /** Symmetry only — true when this occurrence's mark is a repeat (Symmetry
   *  applied more than once, reusing one of its own anchors from an
   *  earlier-created mark). Set per MARK, so both the start and end
   *  triangles of a repeat mark carry it together, not just whichever end
   *  collided. Rendered smaller/darker so repeats read as nested inside the
   *  original rather than as visual clutter. */
  isInnerRepeat?: boolean;
  /** Symmetry only — shared by both triangles of the same mark, so its pair
   *  is identifiable at a glance. Assigned by first occurrence in reading
   *  order (whichever of the mark's two anchors comes first in the
   *  paragraph); ties — two marks first touching the very same anchor —
   *  go to the outer set before the inner one. Recalculated on every
   *  layout pass, so it shifts as marks are added/removed/repositioned
   *  rather than being a stored, permanent id. */
  pairNumber?: number;
}

export interface BalanceBracket {
  mark: PoetryNotation;
  topAnchor: string;
  bottomAnchor: string;
  midAnchor: string;
}

export interface PoetryAnchorLayout {
  sequence: string[];
  anchorIndex: Map<string, number>;
  /** anchorId -> occurrences at that anchor, already ordered for vertical
   *  stacking: Symmetry "start" occurrences first (rendered outermost/top),
   *  then everything else (Balance), then Symmetry "end" occurrences last
   *  (rendered outermost/bottom) — see stackOffsets. */
  occurrencesByAnchor: Map<string, AnchorOccurrence[]>;
  balanceBrackets: BalanceBracket[];
}

/**
 * Resolves every Balance/Imbalance and Symmetry mark against the combined
 * line+gap anchor sequence: Balance's bracket spans its two chosen anchors
 * (whichever is earlier becomes the top), with its symbol centered on the
 * anchor exactly midway between them; Symmetry's two triangles sit directly
 * on its own two chosen anchors. Marks whose stored anchor id no longer
 * resolves (e.g. stale data) are silently skipped rather than crashing.
 */
export function computePoetryAnchorLayout(
  balanceMarks: PoetryNotation[],
  symmetryMarks: PoetryNotation[],
  paragraphFirstWordIds: string[]
): PoetryAnchorLayout {
  const sequence = buildAnchorSequence(paragraphFirstWordIds);
  const anchorIndex = buildAnchorIndex(sequence);
  const occurrencesByAnchor = new Map<string, AnchorOccurrence[]>();
  const balanceBrackets: BalanceBracket[] = [];

  function pushOcc(anchorId: string, occ: AnchorOccurrence) {
    const arr = occurrencesByAnchor.get(anchorId);
    if (arr) arr.push(occ);
    else occurrencesByAnchor.set(anchorId, [occ]);
  }

  for (const mark of balanceMarks) {
    if (!mark.endWordId) continue;
    const ia = anchorIndex.get(mark.startWordId);
    const ib = anchorIndex.get(mark.endWordId);
    if (ia === undefined || ib === undefined) continue;
    const topAnchor = ia <= ib ? mark.startWordId : mark.endWordId;
    const bottomAnchor = ia <= ib ? mark.endWordId : mark.startWordId;
    const midAnchor = midpointAnchor(sequence, anchorIndex, mark.startWordId, mark.endWordId);
    if (!midAnchor) continue;
    pushOcc(midAnchor, { type: "balance", mark });
    balanceBrackets.push({ mark, topAnchor, bottomAnchor, midAnchor });
  }

  // Nesting: any Symmetry mark whose own span falls entirely within another
  // mark's span is an inner repeat, whether or not the two actually share
  // an anchor point — a pair fully "inside" a bigger one reads as nested
  // regardless of whether their triangles ever stack together. This is a
  // property of the two sets' actual positions, not of which was
  // created/placed first. Set per MARK, so both of a repeat mark's
  // triangles — not just whichever end happened to collide — render
  // smaller/darker together as one matched pair.
  const markSpan = new Map<number, number>();
  const markRange = new Map<number, { lo: number; hi: number }>();
  for (const mark of symmetryMarks) {
    const ia = anchorIndex.get(mark.startWordId);
    const ib = mark.endWordId ? anchorIndex.get(mark.endWordId) : undefined;
    if (ia !== undefined && ib !== undefined) {
      markSpan.set(mark.id, Math.abs(ib - ia));
      markRange.set(mark.id, { lo: Math.min(ia, ib), hi: Math.max(ia, ib) });
    }
  }

  const ranges = [...markRange.entries()];
  const innerRepeatMarkIds = new Set<number>();
  for (const [bId, b] of ranges) {
    const isContained = ranges.some(([aId, a]) => {
      if (aId === bId) return false;
      const contains = a.lo <= b.lo && a.hi >= b.hi;
      const strictlyLarger = a.lo < b.lo || a.hi > b.hi;
      return contains && strictlyLarger;
    });
    if (isContained) innerRepeatMarkIds.add(bId);
  }

  // Pair numbers: ordered by each mark's earliest anchor in reading order
  // (whichever of its start/end comes first — role doesn't determine this,
  // since click-order rather than position decides which is "start"). Ties
  // — two marks whose earliest touch is the very same anchor — resolve the
  // same way the size/color nesting does: outer before inner, then by
  // larger span, then by id, so the ordering is fully deterministic.
  const markFirstIndex = new Map<number, number>();
  for (const mark of symmetryMarks) {
    const ia = anchorIndex.get(mark.startWordId);
    const ib = mark.endWordId ? anchorIndex.get(mark.endWordId) : undefined;
    const indices = [ia, ib].filter((v): v is number => v !== undefined);
    if (indices.length) markFirstIndex.set(mark.id, Math.min(...indices));
  }
  const pairNumberByMarkId = new Map<number, number>();
  symmetryMarks
    .filter((m) => markFirstIndex.has(m.id))
    .sort((a, b) => {
      const byFirstIndex = markFirstIndex.get(a.id)! - markFirstIndex.get(b.id)!;
      if (byFirstIndex !== 0) return byFirstIndex;
      const aInner = innerRepeatMarkIds.has(a.id);
      const bInner = innerRepeatMarkIds.has(b.id);
      if (aInner !== bInner) return aInner ? 1 : -1;
      const bySpan = (markSpan.get(b.id) ?? -1) - (markSpan.get(a.id) ?? -1);
      if (bySpan !== 0) return bySpan;
      return a.id - b.id;
    })
    .forEach((mark, i) => pairNumberByMarkId.set(mark.id, i + 1));

  for (const mark of symmetryMarks) {
    const isInnerRepeat = innerRepeatMarkIds.has(mark.id);
    const pairNumber = pairNumberByMarkId.get(mark.id);
    if (anchorIndex.has(mark.startWordId)) pushOcc(mark.startWordId, { type: "symmetry", mark, role: "start", isInnerRepeat, pairNumber });
    if (mark.endWordId && anchorIndex.has(mark.endWordId)) pushOcc(mark.endWordId, { type: "symmetry", mark, role: "end", isInnerRepeat, pairNumber });
  }

  // Outer sets stack before inner ones within their own start/end group —
  // a property of the two sets' actual nesting, not of which was created
  // first — so a later-created outer pair doesn't end up buried beneath an
  // earlier-created inner one it actually encloses. Array#sort is a stable
  // sort, so ties (equal outer/inner-ness) keep their original relative order.
  const outerFirst = (a: AnchorOccurrence, b: AnchorOccurrence) => Number(!!a.isInnerRepeat) - Number(!!b.isInnerRepeat);

  for (const [anchorId, occs] of occurrencesByAnchor) {
    const starts = occs.filter((o) => o.type === "symmetry" && o.role === "start").sort(outerFirst);
    const ends = occs.filter((o) => o.type === "symmetry" && o.role === "end").sort(outerFirst);
    const others = occs.filter((o) => o.type !== "symmetry");
    occurrencesByAnchor.set(anchorId, [...starts, ...others, ...ends]);
  }

  return { sequence, anchorIndex, occurrencesByAnchor, balanceBrackets };
}

/** Vertical px each stacked occurrence is offset from its anchor's true Y —
 *  index 0 (topmost in stacking order) gets the most-negative offset, the
 *  last gets the most-positive, centered around 0. A lone occurrence gets 0
 *  (renders right on the anchor, no offset). */
export function stackOffsets(count: number, stepPx: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * stepPx);
}

/**
 * Extra margin-top (px) the row belonging to `belowLineId` needs so a
 * crowded anchor stack has room to breathe — additive vertical space instead
 * of ever widening the margin horizontally, per request. Keyed the same way
 * lib/lineGroups/computeLineSpacing's map already is (by the segment BELOW
 * the gap), so callers can merge the two with a plain Math.max.
 */
export function computePoetrySpacingMap(
  layout: PoetryAnchorLayout,
  paragraphFirstWordIds: string[],
  stepPx: number,
  basePx: number
): Map<string, number> {
  const map = new Map<string, number>();
  const countAt = (anchorId: string | undefined) => (anchorId ? layout.occurrencesByAnchor.get(anchorId)?.length ?? 0 : 0);

  for (let i = 1; i < paragraphFirstWordIds.length; i++) {
    const aboveLine = paragraphFirstWordIds[i - 1];
    const belowLine = paragraphFirstWordIds[i];
    const gapId = layout.sequence[layout.anchorIndex.get(aboveLine)! + 1];
    if (!gapId || !isGapAnchor(gapId) || gapBelowLineId(gapId) !== belowLine) continue;
    const maxCount = Math.max(countAt(aboveLine), countAt(gapId), countAt(belowLine));
    if (maxCount <= 1) continue;
    map.set(belowLine, basePx + (maxCount - 1) * stepPx);
  }
  return map;
}
