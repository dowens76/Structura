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

  for (const mark of symmetryMarks) {
    if (anchorIndex.has(mark.startWordId)) pushOcc(mark.startWordId, { type: "symmetry", mark, role: "start" });
    if (mark.endWordId && anchorIndex.has(mark.endWordId)) pushOcc(mark.endWordId, { type: "symmetry", mark, role: "end" });
  }

  for (const [anchorId, occs] of occurrencesByAnchor) {
    const starts = occs.filter((o) => o.type === "symmetry" && o.role === "start");
    const ends = occs.filter((o) => o.type === "symmetry" && o.role === "end");
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
