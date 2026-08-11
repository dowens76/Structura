/**
 * computeLineSpacing.ts
 *
 * Maps line-group nesting onto vertical gaps between consecutive poetry
 * lines: the closer the relationship (the deeper the lowest common ancestor
 * group of two adjacent lines), the smaller the gap between them. Lines
 * with no shared group at all get the page's normal default spacing
 * (represented here as "no override" — the caller keeps its existing
 * mt-1 / mt-5 classes).
 */

import type { LineGroupNode } from "./buildLineGroupTree";

/**
 * Gap (px) for a lowest-common-ancestor depth of 1, 2, 3+ respectively
 * (depth counted from the virtual root = 0). Deeper nesting → tighter gap.
 * Index 0 = depth 1 (outermost grouping), clamped to the last entry for any
 * deeper nesting.
 */
const TIER_MARGIN_PX = [12, 6, 3];

/**
 * @param tree - output of buildLineGroupTree
 * @param orderedWordIds - paragraphFirstWordIds, in reading order
 * @returns Map from a line's wordId to the marginTop (px) that should apply
 *   ABOVE that line, for every line whose gap from the previous line is
 *   tightened by a shared group. Lines not in the map should keep the
 *   caller's default spacing.
 */
export function computeLineSpacing(
  tree: LineGroupNode,
  orderedWordIds: string[],
): Map<string, number> {
  // Chain of ancestor ids (root..self inclusive) for every node in the tree.
  const chains = new Map<string, string[]>();
  function collect(node: LineGroupNode, ancestors: string[]) {
    const chain = [...ancestors, node.id];
    chains.set(node.id, chain);
    for (const ch of node.children ?? []) collect(ch, chain);
  }
  collect(tree, []);

  const result = new Map<string, number>();
  for (let i = 1; i < orderedWordIds.length; i++) {
    const prevChain = chains.get(orderedWordIds[i - 1]);
    const currChain = chains.get(orderedWordIds[i]);
    if (!prevChain || !currChain) continue;

    let matchLen = 0;
    while (
      matchLen < prevChain.length &&
      matchLen < currChain.length &&
      prevChain[matchLen] === currChain[matchLen]
    ) matchLen++;
    const lcaDepth = matchLen - 1; // index of last shared ancestor; root-only match → 0

    if (lcaDepth <= 0) continue; // no shared group — default spacing applies
    const tierIdx = Math.min(lcaDepth - 1, TIER_MARGIN_PX.length - 1);
    result.set(orderedWordIds[i], TIER_MARGIN_PX[tierIdx]);
  }
  return result;
}
