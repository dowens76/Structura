"use client";

import { useLayoutEffect, useMemo, useRef, useState, useCallback, RefObject } from "react";
import { hierarchy } from "d3-hierarchy";
import type { RstRelation } from "@/lib/db/schema";
import {
  RELATIONSHIP_MAP,
  buildRelationshipMap,
  type RstTypeEntry,
} from "@/lib/morphology/clauseRelationships";
import { buildRstTree } from "@/lib/rst/buildRstTree";

// ── Layout constants ──────────────────────────────────────────────────────────
const HANG_PX      = 32;  // must match VerseDisplay HANG_PX
const LEVEL_WIDTH  = 18;  // px per nesting depth level

/**
 * LTR texts: minimum left padding added to the container so the tree has room.
 * The actual padding grows automatically when the tree is deeply nested.
 * See `useRequiredGutter` below.
 */
const LTR_GUTTER_MIN = 72;  // px — minimum left padding for LTR view

/**
 * LTR/translation leaf nodes sit this many px to the left of each segment's
 * own text-start position.  Groups step further left by LEVEL_WIDTH each level.
 */
const LEAF_MARGIN  = 8;   // px left of each segment's leftX for leaf nodes

// TRANS_GUTTER and HEB_ANCHOR removed — all trees use LEAF_MARGIN.

// ── Types ─────────────────────────────────────────────────────────────────────

interface SegPos {
  top: number;
  bottom: number;
  leftX: number;
  rightX: number;
  transLeftX?: number;
  /** Right edge of the source grid-cell div (3-col layout only). Used to anchor
   *  the source tree from the column boundary rather than from the inline text span. */
  srcCellRightX?: number;
  /** Left edge of the verse-label element.  Used in Hebrew 2-col to prevent the
   *  RST tree from extending into the verse-number column. */
  labelLeftX?: number;
}

interface LayoutNode {
  id: string;
  type: "group" | "segment";
  x: number;
  y: number;
  relType?: string;
  role?: string;
  /** true = this node belongs to the translation-column mirror tree */
  isTrans?: boolean;
}

interface LayoutLink {
  parentId: string;
  childId: string;
  x1: number; y1: number;
  x2: number; y2: number;
  relType: string;
  role: string;
  isTrans?: boolean;
}

