/**
 * Anchor points for the Balance/Imbalance and Symmetry margin — one per
 * poetic line, plus one synthetic anchor in the gap between every adjacent
 * pair of lines. Both principles now attach to any point in this combined
 * sequence (not just lines), so Balance's bracket can end — and its symbol
 * center — on a between-lines gap when that's the true midpoint.
 *
 * A real line's anchor id is simply its own segFirstWordId (unchanged from
 * before this existed — old marks keep resolving fine, lines are just a
 * subset of the full anchor set now). A gap anchor is a synthetic id derived
 * from the line immediately below it, so it stays stable as long as that
 * line's id does.
 */

const GAP_PREFIX = "gap:";

export function isGapAnchor(id: string): boolean {
  return id.startsWith(GAP_PREFIX);
}

export function gapAnchorId(belowLineId: string): string {
  return `${GAP_PREFIX}${belowLineId}`;
}

export function gapBelowLineId(gapId: string): string {
  return gapId.slice(GAP_PREFIX.length);
}

/** Interleaved [line0, gap(0,1), line1, gap(1,2), line2, ...] — the full set
 *  of anchor points the Balance/Symmetry margin can attach to. */
export function buildAnchorSequence(paragraphFirstWordIds: string[]): string[] {
  const seq: string[] = [];
  for (let i = 0; i < paragraphFirstWordIds.length; i++) {
    seq.push(paragraphFirstWordIds[i]);
    if (i < paragraphFirstWordIds.length - 1) {
      seq.push(gapAnchorId(paragraphFirstWordIds[i + 1]));
    }
  }
  return seq;
}

export function buildAnchorIndex(sequence: string[]): Map<string, number> {
  return new Map(sequence.map((id, i) => [id, i]));
}

/** The anchor exactly midway between two anchors, by position in `sequence`
 *  (rounding down when the number of steps between them is odd). Returns
 *  null if either anchor isn't in the sequence. */
export function midpointAnchor(
  sequence: string[],
  anchorIndex: Map<string, number>,
  a: string,
  b: string
): string | null {
  const ia = anchorIndex.get(a);
  const ib = anchorIndex.get(b);
  if (ia === undefined || ib === undefined) return null;
  const mid = Math.floor((Math.min(ia, ib) + Math.max(ia, ib)) / 2);
  return sequence[mid] ?? null;
}
