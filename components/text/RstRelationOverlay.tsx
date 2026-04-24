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
  /** Independent translation-side relations (unlinked mode). When omitted, the
   *  translation column mirrors the source tree (linked mode / default behaviour). */
  tvRelations?: RstRelation[];
  containerRef: RefObject<HTMLDivElement | null>;
  isHebrew: boolean;
  /** True when a translation column is visible (3-col layout). Controls whether
   *  the source tree mirrors toward the centre label rather than using a left gutter. */
  hasTranslation: boolean;
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedNucleusWordId: string | null;
  selectedSatelliteWordId: string | null;
  /** When the first endpoint was chosen by clicking a group connector dot,
   *  this is that group's ID.  The chip for this group shows the selection ring
   *  and the underlying paragraph dot is NOT highlighted, making it clear that
   *  the entire group (not just one paragraph) is selected as the endpoint. */
  selectedNucleusGroupId?: string | null;
  editingGroupId?: string | null;
  onSelectSegment: (wordId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup?: (groupId: string) => void;
  /** Called when the user clicks the connector dot on an existing group chip,
   *  selecting that group (by its groupId) as an RST endpoint. */
  onSelectGroup?: (groupId: string) => void;
  customTypes?: RstTypeEntry[];
  /** When true (unlinked mode, translation side active), selector dots are
   *  placed in the translation column rather than the source column. */
  editingTranslation?: boolean;
  /** When true, source-side RST arrows are hidden (source text is not visible). */
  hideSourceTree?: boolean;
  /** Extra element to watch for size changes (e.g. the flex-1 wrapper that shrinks
   *  when a sidebar opens). Triggers remeasurement without affecting coordinates. */
  layoutRef?: RefObject<HTMLDivElement | null>;
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
    // Indentation on the translation column lives on the first <p> inside the
    // translation div, not on the div itself — read padding from that element.
    const transPEl   = transEl?.querySelector("p");
    const transPCs   = transPEl ? getComputedStyle(transPEl) : null;
    const transPadL  = transPCs ? (parseFloat(transPCs.paddingLeft) || 0) : 0;
    const transLeftX = transEl
      ? transEl.getBoundingClientRect().left - cRect.left + transPadL
      : undefined;

    // Measure the source grid-cell div.  Its padding carries the paragraph
    // indentation (paddingLeft for LTR, paddingRight for Hebrew RTL), so we
    // read leftX/rightX from it rather than from the inner text span (which
    // has no padding of its own and therefore always reports the same position
    // regardless of indentation level).
    const srcBlockEl = container.querySelector<HTMLElement>(
      `[data-rst-src-block="${CSS.escape(id)}"]`,
    );
    const srcBlockR    = srcBlockEl?.getBoundingClientRect() ?? null;
    // srcCellRightX = raw border-box right (used as stable column boundary in 3-col).
    const srcCellRightX = srcBlockR ? srcBlockR.right - cRect.left : undefined;

    // Hebrew 2-col: measure the verse-label left edge so the tree stays clear of it.
    const labelEl = container.querySelector<HTMLElement>(
      `[data-seg-label="${CSS.escape(id)}"]`,
    );
    const labelLeftX = labelEl
      ? labelEl.getBoundingClientRect().left - cRect.left
      : undefined;

    // Read indentation padding from the source-block element (which carries it).
    // Fall back to the text span when srcBlockEl is unavailable.
    const posEl  = srcBlockEl ?? textEl;
    const posR   = srcBlockR  ?? textR;
    const cs     = getComputedStyle(posEl);
    const padLeft  = parseFloat(cs.paddingLeft)  || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;

    result.set(id, {
      top:       anchorTop    - cRect.top + scrollTop,
      bottom:    anchorBottom - cRect.top + scrollTop,
      leftX:     posR.left  - cRect.left + padLeft,
      rightX:    posR.right - cRect.left - padRight,
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
  tvRelations: RstRelation[] | undefined,
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
    // Hebrew 3-col: each paragraph has its own independent grid, so srcCellRightX
    // varies per row.  Normalise using refSrcCellRightX as a stable baseline:
    //   anchor = refSrcCellRightX - srcPadRight + LEAF_MARGIN
    // where srcPadRight = srcCellRightX - rightX = the paddingRight on the source
    // block div.  Unindented segments → refSrcCellRightX + LEAF_MARGIN (constant).
    // Indented segments → that value minus their padding (proportionally shorter arm).
    for (const node of src.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos?.srcCellRightX !== undefined) {
          const srcPadRight = pos.srcCellRightX - pos.rightX;
          node.x = refSrcCellRightX - srcPadRight + LEAF_MARGIN;
        }
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
  // When tvRelations is provided (unlinked mode) it has its own structure;
  // otherwise the translation column mirrors the source tree exactly.
  let trans: { nodes: LayoutNode[]; links: LayoutLink[] } = { nodes: [], links: [] };
  if (hasTransMeasured && yMapTrans.size > 0) {
    const tvRels = tvRelations ?? relations;
    const treeRootTrans = buildRstTree(tvRels, paragraphFirstWordIds);
    trans = flattenHierarchy(treeRootTrans, yMapTrans, transXFn, true);
    for (const node of trans.nodes) {
      if (node.type === "segment") {
        const pos = posMap.get(node.id);
        if (pos?.transLeftX !== undefined) {
          // transLeftX already includes paddingLeft of the translation <p>,
          // so transLeftX - LEAF_MARGIN lands at a consistent offset from the
          // actual text-start edge for both Hebrew 3-col and LTR layouts.
          node.x = pos.transLeftX - LEAF_MARGIN;
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
  tvRelations,
  containerRef,
  isHebrew,
  hasTranslation,
  editing,
  paragraphFirstWordIds,
  selectedNucleusWordId,
  selectedSatelliteWordId,
  selectedNucleusGroupId,
  editingGroupId,
  onSelectSegment,
  onDeleteGroup,
  onEditGroup,
  onSelectGroup,
  customTypes = [],
  editingTranslation = false,
  hideSourceTree = false,
  layoutRef,
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
      ...(tvRelations ?? []).map(r => r.segWordId),
      ...(editing ? paragraphFirstWordIds : []),
    ]),
  ];

  const scheduleRemeasure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const newPos           = measureSegments(allSegIds, container);
      const { nodes, links } = layoutTree(relations, tvRelations, paragraphFirstWordIds, newPos, isHebrew, hasTranslation);
      setPosMap(newPos);
      setSvgH(container.scrollHeight);
      setLayoutNodes(nodes);
      setLayoutLinks(links);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations, tvRelations, containerRef, isHebrew, hasTranslation, editing, paragraphFirstWordIds.join(",")]);

  useLayoutEffect(() => {
    scheduleRemeasure();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(scheduleRemeasure);
    ro.observe(container);
    // Also observe the layout wrapper (e.g. the flex-1 div that shrinks when a
    // sidebar opens) so we remeasure even if `container` doesn't directly report
    // a size change due to overflow constraints.
    if (layoutRef?.current && layoutRef.current !== container) {
      ro.observe(layoutRef.current);
    }
    const mo = new MutationObserver(scheduleRemeasure);
    mo.observe(container, { childList: true, subtree: true, attributes: false });
    container.addEventListener("scroll", scheduleRemeasure, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      container.removeEventListener("scroll", scheduleRemeasure);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleRemeasure, containerRef, layoutRef]);

  if (!svgH) return null;

  const NUCLEUS_R = 5;
  const SAT_R     = 4;
  const SEG_R     = 3.5;

  const relatedSegIds   = new Set(relations.map(r => r.segWordId));
  const tvRelatedSegIds = new Set((tvRelations ?? []).map(r => r.segWordId));

  const groupNodes = layoutNodes.filter(n => n.type === "group");

  // Which group chip shows the selection ring.
  // • selectedNucleusGroupId (explicit): user clicked a group connector dot —
  //   show ONLY the group ring; the underlying paragraph dot is suppressed.
  // • Derived fallback: user clicked a paragraph dot that happens to be the
  //   nucleus of a group — show the group ring AND the paragraph dot.
  const selectedGroupId: string | null = selectedNucleusGroupId
    ?? (selectedNucleusWordId
      ? (relations.find(r => r.segWordId === selectedNucleusWordId && r.role === "nucleus")?.groupId ?? null)
      : null);

  // Paragraph segWordIds that belong to the explicitly-selected group.
  // Their selector dots are suppressed so only the group chip glows.
  const suppressedDotIds: Set<string> = selectedNucleusGroupId
    ? new Set(
        relations
          .filter(r => r.groupId === selectedNucleusGroupId)
          .map(r => r.segWordId),
      )
    : new Set();

  // ── Pre-compute per-group spine X ─────────────────────────────────────────
  // The spine is placed LEVEL_WIDTH beyond the *innermost* leaf in the group
  // (innermost = closest to the margin, i.e. furthest from the text):
  //   LTR / translation  →  smallest  x2  →  spine to the left
  //   Hebrew source (RTL) →  largest   x2  →  spine to the right
  //
  // Two-pass approach: lk.x2 for group children is depth-based (xFn) and
  // becomes stale when leaves are overridden for indentation. Pass 1 computes
  // correct spines for leaf-only groups; pass 2 uses those to fix spines of
  // groups that have group children (e.g. Purpose → Sequence → indented leaves).
  function computeSpinePass(prevSpines: Map<string, number>): Map<string, number> {
    const inner = new Map<string, number>();
    for (const lk of layoutLinks) {
      const key       = `${lk.parentId}:${lk.isTrans ? 1 : 0}`;
      const childKey  = `${lk.childId}:${lk.isTrans ? 1 : 0}`;
      const isRtlSrc  = isHebrew && !lk.isTrans;
      const effectiveX2 = prevSpines.get(childKey) ?? lk.x2;
      const cur       = inner.get(key);
      inner.set(key, cur === undefined ? effectiveX2 : (isRtlSrc ? Math.max(cur, effectiveX2) : Math.min(cur, effectiveX2)));
    }
    for (const [key, innerX] of inner) {
      const isRtlSrc = key.endsWith(":0") && isHebrew;
      inner.set(key, isRtlSrc ? innerX + LEVEL_WIDTH : innerX - LEVEL_WIDTH);
    }
    return inner;
  }
  const spinePass1     = computeSpinePass(new Map());
  const spineXByParent = computeSpinePass(spinePass1);

  // ── Subordinate group nucleus-X lookup ───────────────────────────────────
  // Subordinate relations are drawn as an L-shape: a vertical stroke runs from
  // the nucleus leaf position down (or up) to the satellite's Y, then a
  // horizontal arm extends to the satellite anchor.  This is visually distinct
  // from the shared-spine bracket used for coordinate relations and prevents
  // all subordinate arrows from overlapping on one vertical line.
  //
  // For each subordinate group we record the nucleus leaf X so that both the
  // satellite link path and the relation-type chip can use it.
  const nucleusXByGroup = new Map<string, number>(); // `groupId:isTrans` → nucleusX
  // Subordinate groups whose nucleus is itself a coordinate group (spans
  // multiple paragraphs).  These use a Z-shape path rather than an L-shape:
  //   H out from nucleus spine → V to satellite Y → H to satellite anchor
  const nucleusIsGroup  = new Set<string>();
  for (const lk of layoutLinks) {
    if (lk.role !== "nucleus") continue;
    if (relMap[lk.relType]?.category !== "subordinate") continue;
    const gKey = `${lk.parentId}:${lk.isTrans ? 1 : 0}`;
    const nucNode = layoutNodes.find(
      n => n.id === lk.childId && !!n.isTrans === !!lk.isTrans,
    );
    if (!nucNode) continue;
    // If the nucleus is itself a group node, use its spine; otherwise use the
    // leaf X that was set by the post-processing override in layoutTree.
    const nucChildKey = `${lk.childId}:${lk.isTrans ? 1 : 0}`;
    const nucX = nucNode.type === "group"
      ? (spineXByParent.get(nucChildKey) ?? nucNode.x)
      : nucNode.x;
    nucleusXByGroup.set(gKey, nucX);
    if (nucNode.type === "group") nucleusIsGroup.add(gKey);
  }

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 overflow-visible pointer-events-none z-10"
      style={{ width: "100%", height: svgH }}
      aria-hidden="true"
    >
      {/* ── Tree edges ────────────────────────────────────────────────────── */}
      {layoutLinks.filter(lk => !hideSourceTree || lk.isTrans).map((lk, i) => {
        const meta   = relMap[lk.relType];
        const color  = meta?.color ?? "#6B7280";
        const isSat  = lk.role === "satellite";
        const key    = `${lk.parentId}:${lk.isTrans ? 1 : 0}`;
        const spineX  = spineXByParent.get(key) ?? lk.x1;
        // If the child is itself a group, use its actual spine as the arm endpoint
        // (lk.x2 for group children is depth-based and becomes stale after leaf
        // positions are overridden for indentation).
        const childSpineKey = `${lk.childId}:${lk.isTrans ? 1 : 0}`;
        const childSpineX   = spineXByParent.get(childSpineKey);
        const armX2         = childSpineX !== undefined ? childSpineX : lk.x2;

        // Subordinate relations avoid the shared-spine bracket:
        //   • Nucleus link  → not drawn (the nucleus dot anchors it visually)
        //   • Satellite link:
        //       – Nucleus is a single segment → L-shape:
        //           V from nucleus Y to satellite Y, then H to satellite anchor
        //       – Nucleus is a coordinate group → Z-shape:
        //           H out from nucleus spine, V to satellite Y, H to satellite anchor
        const isSubordinate = meta?.category === "subordinate";
        if (isSubordinate && !isSat) return null;

        let pathD: string;
        if (isSubordinate) {
          const nucX = nucleusXByGroup.get(key) ?? spineX;
          if (nucleusIsGroup.has(key)) {
            const outerX = (isHebrew && !lk.isTrans)
              ? nucX + LEVEL_WIDTH
              : nucX - LEVEL_WIDTH;
            pathD = `M ${nucX},${lk.y1} H ${outerX} V ${lk.y2} H ${armX2}`;
          } else {
            pathD = `M ${nucX},${lk.y1} V ${lk.y2} H ${armX2}`;
          }
        } else {
          pathD = `M ${spineX},${lk.y1} V ${lk.y2} H ${armX2}`;
        }
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
      })}

      {/* ── Group nodes (relation-type chips) ─────────────────────────────── */}
      {groupNodes.filter(n => !hideSourceTree || n.isTrans).map((n, i) => {
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

        const satLink = layoutLinks.find(
          lk => lk.parentId === n.id && lk.role === "satellite" && !!lk.isTrans === !!n.isTrans
        );

        // ── Chip X ───────────────────────────────────────────────────────
        // Coordinate relations: chip sits on the text-facing side of the
        // shared spine (right for LTR, left for RTL), 2 px clear of the stroke.
        // Subordinate relations: no spine — chip is centred at the nucleus leaf
        // X (the corner of the L-shaped path) so it sits visually on the elbow.
        const CHIP_GAP = 2;
        const spineKey = `${n.id}:${n.isTrans ? 1 : 0}`;
        const spineX   = spineXByParent.get(spineKey);
        const isSubordGroup = relMap[n.relType ?? ""]?.category === "subordinate";
        const subNucX = isSubordGroup ? nucleusXByGroup.get(spineKey) : undefined;
        // Z-shape: chip sits near the *second* corner (outerX, satelliteY).
        // L-shape: chip sits near the single corner (subNucX, satelliteY).
        const subOuterX = (subNucX !== undefined && nucleusIsGroup.has(spineKey))
          ? (isHebrew && !n.isTrans) ? subNucX + LEVEL_WIDTH : subNucX - LEVEL_WIDTH
          : undefined;
        const subCornerX = subOuterX ?? subNucX; // effective corner for chip placement
        const chipX    = subCornerX !== undefined
          ? (isHebrew && !n.isTrans)
            ? subCornerX - CHIP_W / 2 - CHIP_GAP
            : subCornerX + CHIP_W / 2 + CHIP_GAP
          : spineX !== undefined
            ? (isHebrew && !n.isTrans)
              ? spineX - CHIP_W / 2 - CHIP_GAP   // RTL: chip left of spine
              : spineX + CHIP_W / 2 + CHIP_GAP   // LTR: chip right of spine
            : (isHebrew && !n.isTrans)            // fallback if spine unavailable
              ? n.x - LEVEL_WIDTH
              : n.x + LEVEL_WIDTH;

        // ── Chip Y positions ──────────────────────────────────────────────
        // Subordinate chips float above/below their satellite arm (one chip).
        // Coordinate chips (no satellite) place one chip at the vertical
        // midpoint of each spine segment between adjacent arm Y values —
        // keeping them out of the text and clearly marking each segment.
        const CHIP_GAP_Y = 3;
        const chipYs: number[] = (() => {
          if (satLink) {
            if (subNucX !== undefined) {
              // Subordinate L-shape: chip floats just above/below the 90° corner
              // where the vertical stroke meets the horizontal arm (satelliteY).
              const satelliteIsLower = satLink.y2 > satLink.y1;
              return [satelliteIsLower
                ? satLink.y2 - CHIP_H / 2 - CHIP_GAP_Y   // corner below → chip above it
                : satLink.y2 + CHIP_H / 2 + CHIP_GAP_Y]; // corner above → chip below it
            }
            const satelliteIsLower = satLink.y2 > satLink.y1;
            return [satelliteIsLower
              ? satLink.y2 - CHIP_H / 2 - CHIP_GAP_Y   // float above arm
              : satLink.y2 + CHIP_H / 2 + CHIP_GAP_Y]; // float below arm
          }
          // Coordinate: gather every Y that an arm touches on the spine,
          // sort them, and place a chip at the midpoint of each consecutive pair.
          const groupLinks = layoutLinks.filter(
            lk => lk.parentId === n.id && !!lk.isTrans === !!n.isTrans
          );
          const ySet = new Set<number>();
          for (const lk of groupLinks) { ySet.add(lk.y1); ySet.add(lk.y2); }
          const sortedYs = [...ySet].sort((a, b) => a - b);
          if (sortedYs.length < 2) return [n.y];
          const mids: number[] = [];
          for (let j = 0; j < sortedYs.length - 1; j++)
            mids.push((sortedYs[j] + sortedYs[j + 1]) / 2);
          return mids;
        })();

        // Primary Y: first chip — anchors delete button and connector dot.
        const primaryChipY = chipYs[0];

        // Connector dot: tree-facing (outer) side of chip.
        const connDotX = (isHebrew && !n.isTrans)
          ? chipX + CHIP_W / 2 + 7   // RTL: dot to the right of chip (away from text)
          : chipX - CHIP_W / 2 - 7;  // LTR: dot to the left of chip (away from text)

        return (
          <g
            key={`${n.id}-${i}`}
            onMouseEnter={() => isInteractive && setHoveredGroup(n.id)}
            onMouseLeave={() => isInteractive && setHoveredGroup(null)}
            style={{ pointerEvents: isInteractive ? "all" : "none" }}
          >
            {/* Rings and chip pills — one per Y position */}
            {chipYs.map((chipY, yi) => (
              <g key={yi}>
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
              </g>
            ))}

            {/* Delete button — anchored to primary (first) chip */}
            {isInteractive && isHovered && (
              <g
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={e => { e.stopPropagation(); onDeleteGroup(n.id); }}
              >
                <circle cx={chipX + CHIP_W / 2} cy={primaryChipY - CHIP_H / 2} r={6} fill="#DC2626" />
                <text
                  x={chipX + CHIP_W / 2} y={primaryChipY - CHIP_H / 2 + 4}
                  textAnchor="middle" fill="white" fontSize={9} fontFamily="sans-serif"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >×</text>
              </g>
            )}

            {/* Connector dot — anchored to primary (first) chip */}
            {editing && !n.isTrans && onSelectGroup && (
              <circle
                cx={connDotX} cy={primaryChipY} r={SEG_R}
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

      {/* ── Segment anchor dots ─────────────────────────────────────────── */}
      {/* Non-editing: solid colored dots for relation-connected paragraphs. */}
      {/* Editing: interactive dots for all paragraphs.                     */}
      {(() => {
        const refTransLeftX = hasTranslation
          ? [...posMap.values()].find(p => p.transLeftX !== undefined)?.transLeftX
          : undefined;

        // When not editing, only show dots for paragraphs in relations.
        const visibleIds = editing
          ? paragraphFirstWordIds
          : paragraphFirstWordIds.filter(id => relatedSegIds.has(id) || tvRelatedSegIds.has(id));

        return visibleIds.flatMap(wordId => {
          const pos = posMap.get(wordId);
          if (!pos) return [];

          const suppressedByGroup = suppressedDotIds.has(wordId);
          const isNucleus   = wordId === selectedNucleusWordId && !suppressedByGroup;
          const isSatellite = wordId === selectedSatelliteWordId;

          let r: number, fill: string, stroke: string, sw: number;
          if (editing) {
            r      = isNucleus ? NUCLEUS_R : isSatellite ? SAT_R : SEG_R;
            fill   = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "transparent";
            stroke = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "#94A3B8";
            sw     = isNucleus || isSatellite ? 0 : 1.5;
          } else {
            // Solid dot colored by this segment's role in its relation.
            const srcRole = relations.find(rel => rel.segWordId === wordId)?.role;
            const dotColor = srcRole === "nucleus" ? "#7C3AED" : "#F59E0B";
            r = SEG_R; fill = dotColor; stroke = dotColor; sw = 0;
          }

          const dotY    = pos.top + (pos.bottom - pos.top) / 2;
          const srcDotX = isHebrew
            ? pos.rightX + LEAF_MARGIN
            : pos.leftX - LEAF_MARGIN;

          const dots: React.ReactElement[] = [];

          if (!hideSourceTree || editing) {
            dots.push(
              <circle
                key={`${wordId}-src`}
                cx={srcDotX} cy={dotY} r={r}
                fill={fill} stroke={stroke} strokeWidth={sw}
                style={editing
                  ? { cursor: "pointer", pointerEvents: "all" }
                  : { pointerEvents: "none" }}
                onClick={editing ? (e) => { e.stopPropagation(); onSelectSegment(wordId); } : undefined}
              />
            );
          }

          if (hasTranslation) {
            const txLeft = pos.transLeftX ?? refTransLeftX;
            if (txLeft !== undefined) {
              const tvRole = (tvRelations ?? relations).find(rel => rel.segWordId === wordId)?.role;
              const tvColor = editing
                ? fill
                : (tvRole === "nucleus" ? "#7C3AED" : "#F59E0B");
              dots.push(
                <circle
                  key={`${wordId}-trans`}
                  cx={txLeft - LEAF_MARGIN} cy={dotY} r={r}
                  fill={tvColor} stroke={editing ? stroke : tvColor} strokeWidth={sw}
                  style={editing
                    ? { cursor: "pointer", pointerEvents: "all" }
                    : { pointerEvents: "none" }}
                  onClick={editing ? (e) => { e.stopPropagation(); onSelectSegment(wordId); } : undefined}
                />
              );
            }
          }

          return dots;
        });
      })()}
    </svg>
  );
}
