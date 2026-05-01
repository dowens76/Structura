/**
 * buildRstTree.ts
 *
 * Converts a flat list of RstRelation DB rows into a tree structure
 * consumable by d3-hierarchy's `hierarchy()` function.
 *
 * RST data model recap
 * ────────────────────
 * Each RstRelation row represents ONE member of ONE group:
 *   { groupId, segWordId, role ("nucleus"|"satellite"), relType }
 *
 * Rows with the same groupId form one RST group (2+ members).
 *
 * Groups can be nested: the segWordId of a group-member may coincide with
 * the "representative word" of another group's nucleus — making that inner
 * group a child of the outer one in the tree.  We detect this by checking
 * whether a segWordId is itself the first member of another group.
 *
 * For the tree layout we need a SINGLE root.  Since a chapter may have
 * several independent RST groups (no common ancestor), we wrap everything
 * under a virtual "root" node that is never rendered.
 */

import type { RstRelation } from "@/lib/db/schema";

// ── Public types ──────────────────────────────────────────────────────────────

export interface RstNode {
  /** Unique id: groupId for group nodes, segWordId for segment nodes. */
  id: string;
  type: "root" | "group" | "segment";
  /** Relation type of this group (only set when type === "group"). */
  relType?: string;
  /**
   * Role of this node within its PARENT group.
   * "nucleus" | "satellite" for real children; undefined for virtual root.
   */
  role?: string;
  /**
   * Where a parent arm connects to this node's vertical line.
   * Only meaningful when this node is a group (i.e. has its own vertical).
   * "start" = top, "mid" = middle (default), "end" = bottom.
   */
  intersectPoint?: "start" | "mid" | "end";
  /**
   * Primary key of the rstRelations DB row that places this node in its
   * parent group.  Used by the overlay to save intersectPoint changes.
   */
  dbRowId?: number;
  children?: RstNode[];
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build a tree of `RstNode`s from the raw DB rows.
 *
 * @param relations - all RstRelation rows for the current view
 * @param paragraphFirstWordIds - ordered list of every segment's first wordId
 *   (used to fill in unattached segments as leaf nodes under the virtual root)
 * @returns a virtual root node whose children are the top-level RST groups
 *   (and any segments that belong to no group)
 */
export function buildRstTree(
  relations: RstRelation[],
  paragraphFirstWordIds: string[],
): RstNode {
  if (!relations.length) {
    return { id: "__root__", type: "root", children: [] };
  }

  // ── Step 1: group rows by groupId ─────────────────────────────────────────
  const byGroup = new Map<string, RstRelation[]>();
  for (const r of relations) {
    const arr = byGroup.get(r.groupId) ?? [];
    arr.push(r);
    byGroup.set(r.groupId, arr);
  }

  // ── Step 2: figure out which segWordIds are the "representative" id of a
  //            group so we can detect nesting ────────────────────────────────
  //
  // Convention: the nucleus member's segWordId "represents" the group as a
  // whole.  If a parent group's satellite or nucleus segWordId matches a
  // child group's nucleus segWordId, the child group is nested inside the
  // parent.
  //
  // Build a map: nucleusWordId → groupId
  const nucleusToGroup = new Map<string, string>();
  for (const [groupId, members] of byGroup) {
    const nucleus = members.find(m => m.role === "nucleus") ?? members[0];
    nucleusToGroup.set(nucleus.segWordId, groupId);
  }

  // ── Step 3: build RstNode objects for each group ──────────────────────────
  const groupNodes = new Map<string, RstNode>();
  for (const [groupId, members] of byGroup) {
    const sorted = [...members].sort((a, b) => a.sortOrder - b.sortOrder);
    const relType = sorted[0].relType;

    const children: RstNode[] = sorted.map(m => {
      const ip = (m.intersectPoint ?? "mid") as "start" | "mid" | "end";

      // ── Direct group reference ────────────────────────────────────────────
      // When the user selects an existing group (not an individual paragraph)
      // as an RST endpoint, its groupId is stored directly as segWordId.
      // Detect this first so it works regardless of role.
      if (byGroup.has(m.segWordId) && m.segWordId !== groupId) {
        return {
          id: `__placeholder__${m.segWordId}`,
          type: "group" as const,
          role: m.role,
          relType: byGroup.get(m.segWordId)?.[0]?.relType,
          intersectPoint: ip,
          dbRowId: m.id,
        };
      }

      // ── Implicit nesting via shared nucleus segWordId ─────────────────────
      // Is this member's segWordId the nucleus representative of another group?
      // Only nest when the member is a SATELLITE — if it is the NUCLEUS of the
      // current group the two groups share the same nucleus and are coordinate
      // peers; do not nest one inside the other.
      const childGroupId = nucleusToGroup.get(m.segWordId);
      if (childGroupId && childGroupId !== groupId && m.role !== "nucleus") {
        return {
          id: `__placeholder__${childGroupId}`,
          type: "group" as const,
          role: m.role,
          relType: byGroup.get(childGroupId)?.[0]?.relType,
          intersectPoint: ip,
          dbRowId: m.id,
        };
      }

      return {
        id: m.segWordId,
        type: "segment" as const,
        role: m.role,
        intersectPoint: ip,
        dbRowId: m.id,
      };
    });

    groupNodes.set(groupId, { id: groupId, type: "group", relType, children });
  }

  // ── Step 4: resolve placeholders (swap in real child group nodes) ─────────
  for (const node of groupNodes.values()) {
    if (!node.children) continue;
    node.children = node.children.map(ch => {
      if (ch.id.startsWith("__placeholder__")) {
        const childGroupId = ch.id.slice("__placeholder__".length);
        const real = groupNodes.get(childGroupId);
        if (real) return { ...real, role: ch.role, intersectPoint: ch.intersectPoint, dbRowId: ch.dbRowId };
      }
      return ch;
    });
  }

  // ── Step 5: find top-level groups (not nested inside another group) ────────
  const childGroupIds = new Set<string>();
  for (const node of groupNodes.values()) {
    for (const ch of node.children ?? []) {
      if (ch.type === "group") childGroupIds.add(ch.id);
    }
  }
  const topLevelGroups = [...groupNodes.values()].filter(
    n => !childGroupIds.has(n.id)
  );

  // ── Step 6: collect segment ids already covered by some group ────────────
  const coveredSegIds = new Set<string>();
  function collectSegs(node: RstNode) {
    if (node.type === "segment") { coveredSegIds.add(node.id); return; }
    for (const ch of node.children ?? []) collectSegs(ch);
  }
  for (const g of topLevelGroups) collectSegs(g);

  // ── Step 7: build virtual root ─────────────────────────────────────────────
  const rootChildren: RstNode[] = [
    ...topLevelGroups,
    // Segments that are in no group appear as standalone leaves (for the
    // segment-selector dots in editing mode).
    ...paragraphFirstWordIds
      .filter(id => !coveredSegIds.has(id))
      .map(id => ({ id, type: "segment" as const })),
  ];

  return { id: "__root__", type: "root", children: rootChildren };
}
