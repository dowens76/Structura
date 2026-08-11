/**
 * buildLineGroupTree.ts
 *
 * Converts a flat list of LineGroup DB rows into a tree structure consumable
 * by d3-hierarchy's `hierarchy()` function. Trimmed sibling of
 * lib/rst/buildRstTree.ts — line groups have no role (nucleus/satellite) or
 * relation type; grouping is symmetric and members are ordered purely by
 * sortOrder.
 *
 * Data model recap
 * ─────────────────
 * Each LineGroup row represents ONE member of ONE group:
 *   { groupId, memberId, sortOrder }
 *
 * Rows with the same groupId form one group (2+ members). Nesting is
 * explicit: a member's `memberId` is either a paragraph's first wordId (a
 * leaf "line") or another group's `groupId` directly — the editing UI writes
 * the child groupId as the memberId when the user selects an existing
 * bracket (rather than a line) as an endpoint, so no representative-word
 * heuristic is needed (unlike RST, which infers nesting from a shared
 * nucleus wordId).
 */

import type { LineGroup } from "@/lib/db/schema";

export interface LineGroupNode {
  /** Unique id: groupId for group nodes, memberId (wordId) for leaf nodes. */
  id: string;
  type: "root" | "group" | "segment";
  /** Primary key of the LineGroup DB row that places this node in its parent group. */
  dbRowId?: number;
  children?: LineGroupNode[];
}

/**
 * Build a tree of `LineGroupNode`s from the raw DB rows.
 *
 * @param groups - all LineGroup rows for the current view
 * @param paragraphFirstWordIds - ordered list of every line's first wordId
 *   (used to fill in ungrouped lines as leaf nodes under the virtual root)
 * @returns a virtual root node whose children are the top-level groups (and
 *   any lines that belong to no group)
 */
export function buildLineGroupTree(
  groups: LineGroup[],
  paragraphFirstWordIds: string[],
): LineGroupNode {
  if (!groups.length) {
    return { id: "__root__", type: "root", children: [] };
  }

  // ── Step 1: group rows by groupId ─────────────────────────────────────────
  const byGroup = new Map<string, LineGroup[]>();
  for (const r of groups) {
    const arr = byGroup.get(r.groupId) ?? [];
    arr.push(r);
    byGroup.set(r.groupId, arr);
  }

  // ── Step 2: build LineGroupNode objects for each group ────────────────────
  const groupNodes = new Map<string, LineGroupNode>();
  for (const [groupId, members] of byGroup) {
    const sorted = [...members].sort((a, b) => a.sortOrder - b.sortOrder);
    const children: LineGroupNode[] = sorted.map(m => {
      // Direct group reference (nesting): the member IS another group.
      if (byGroup.has(m.memberId) && m.memberId !== groupId) {
        return { id: `__placeholder__${m.memberId}`, type: "group" as const, dbRowId: m.id };
      }
      return { id: m.memberId, type: "segment" as const, dbRowId: m.id };
    });
    groupNodes.set(groupId, { id: groupId, type: "group", children });
  }

  // ── Step 3: resolve placeholders (swap in real child group nodes) ─────────
  for (const node of groupNodes.values()) {
    if (!node.children) continue;
    node.children = node.children.map(ch => {
      if (ch.id.startsWith("__placeholder__")) {
        const childGroupId = ch.id.slice("__placeholder__".length);
        const real = groupNodes.get(childGroupId);
        if (real) {
          real.dbRowId = ch.dbRowId;
          return real;
        }
      }
      return ch;
    });
  }

  // ── Step 4: find top-level groups (not nested inside another group) ────────
  const childGroupIds = new Set<string>();
  for (const node of groupNodes.values()) {
    for (const ch of node.children ?? []) {
      if (ch.type === "group") childGroupIds.add(ch.id);
    }
  }
  const topLevelGroups = [...groupNodes.values()].filter(
    n => !childGroupIds.has(n.id)
  );

  // ── Step 5: collect leaf ids already covered by some group ─────────────────
  const coveredIds = new Set<string>();
  function collectLeaves(node: LineGroupNode) {
    if (node.type === "segment") { coveredIds.add(node.id); return; }
    for (const ch of node.children ?? []) collectLeaves(ch);
  }
  for (const g of topLevelGroups) collectLeaves(g);

  // ── Step 6: build virtual root ──────────────────────────────────────────────
  const rootChildren: LineGroupNode[] = [
    ...topLevelGroups,
    // Lines that are in no group appear as standalone leaves (for the
    // line-selector dots in editing mode, and so they get default spacing).
    ...paragraphFirstWordIds
      .filter(id => !coveredIds.has(id))
      .map(id => ({ id, type: "segment" as const })),
  ];

  return { id: "__root__", type: "root", children: rootChildren };
}

/**
 * Height of the tree, counted from the leaves: a group whose members are
 * all plain lines has level 1; a group containing that group has level 2,
 * etc. Matches d3-hierarchy's `node.height` on a group node, which is what
 * LineGroupOverlay uses to pick each bracket's per-level color.
 */
export function getMaxNestingLevel(node: LineGroupNode): number {
  const childLevels = (node.children ?? []).map(getMaxNestingLevel);
  const maxChild = childLevels.length ? Math.max(...childLevels) : 0;
  return node.type === "group" ? 1 + maxChild : maxChild;
}