export interface Props {
  relations: RstRelation[];
  containerRef: RefObject<HTMLDivElement | null>;
  isHebrew: boolean;
  /** True when a translation column is visible (3-col layout). Controls whether
   *  the source tree mirrors toward the centre label rather than using a left gutter. */
  hasTranslation: boolean;
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedNucleusWordId: string | null;
  selectedSatelliteWordId: string | null;
  editingGroupId?: string | null;
  onSelectSegment: (wordId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup?: (groupId: string) => void;
  /** Called when the user clicks the connector dot on an existing group chip,
   *  selecting that group (by its groupId) as an RST endpoint. */
  onSelectGroup?: (groupId: string) => void;
  customTypes?: RstTypeEntry[];
}

// ── DOM measurement ───────────────────────────────────────────────────────────

function measureSegments(
  wordIds: string[],
  container: HTMLElement,
): Map<string, SegPos> {
  const cRect     = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;
  const result    = new Map<string, SegPos>();

  for (const id of wordIds) {
    const outerEl = container.querySelector<HTMLElement>(
      `[data-rst-seg="${CSS.escape(id)}"]`,
    );
    if (!outerEl) continue;

    // Y anchors to the source-text span so ticks land at the text line,
    // not in the middle of a tall div that includes translation rows.
    const textEl = container.querySelector<HTMLElement>(
      `[data-rst-text="${CSS.escape(id)}"]`,
    ) ?? outerEl;
    const textR = textEl.getBoundingClientRect();

    // For multi-line block segments, use the first text line's bounding rect
    // so the anchor lands on the first line rather than the vertical midpoint
    // of the entire block.
    let anchorTop    = textR.top;
    let anchorBottom = textR.bottom;
    try {
      const tw = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
      let tn: Node | null;
      while ((tn = tw.nextNode())) {
        if ((tn as Text).textContent?.trim()) {
          const r = document.createRange();
          r.setStart(tn as Text, 0);
          r.setEnd(tn as Text, Math.min(1, (tn as Text).length));
          const rr = r.getBoundingClientRect();
          if (rr.height > 0) { anchorTop = rr.top; anchorBottom = rr.bottom; }
          break;
        }
      }
    } catch { /* ignore */ }

    const transEl    = container.querySelector<HTMLElement>(
      `[data-seg-translation="${CSS.escape(id)}"]`,
    );
    const transLeftX = transEl
      ? transEl.getBoundingClientRect().left - cRect.left
      : undefined;

    // 3-col only: measure the source grid-cell div (blockified, stable column bounds).
    const srcBlockEl = container.querySelector<HTMLElement>(
      `[data-rst-src-block="${CSS.escape(id)}"]`,
    );
    const srcCellRightX = srcBlockEl
      ? srcBlockEl.getBoundingClientRect().right - cRect.left
      : undefined;

    // Hebrew 2-col: measure the verse-label left edge so the tree stays clear of it.
    const labelEl = container.querySelector<HTMLElement>(
      `[data-seg-label="${CSS.escape(id)}"]`,
    );
    const labelLeftX = labelEl
      ? labelEl.getBoundingClientRect().left - cRect.left
      : undefined;

    result.set(id, {
      top:       anchorTop    - cRect.top + scrollTop,
      bottom:    anchorBottom - cRect.top + scrollTop,
      leftX:     textR.left   - cRect.left,
      rightX:    textR.right  - cRect.left,
      transLeftX,
      srcCellRightX,
      labelLeftX,
    });
  }
  return result;
}

// ── d3-hierarchy layout ───────────────────────────────────────────────────────

/**
 * Build a flat list of nodes + links from the d3 hierarchy, given a
 * function that maps (depth) → x position.
 *
 * @param rootNode - output of buildRstTree
 * @param yMap     - segWordId/groupId → centre Y (px)
 * @param xFn      - depth → SVG x position
 * @param isTrans  - tag all produced nodes/links as translation-side
 */
function flattenHierarchy(
  rootNode: ReturnType<typeof buildRstTree>,
  yMap: Map<string, number>,
  xFn: (depth: number) => number,
  isTrans: boolean,
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const hier = hierarchy(rootNode, n => n.children);

  // Leaf-Y from yMap (already computed before calling this function)
  // Group-Y = average of children (bottom-up)
  hier.eachAfter(hNode => {
    const d = hNode.data;
    if (d.type === "root" || d.type === "group") {
      const childYs = (hNode.children ?? [])
        .map(ch => yMap.get(ch.data.id))
        .filter((y): y is number => y !== undefined);
      if (childYs.length)
        yMap.set(d.id, childYs.reduce((a, b) => a + b, 0) / childYs.length);
    }
  });

  const rawNodes: LayoutNode[] = [];
  const links: LayoutLink[] = [];

  hier.each(hNode => {
    const d = hNode.data;
    if (d.type === "root") return;

    const y = yMap.get(d.id);
    if (y === undefined) return; // skip unmeasured segments/groups

    const x = xFn(hNode.depth);

    rawNodes.push({
      id:      d.id,
      type:    d.type as "group" | "segment",
      x, y,
      relType: d.relType,
      role:    d.role,
      isTrans,
    });

    const parent = hNode.parent;
    if (parent && parent.data.type !== "root") {
      const parentY = yMap.get(parent.data.id);
      if (parentY !== undefined) {
        // Use the nucleus child's Y as the link's y1 so that all links from
        // this group share a common spine top at the nucleus position rather
        // than floating at the group's averaged Y.
        const nucleusChild = parent.data.children?.find(c => c.role === "nucleus");
        const nucleusY = nucleusChild ? (yMap.get(nucleusChild.id) ?? parentY) : parentY;
        links.push({
          parentId: parent.data.id,
          childId:  d.id,
          x1: xFn(parent.depth), y1: nucleusY,
          x2: x,                 y2: y,
          relType: parent.data.relType ?? "",
          role:    d.role ?? "nucleus",
          isTrans,
        });
      }
    }
  });

  // Deduplicate nodes by id (same group can appear at multiple tree positions
  // if nesting detection mis-fires; keep the first/shallowest occurrence).
  const seenIds = new Set<string>();
  const nodes: LayoutNode[] = [];
  for (const n of rawNodes) {
    if (!seenIds.has(n.id)) { seenIds.add(n.id); nodes.push(n); }
  }

  // Deduplicate links by parentId:childId:isTrans to remove copies that arise
  // when the same group node is visited multiple times during tree traversal.
  const linkKeys = new Set<string>();
  const dedupLinks: LayoutLink[] = [];
  for (const lk of links) {
    const key = `${lk.parentId}:${lk.childId}:${lk.isTrans ? 1 : 0}`;
    if (!linkKeys.has(key)) { linkKeys.add(key); dedupLinks.push(lk); }
  }

  return { nodes, links: dedupLinks };
}

function layoutTree(
  relations: RstRelation[],
  paragraphFirstWordIds: string[],
  posMap: Map<string, SegPos>,
  isHebrew: boolean,
  hasTranslationProp: boolean,
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  const treeRoot = buildRstTree(relations, paragraphFirstWordIds);

  // ── Pre-compute leaf Y values (shared between source + trans passes) ────────
  const hierForLeaves = hierarchy(treeRoot, n => n.children);
  const yMapSource   = new Map<string, number>();
  const yMapTrans    = new Map<string, number>();

  for (const hNode of hierForLeaves.leaves()) {
    const d = hNode.data;
    if (d.type !== "segment") continue;
    const pos = posMap.get(d.id);
    if (!pos) continue;
    const cy = pos.top + (pos.bottom - pos.top) / 2;
    yMapSource.set(d.id, cy);
    if (pos.transLeftX !== undefined) yMapTrans.set(d.id, cy);
  }

  // ── Reference x values ──────────────────────────────────────────────────────
  let refLeftX = Infinity;
  for (const pos of posMap.values()) refLeftX = Math.min(refLeftX, pos.leftX);
  if (!isFinite(refLeftX)) refLeftX = HANG_PX;

  // Hebrew: anchor from the RIGHT edge of the text (start of RTL text).
  let refRightX = -Infinity;
  for (const pos of posMap.values()) refRightX = Math.max(refRightX, pos.rightX);
  if (!isFinite(refRightX)) refRightX = refLeftX + HANG_PX;

  let refTransLeftX = Infinity;
  for (const pos of posMap.values()) {
    if (pos.transLeftX !== undefined)
      refTransLeftX = Math.min(refTransLeftX, pos.transLeftX);
  }
  const hasTransMeasured = isFinite(refTransLeftX);

  // Stable right edge of the source grid cell (only set in the 3-col layout
  // where data-rst-src-block is present on the source wrapper div).
  let refSrcCellRightX = -Infinity;
  for (const pos of posMap.values()) {
    if (pos.srcCellRightX !== undefined)
      refSrcCellRightX = Math.max(refSrcCellRightX, pos.srcCellRightX);
  }
  // Use 3-col right-edge anchoring only for Hebrew (RTL) with translation.
  // LTR Greek uses the same left-gutter positioning as 2-col regardless of translation.
  const use3Col = hasTranslationProp && isFinite(refSrcCellRightX) && isHebrew;

  // Hebrew 2-col: the minimum left-edge of any verse-label element.
  // In 2-col mode the container gets extra paddingRight so the tree always has
  // room — the label bound is therefore not needed there.  We keep it only for
  // 3-col Hebrew (where the centre label column has a fixed width) as a fallback.
  let hebrewLabelBound = Infinity;
  for (const pos of posMap.values()) {
    if (pos.labelLeftX !== undefined)
      hebrewLabelBound = Math.min(hebrewLabelBound, pos.labelLeftX);
  }
  const hasLabelBound = use3Col && isHebrew && isFinite(hebrewLabelBound);

  // Pre-compute max hierarchy depth.
  const maxDepth = hierForLeaves.height; // 0 if only root; typically 2–4

  // ── x-position formulas ─────────────────────────────────────────────────────
  //
  // LTR (Greek, 2-col or 3-col): arrows on the LEFT of source text.
  //   Leaf dots at pos.leftX − LEAF_MARGIN; groups step further left into gutter.
  //
  // Hebrew 2-col: arrows on the RIGHT of source text (start of RTL text).
  //   Leaf dots at pos.rightX + LEAF_MARGIN; groups step further right (into label area).
  //
  // Hebrew 3-col: source tree anchors from RIGHT edge of source column toward centre.
  //   Leaves at srcCellRightX + LEAF_MARGIN (just outside column boundary);
  //   groups step further RIGHT into the centre label area.
  //   Translation tree: leaves at transLeftX − LEAF_MARGIN; groups step LEFT.
  //
  // Elbow direction is implicit: x2 > x1 → right; x2 < x1 → left.

  const srcXFn = use3Col
    ? (d: number) => (refSrcCellRightX + LEAF_MARGIN) + (maxDepth - d) * LEVEL_WIDTH
    : isHebrew
      ? (d: number) => {
          const x = (refRightX + LEAF_MARGIN) + (maxDepth - d) * LEVEL_WIDTH;
          return hasLabelBound ? Math.min(x, hebrewLabelBound - 4) : x;
        }
      : (d: number) => (refLeftX - LEAF_MARGIN) - (maxDepth - d) * LEVEL_WIDTH;

  const transXFn = (d: number) =>
    (refTransLeftX - LEAF_MARGIN) - (maxDepth - d) * LEVEL_WIDTH;

  // ── Build source tree ────────────────────────────────────────────────────────
  const src = flattenHierarchy(treeRoot, yMapSource, srcXFn, false);

  if (use3Col) {
    // Hebrew 3-col: override leaf x to just outside the column-cell right boundary.
    for (const node of src.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos?.srcCellRightX !== undefined) node.x = pos.srcCellRightX + LEAF_MARGIN;
      }
    }
    for (const link of src.links) {
      const child = src.nodes.find(n => n.id === link.childId);
      if (child?.type === "segment") link.x2 = child.x;
    }
  } else if (isHebrew) {
    // 2-col Hebrew: override leaf x to each segment's own text-right position so
    // indented paragraphs (with narrower right edge) get a proportionally shorter arm.
    // Also cap at hebrewLabelBound so leaves don't overlap the verse-number column.
    for (const node of src.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos) {
          const raw = pos.rightX + LEAF_MARGIN;
          node.x = hasLabelBound ? Math.min(raw, hebrewLabelBound - 4) : raw;
        }
      }
    }
    for (const link of src.links) {
      const child = src.nodes.find(n => n.id === link.childId);
      if (child?.type === "segment") link.x2 = child.x;
    }
  } else {
    // 2-col LTR: override leaf x to each segment's own text-start position so
    // indented paragraphs get a proportionally longer horizontal arm.
    for (const node of src.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos) node.x = pos.leftX - LEAF_MARGIN;
      }
    }
    for (const link of src.links) {
      const child = src.nodes.find(n => n.id === link.childId);
      if (child?.type === "segment") link.x2 = child.x;
    }
  }

  // ── Build translation mirror tree (if any segment has transLeftX) ────────────
  let trans: { nodes: LayoutNode[]; links: LayoutLink[] } = { nodes: [], links: [] };
  if (hasTransMeasured && yMapTrans.size > 0) {
    const treeRootTrans = buildRstTree(relations, paragraphFirstWordIds);
    trans = flattenHierarchy(treeRootTrans, yMapTrans, transXFn, true);
    for (const node of trans.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos?.transLeftX !== undefined) {
          // Mirror source indentation: segments that are indented further right
          // in the source column get a proportionally longer translation arm,
          // matching the visual arm lengths on the source side.
          const srcIndent = (pos.leftX - LEAF_MARGIN) - (refLeftX - LEAF_MARGIN);
          node.x = (pos.transLeftX - LEAF_MARGIN) + srcIndent;
        }
      }
    }
    for (const link of trans.links) {
      const child = trans.nodes.find(n => n.id === link.childId);
      if (child?.type === "segment") link.x2 = child.x;
    }
  }

  return {
    nodes: [...src.nodes, ...trans.nodes],
    links: [...src.links, ...trans.links],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RstRelationOverlay({
  relations,
  containerRef,
  isHebrew,
  hasTranslation,
  editing,
  paragraphFirstWordIds,
  selectedNucleusWordId,
  selectedSatelliteWordId,
  editingGroupId,
  onSelectSegment,
  onDeleteGroup,
  onEditGroup,
  onSelectGroup,
  customTypes = [],
}: Props) {
  const relMap = customTypes.length > 0
    ? buildRelationshipMap(customTypes)
    : RELATIONSHIP_MAP;

  const svgRef    = useRef<SVGSVGElement>(null);
  const frameRef  = useRef<number | null>(null);
  const [svgH,        setSvgH]        = useState(0);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutLinks, setLayoutLinks] = useState<LayoutLink[]>([]);
  const [posMap,      setPosMap]      = useState<Map<string, SegPos>>(new Map());
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  // ── Compute required gutters from tree depth ─────────────────────────────────
  // Computed via useMemo (no DOM) so padding effects have the right value before
  // the first layout measurement runs.
  // LTR: left padding grows with depth so deep trees never clip off the left edge.
  // Hebrew 2-col: right padding grows with depth so the tree never overlaps verse labels.
  // (Hebrew 3-col uses the centre column and is already wide enough in practice.)
  const [requiredLtrGutter, requiredHebGutter] = useMemo(() => {
    const treeRoot = buildRstTree(relations, paragraphFirstWordIds);
    const h = hierarchy(treeRoot, (n: ReturnType<typeof buildRstTree>) => n.children);
    const depth = Math.max(h.height, 1);
    const needed = LEAF_MARGIN + depth * LEVEL_WIDTH + 16;
    return [
      Math.max(LTR_GUTTER_MIN, needed), // LTR left gutter
      needed,                            // Hebrew right gutter (no hard minimum)
    ];
  // paragraphFirstWordIds changes identity each render; join() gives a stable key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations, paragraphFirstWordIds.join(",")]);

  // ── LTR: add left padding so the source tree has gutter room ─────────────────
  // Applied for all LTR layouts (2-col and 3-col with translation).
  // Uses a fixed minimum even when there are no relations, so the page layout
  // doesn't shift when the first relation is added in editing mode.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || isHebrew) return;
    const prev = container.style.paddingLeft;
    container.style.paddingLeft = `${requiredLtrGutter}px`;
    return () => { container.style.paddingLeft = prev; };
  }, [containerRef, isHebrew, hasTranslation, requiredLtrGutter]);

  // ── Hebrew 2-col: add right padding so the tree doesn't overlap verse labels ──
  // Only applies when there are actual RST relations to draw.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !isHebrew || hasTranslation || relations.length === 0) return;
    const prev = container.style.paddingRight;
    container.style.paddingRight = `${requiredHebGutter}px`;
    return () => { container.style.paddingRight = prev; };
  }, [containerRef, isHebrew, hasTranslation, relations.length, requiredHebGutter]);

  const allSegIds = [
    ...new Set([
      ...relations.map(r => r.segWordId),
      ...(editing ? paragraphFirstWordIds : []),
    ]),
  ];

  const scheduleRemeasure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const newPos           = measureSegments(allSegIds, container);
      const { nodes, links } = layoutTree(relations, paragraphFirstWordIds, newPos, isHebrew, hasTranslation);
      setPosMap(newPos);
      setSvgH(container.scrollHeight);
      setLayoutNodes(nodes);
      setLayoutLinks(links);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations, containerRef, isHebrew, hasTranslation, editing, paragraphFirstWordIds.join(",")]);

  useLayoutEffect(() => {
    scheduleRemeasure();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(scheduleRemeasure);
    ro.observe(container);
    const mo = new MutationObserver(scheduleRemeasure);
    mo.observe(container, { childList: true, subtree: true, attributes: false });
    container.addEventListener("scroll", scheduleRemeasure, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      container.removeEventListener("scroll", scheduleRemeasure);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleRemeasure, containerRef]);

  if (!svgH) return null;

  const NUCLEUS_R = 5;
  const SAT_R     = 4;
  const SEG_R     = 3.5;

  const relatedSegIds = new Set(relations.map(r => r.segWordId));

  const groupNodes = layoutNodes.filter(n => n.type === "group");

  // If a group's nucleus segWordId is the currently-selected first endpoint,
  // that group should be visually highlighted.
  const selectedGroupId = selectedNucleusWordId
    ? (relations.find(r => r.segWordId === selectedNucleusWordId && r.role === "nucleus")?.groupId ?? null)
    : null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 overflow-visible pointer-events-none z-10"
      style={{ width: "100%", height: svgH }}
      aria-hidden="true"
    >
      {/* ── Tree edges ────────────────────────────────────────────────────── */}
      {(() => {
        // Build a per-group spine X.
        //
        // The spine is placed LEVEL_WIDTH beyond the *innermost* leaf in the group
        // (innermost = closest to the margin, i.e. furthest from the text):
        //   LTR / translation  →  smallest  x2  across all children → spine to the left
        //   Hebrew source (RTL) →  largest   x2  across all children → spine to the right
        //
        // Using the innermost leaf (rather than the nucleus leaf alone) guarantees two things:
        //   1. All horizontal arms run in the correct direction (toward the text, never backward).
        //   2. When the nucleus is the least-indented member, its arm equals exactly LEVEL_WIDTH.
        //
        // Key: `${parentId}:${isTrans}` to avoid source/translation key collisions.
        const spineXByParent = new Map<string, number>();
        for (const lk of layoutLinks) {
          const key      = `${lk.parentId}:${lk.isTrans ? 1 : 0}`;
          const isRtlSrc = isHebrew && !lk.isTrans;
          const cur      = spineXByParent.get(key);
          if (isRtlSrc) {
            // RTL: take the maximum (rightmost) leaf x2
            spineXByParent.set(key, cur === undefined ? lk.x2 : Math.max(cur, lk.x2));
          } else {
            // LTR: take the minimum (leftmost) leaf x2
            spineXByParent.set(key, cur === undefined ? lk.x2 : Math.min(cur, lk.x2));
          }
        }
        // Offset each group's innermost-leaf position by LEVEL_WIDTH in the outward direction.
        for (const [key, innerX] of spineXByParent) {
          const isRtlSrc = key.endsWith(":0") && isHebrew;
          spineXByParent.set(key, isRtlSrc ? innerX + LEVEL_WIDTH : innerX - LEVEL_WIDTH);
        }

        return layoutLinks.map((lk, i) => {
          const meta   = relMap[lk.relType];
          const color  = meta?.color ?? "#6B7280";
          const isSat  = lk.role === "satellite";
          const key    = `${lk.parentId}:${lk.isTrans ? 1 : 0}`;
          const spineX = spineXByParent.get(key) ?? lk.x1;
          const pathD  = `M ${spineX},${lk.y1} V ${lk.y2} H ${lk.x2}`;
          return (
            <path
              key={i}
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth={editing ? 2 : 1.5}
              strokeDasharray={isSat ? "4 3" : undefined}
              opacity={0.85}
              style={{ pointerEvents: "none" }}
            />
          );
        });
      })()}

      {/* ── Group nodes (relation-type chips) ─────────────────────────────── */}
      {groupNodes.map((n, i) => {
        const meta          = relMap[n.relType ?? ""];
        const color         = meta?.color ?? "#6B7280";
        const abbr          = meta?.abbr  ?? (n.relType ?? "?").slice(0, 3);
        const isHovered     = hoveredGroup === n.id;
        const isEditingThis = editingGroupId === n.id;
        // Translation mirror chips are read-only (no edit/delete hit targets)
        const isInteractive = editing && !n.isTrans;
        const CHIP_W = 28;
        const CHIP_H = 16;

        const isSelectedEndpoint = n.id === selectedGroupId && !n.isTrans;
        // Move the chip one LEVEL_WIDTH toward the text ("inside the bracket").
        // Hebrew source tree extends rightward, so inward = left (−).
        // LTR and translation trees extend leftward, so inward = right (+).
        const chipX = (isHebrew && !n.isTrans) ? n.x - LEVEL_WIDTH : n.x + LEVEL_WIDTH;
        // Connector dot position: on the tree-facing (outer) side of the chip.
        const connDotX = isHebrew
          ? chipX + CHIP_W / 2 + 7
          : chipX - CHIP_W / 2 - 7;
        // Position the chip at the satellite arm's Y (within 2px of the horizontal
        // line connecting to the satellite), falling back to the group's centre Y.
        const satLink = layoutLinks.find(
          lk => lk.parentId === n.id && lk.role === "satellite" && !!lk.isTrans === !!n.isTrans
        );
        const chipY = satLink?.y2 ?? n.y;

        return (
          <g
            key={`${n.id}-${i}`}
            onMouseEnter={() => isInteractive && setHoveredGroup(n.id)}
            onMouseLeave={() => isInteractive && setHoveredGroup(null)}
            style={{ pointerEvents: isInteractive ? "all" : "none" }}
          >
            {/* Purple ring when this group is the currently-selected RST endpoint */}
            {isSelectedEndpoint && (
              <rect
                x={chipX - CHIP_W / 2 - 3} y={chipY - CHIP_H / 2 - 3}
                width={CHIP_W + 6}          height={CHIP_H + 6}
                rx={5} fill="none" stroke="#7C3AED" strokeWidth={2}
                style={{ pointerEvents: "none" }}
              />
            )}
            {/* White ring when this group's type is being edited */}
            {isEditingThis && !n.isTrans && (
              <rect
                x={chipX - CHIP_W / 2 - 3} y={chipY - CHIP_H / 2 - 3}
                width={CHIP_W + 6}          height={CHIP_H + 6}
                rx={5} fill="none" stroke="white" strokeWidth={2}
                style={{ pointerEvents: "none" }}
              />
            )}
            <rect
              x={chipX - CHIP_W / 2} y={chipY - CHIP_H / 2}
              width={CHIP_W}          height={CHIP_H}
              rx={3}
              fill={color}
              opacity={n.isTrans ? 0.6 : isEditingThis ? 1 : 0.9}
              style={{ cursor: (isInteractive && onEditGroup) ? "pointer" : "default" }}
              onClick={e => {
                if (isInteractive && onEditGroup) { e.stopPropagation(); onEditGroup(n.id); }
              }}
            />
            <text
              x={chipX} y={chipY + 4}
              textAnchor="middle" fill="white"
              fontSize={9} fontFamily="monospace" fontWeight="bold"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >{abbr}</text>

            {isInteractive && isHovered && (
              <g
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={e => { e.stopPropagation(); onDeleteGroup(n.id); }}
              >
                <circle cx={chipX + CHIP_W / 2} cy={chipY - CHIP_H / 2} r={6} fill="#DC2626" />
                <text
                  x={chipX + CHIP_W / 2} y={chipY - CHIP_H / 2 + 4}
                  textAnchor="middle" fill="white" fontSize={9} fontFamily="sans-serif"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >×</text>
              </g>
            )}

            {/* Connector dot: selects this group as an RST endpoint */}
            {editing && !n.isTrans && onSelectGroup && (
              <circle
                cx={connDotX} cy={chipY} r={SEG_R}
                fill={isSelectedEndpoint ? "#7C3AED" : "transparent"}
                stroke={isSelectedEndpoint ? "#7C3AED" : "#94A3B8"}
                strokeWidth={1.5}
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={e => { e.stopPropagation(); onSelectGroup(n.id); }}
              />
            )}
          </g>
        );
      })}

      {/* ── Segment leaf dots (role-coloured anchors on source tree only) ─── */}
      {layoutNodes
        .filter(n => n.type === "segment" && !n.isTrans && relatedSegIds.has(n.id))
        .map(n => (
          <circle
            key={`leaf-${n.id}`}
            cx={n.x} cy={n.y} r={3}
            fill={n.role === "nucleus" ? "#7C3AED" : "#F59E0B"}
            opacity={0.9}
            style={{ pointerEvents: "none" }}
          />
        ))}

      {/* ── Editing mode: segment selector dots ──────────────────────────── */}
      {editing && paragraphFirstWordIds.map(wordId => {
        const pos = posMap.get(wordId);
        if (!pos) return null;

        const isNucleus   = wordId === selectedNucleusWordId;
        const isSatellite = wordId === selectedSatelliteWordId;

        // Selector dots match the leaf-dot position used by the rendered tree.
        // Hebrew 3-col: just outside the source column's right boundary.
        // Hebrew 2-col: just right of the text's right edge.
        // LTR (2-col or 3-col): just left of the text start (in the left gutter).
        const dotX = (isHebrew && pos.srcCellRightX !== undefined)
          ? pos.srcCellRightX + LEAF_MARGIN          // Hebrew 3-col
          : isHebrew
            ? pos.rightX + LEAF_MARGIN               // Hebrew 2-col
            : pos.leftX - LEAF_MARGIN;               // LTR (any layout)
        const dotY = pos.top + (pos.bottom - pos.top) / 2;

        const r      = isNucleus ? NUCLEUS_R : isSatellite ? SAT_R : SEG_R;
        const fill   = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "transparent";
        const stroke = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "#94A3B8";
        const sw     = isNucleus || isSatellite ? 0 : 1.5;

        return (
          <circle
            key={wordId}
            cx={dotX} cy={dotY} r={r}
            fill={fill} stroke={stroke} strokeWidth={sw}
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onClick={() => onSelectSegment(wordId)}
          />
        );
      })}
    </svg>
  );
}
