"use client";

import { useLayoutEffect, useEffect, useMemo, useRef, useState, useCallback, RefObject } from "react";
import { flushSync } from "react-dom";
import { hierarchy } from "d3-hierarchy";
import type { LineGroup } from "@/lib/db/schema";
import { buildLineGroupTree, type LineGroupNode } from "@/lib/lineGroups/buildLineGroupTree";
import { measureSegments, type SegPos } from "./measureSegments";

// ── Layout constants ──────────────────────────────────────────────────────────
// Deliberately narrower than RstRelationOverlay's LEVEL_WIDTH (18px) — brackets
// carry no chip/label, so nested levels only need enough room to read as
// visually distinct strokes, not to clear a text box.
const LEVEL_WIDTH  = 10;  // px per nesting depth level
const LEAF_MARGIN   = 7;  // px between a line's text edge and its innermost bracket
const TICK_LEN      = 4;  // px — length of the bracket's top/bottom end-caps
const GUTTER_MIN    = 24; // px — minimum gutter reserved even with no groups yet

interface BracketNode {
  id: string;
  x: number;
  yTop: number;
  yBottom: number;
  isTrans: boolean;
  isGroup: boolean; // false = ungrouped leaf (selector dot only, no bracket)
  /** Nesting level (1 = innermost, a group of only plain lines). Only
   *  meaningful when isGroup is true — matches d3-hierarchy's node.height,
   *  shifted by +1 when showAutoLineBrackets reserves level 1 for the
   *  automatic per-line brackets. */
  level: number;
  /** True for the automatic "one bracket per poetic line" nodes (see
   *  showAutoLineBrackets) — always level 1. These have their own click
   *  behavior (toggle exclusion) instead of the real-group interactions
   *  (select/delete/connector-dot), since they aren't backed by a LineGroup
   *  DB row. */
  isAuto?: boolean;
  /** The plain segFirstWordId an auto-bracket node represents (its `id` is
   *  suffixed with "__auto" to stay unique in the node list). */
  segId?: string;
  /** True when this line is in excludedLineIds — rendered as a faint dashed
   *  "ghost" bracket (still clickable, to re-include) instead of a solid one. */
  isExcluded?: boolean;
}

export interface Props {
  groups: LineGroup[];
  containerRef: RefObject<HTMLDivElement | null>;
  isHebrew: boolean;
  hasTranslation: boolean;
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedSegA: string | null;
  selectedSegAGroupId?: string | null;
  /** Resolves the bracket stroke color for a given nesting level (1-indexed). */
  getColor: (level: number) => string;
  onSelectSegment: (wordId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  /** When true, draws one small bracket per entry in paragraphFirstWordIds
   *  automatically (no LineGroup DB row, not user-created) at level 1, and
   *  shifts every real group's bracket outward by one level so it nests
   *  outside these — used by the Poetry Notation tool's "bracket every
   *  poetic line" toggle. */
  showAutoLineBrackets?: boolean;
  /** Lines (segFirstWordIds) to render as excluded — e.g. superscriptions
   *  like Psalm 29:1a — when showAutoLineBrackets is on. */
  excludedLineIds?: Set<string>;
  /** Fired when the user clicks an auto-bracket (included or excluded) to
   *  toggle that line's exclusion. */
  onToggleLineBracketExclusion?: (segFirstWordId: string) => void;
  layoutRef?: RefObject<HTMLDivElement | null>;
  /** Fired whenever the minimum column gap (px) needed between the verse-label
   *  column and the source-text column changes — mirrors RstRelationOverlay's
   *  onRequiredSourcePad so the parent can combine both into one grid gap. */
  onRequiredSourcePad?: (pad: number) => void;
}

export default function LineGroupOverlay({
  groups,
  containerRef,
  isHebrew,
  hasTranslation,
  editing,
  paragraphFirstWordIds,
  selectedSegA,
  selectedSegAGroupId = null,
  getColor,
  onSelectSegment,
  onSelectGroup,
  onDeleteGroup,
  showAutoLineBrackets = false,
  excludedLineIds,
  onToggleLineBracketExclusion,
  layoutRef,
  onRequiredSourcePad,
}: Props) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number | null>(null);
  const [svgH, setSvgH]           = useState(0);
  const [brackets, setBrackets]   = useState<BracketNode[]>([]);
  const [posMap, setPosMap]       = useState<Map<string, SegPos>>(new Map());
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const tree = useMemo(
    () => buildLineGroupTree(groups, paragraphFirstWordIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, paragraphFirstWordIds.join(",")]
  );

  // ── Required gutter (based on tree depth) ────────────────────────────────
  const extraLevel = showAutoLineBrackets ? 1 : 0;
  const [requiredLtrGutter, requiredHebGutter, requiredSourcePad] = useMemo(() => {
    const h = hierarchy(tree, (n: LineGroupNode) => n.children);
    const depth = Math.max(h.height, 1) + extraLevel;
    const needed = LEAF_MARGIN + depth * LEVEL_WIDTH + TICK_LEN + 8;
    const sourcePad = (groups.length > 0 || showAutoLineBrackets)
      ? Math.max(0, LEAF_MARGIN + (depth - 1) * LEVEL_WIDTH + TICK_LEN + 8)
      : 0;
    return [Math.max(GUTTER_MIN, needed), needed, sourcePad];
  }, [tree, groups.length, extraLevel, showAutoLineBrackets]);

  useEffect(() => {
    onRequiredSourcePad?.(requiredSourcePad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredSourcePad]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || isHebrew) return;
    const prev = container.style.paddingLeft;
    const merged = Math.max(requiredLtrGutter, parseFloat(prev) || 0);
    container.style.paddingLeft = `${merged}px`;
    return () => { container.style.paddingLeft = prev; };
  }, [containerRef, isHebrew, hasTranslation, requiredLtrGutter]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !isHebrew || hasTranslation || groups.length === 0) return;
    const prev = container.style.paddingRight;
    const merged = Math.max(requiredHebGutter, parseFloat(prev) || 0);
    container.style.paddingRight = `${merged}px`;
    return () => { container.style.paddingRight = prev; };
  }, [containerRef, isHebrew, hasTranslation, groups.length, requiredHebGutter]);

  const allSegIds = [
    ...new Set([
      ...groups.map(g => g.memberId).filter(id => paragraphFirstWordIds.includes(id)),
      ...(editing || showAutoLineBrackets ? paragraphFirstWordIds : []),
    ]),
  ];

  const layout = useCallback((posArg: Map<string, SegPos>): BracketNode[] => {
    const hier = hierarchy(tree, (n: LineGroupNode) => n.children);
    // Reserves the innermost slot (level 1) for the automatic per-line
    // brackets below, pushing every real group's position AND color level
    // outward by one so it visually nests outside them.
    const maxDepth = Math.max(hier.height, 1) + extraLevel;

    let refLeftX = Infinity, refRightX = -Infinity;
    for (const pos of posArg.values()) {
      refLeftX  = Math.min(refLeftX, pos.leftX);
      refRightX = Math.max(refRightX, pos.rightX);
    }
    if (!isFinite(refLeftX))  refLeftX  = 32;
    if (!isFinite(refRightX)) refRightX = refLeftX + 32;

    let refTransLeftX = Infinity;
    for (const pos of posArg.values()) if (pos.transLeftX !== undefined) refTransLeftX = Math.min(refTransLeftX, pos.transLeftX);
    const hasTransMeasured = isFinite(refTransLeftX);

    let refSrcCellRightX = -Infinity;
    for (const pos of posArg.values()) if (pos.srcCellRightX !== undefined) refSrcCellRightX = Math.max(refSrcCellRightX, pos.srcCellRightX);
    const use3Col = hasTranslation && isFinite(refSrcCellRightX) && isHebrew;

    let hebrewLabelBound = Infinity;
    for (const pos of posArg.values()) if (pos.labelLeftX !== undefined) hebrewLabelBound = Math.min(hebrewLabelBound, pos.labelLeftX);
    const hasLabelBound = use3Col && isFinite(hebrewLabelBound);

    const srcXFn = use3Col
      ? (d: number) => (refSrcCellRightX + LEAF_MARGIN) + (maxDepth - d) * LEVEL_WIDTH
      : isHebrew
        ? (d: number) => {
            const x = (refRightX + LEAF_MARGIN) + (maxDepth - d) * LEVEL_WIDTH;
            return hasLabelBound ? Math.min(x, hebrewLabelBound - 4) : x;
          }
        : (d: number) => (refLeftX - LEAF_MARGIN) - (maxDepth - d) * LEVEL_WIDTH;
    const transXFn = (d: number) => (refTransLeftX - LEAF_MARGIN) - (maxDepth - d) * LEVEL_WIDTH;

    const out: BracketNode[] = [];

    hier.each(hNode => {
      const d = hNode.data;
      if (d.type === "root") return;

      const leafIds: string[] = d.type === "segment" ? [d.id] : hNode.leaves().map(l => l.data.id);
      const positions = leafIds.map(id => posArg.get(id)).filter((p): p is SegPos => !!p);
      if (!positions.length) return;
      const yTop    = Math.min(...positions.map(p => p.top));
      const yBottom = Math.max(...positions.map(p => p.bottom));
      // Translation side uses its own bottom edge — when 2+ translations wrap
      // a line onto more rows than its source, the mirrored bracket must
      // extend to the bottom of that wrapped text, not just the source's
      // (shorter) line height. Falls back to the source Y when a leaf has no
      // measured translation block.
      const yTopTrans    = Math.min(...positions.map(p => p.transTop    ?? p.top));
      const yBottomTrans = Math.max(...positions.map(p => p.transBottom ?? p.bottom));

      // ── Source-side node ──────────────────────────────────────────────
      let x = srcXFn(hNode.depth);
      if (d.type === "segment") {
        const pos = posArg.get(d.id);
        if (pos) {
          const raw = isHebrew ? pos.rightX + LEAF_MARGIN : pos.leftX - LEAF_MARGIN;
          x = (isHebrew && hasLabelBound) ? Math.min(raw, hebrewLabelBound - 4) : raw;
        }
      }
      out.push({ id: d.id, x, yTop, yBottom, isTrans: false, isGroup: d.type === "group", level: hNode.height + extraLevel });

      // ── Translation mirror node ─────────────────────────────────────────
      if (hasTransMeasured) {
        let txAll = positions.map(p => p.transLeftX).filter((v): v is number => v !== undefined);
        if (d.type === "segment") {
          const pos = posArg.get(d.id);
          if (pos?.transLeftX !== undefined) txAll = [pos.transLeftX];
        }
        if (txAll.length) {
          const tx = d.type === "segment" ? txAll[0] - LEAF_MARGIN : transXFn(hNode.depth);
          out.push({ id: d.id, x: tx, yTop: yTopTrans, yBottom: yBottomTrans, isTrans: true, isGroup: d.type === "group", level: hNode.height + extraLevel });
        }
      }
    });

    // ── Automatic "one bracket per poetic line" nodes (level 1) ────────────
    // Positioned via the SAME shared-reference-edge formula real group
    // brackets use (srcXFn/transXFn at the reserved level-1 slot), rather
    // than each line's own local text edge — real group gaps are always a
    // uniform LEVEL_WIDTH apart because every level shares one reference
    // edge (refRightX/refLeftX, the widest line in scope); anchoring the
    // auto bracket to that same edge is what makes ITS gap to the next
    // (real) level a uniform LEVEL_WIDTH too, instead of varying with how
    // much shorter each individual line is than the widest one. Mirrored
    // onto the translation column too, same as real groups.
    if (showAutoLineBrackets) {
      const autoX = srcXFn(maxDepth - 1);
      const autoTransX = hasTransMeasured ? transXFn(maxDepth - 1) : undefined;
      for (const segId of paragraphFirstWordIds) {
        const pos = posArg.get(segId);
        if (!pos) continue;
        const isExcluded = excludedLineIds?.has(segId) ?? false;
        out.push({ id: `${segId}__auto`, segId, x: autoX, yTop: pos.top, yBottom: pos.bottom, isTrans: false, isGroup: true, level: 1, isAuto: true, isExcluded });

        if (pos.transLeftX !== undefined && autoTransX !== undefined) {
          out.push({
            id: `${segId}__auto`,
            segId,
            x: autoTransX,
            yTop: pos.transTop ?? pos.top,
            yBottom: pos.transBottom ?? pos.bottom,
            isTrans: true,
            isGroup: true,
            level: 1,
            isAuto: true,
            isExcluded,
          });
        }
      }
    }

    return out;
  }, [tree, isHebrew, hasTranslation, showAutoLineBrackets, extraLevel, paragraphFirstWordIds, excludedLineIds]);

  const scheduleRemeasure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const newPos = measureSegments(allSegIds, container);
        setPosMap(newPos);
        setSvgH(container.scrollHeight);
        setBrackets(layout(newPos));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, containerRef, allSegIds.join(",")]);

  useLayoutEffect(() => {
    scheduleRemeasure();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(scheduleRemeasure);
    ro.observe(container);
    if (layoutRef?.current && layoutRef.current !== container) ro.observe(layoutRef.current);
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

  // ── Print re-measurement (mirrors RstRelationOverlay's handler set) ──────
  const printMeasureRef = useRef<() => void>(() => {});
  printMeasureRef.current = () => {
    const container = containerRef.current;
    if (!container) return;
    const newPos = measureSegments(allSegIds, container);
    flushSync(() => {
      setPosMap(newPos);
      setSvgH(container.scrollHeight);
      setBrackets(layout(newPos));
    });
  };
  const scheduleRemeasureRef = useRef<() => void>(() => {});
  scheduleRemeasureRef.current = scheduleRemeasure;

  useEffect(() => {
    const mql = window.matchMedia("print");
    function handlePrintMediaChange(e: MediaQueryListEvent) {
      if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      if (e.matches) printMeasureRef.current();
      else scheduleRemeasureRef.current();
    }
    function handlePrintPrepare() {
      if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      printMeasureRef.current();
    }
    function handleBeforePrint() {
      if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      printMeasureRef.current();
    }
    function handleScreenRemeasure() { scheduleRemeasureRef.current(); }

    mql.addEventListener("change", handlePrintMediaChange);
    window.addEventListener("structura:print-prepare", handlePrintPrepare);
    window.addEventListener("structura:screen-remeasure", handleScreenRemeasure);
    window.addEventListener("beforeprint", handleBeforePrint);
    return () => {
      mql.removeEventListener("change", handlePrintMediaChange);
      window.removeEventListener("structura:print-prepare", handlePrintPrepare);
      window.removeEventListener("structura:screen-remeasure", handleScreenRemeasure);
      window.removeEventListener("beforeprint", handleBeforePrint);
    };
  }, []);

  if (!svgH) return null;

  const DOT_R = 3.5;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 overflow-visible pointer-events-none z-10"
      style={{ width: "100%", height: svgH }}
      aria-hidden="true"
    >
      {/* ── Brackets ─────────────────────────────────────────────────────── */}
      {brackets.filter(b => b.isGroup).map((b) => {
        const ticksLeft = isHebrew && !b.isTrans;
        const tickDx = ticksLeft ? -TICK_LEN : TICK_LEN;
        const pathD = `M ${b.x + tickDx},${b.yTop} H ${b.x} V ${b.yBottom} H ${b.x + tickDx}`;

        if (b.isAuto) {
          const strokeColor = b.isExcluded ? "#9CA3AF" : getColor(1);
          return (
            <g key={`${b.id}-${b.isTrans ? 1 : 0}`}>
              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={1.5}
                strokeDasharray={b.isExcluded ? "3,3" : undefined}
                opacity={b.isTrans ? (b.isExcluded ? 0.35 : 0.55) : (b.isExcluded ? 0.45 : 0.85)}
                style={{ pointerEvents: "none" }}
              />
              {onToggleLineBracketExclusion && b.segId && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); onToggleLineBracketExclusion(b.segId!); }}
                >
                  <title>
                    {b.isExcluded
                      ? "Click to include this line in auto-brackets"
                      : "Click to exclude this line (e.g. a superscription) from auto-brackets"}
                  </title>
                </path>
              )}
            </g>
          );
        }

        const isHov = hoveredGroup === b.id;
        const isInteractive = editing && !b.isTrans && !b.isAuto;
        const isSelected = b.id === selectedSegAGroupId;
        const midY = (b.yTop + b.yBottom) / 2;
        // Outside the bracket stroke (opposite the tick direction, away from
        // the text) — not on the text-facing side, where it would otherwise
        // sit right on top of the line dots' own cluster (both computed from
        // roughly the same LEAF_MARGIN offset for a single-level bracket).
        const connDotX = ticksLeft ? b.x + 8 : b.x - 8;
        const strokeColor = getColor(b.level);

        return (
          <g
            key={`${b.id}-${b.isTrans ? 1 : 0}`}
            onMouseEnter={() => isInteractive && setHoveredGroup(b.id)}
            onMouseLeave={() => isInteractive && setHoveredGroup(null)}
          >
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={editing ? 2 : 1.5}
              opacity={b.isTrans ? 0.55 : 0.85}
              style={{ pointerEvents: "none" }}
            />
            {/* Transparent hit target for hover/delete */}
            {isInteractive && (
              <path d={pathD} fill="none" stroke="transparent" strokeWidth={10}
                    style={{ pointerEvents: "all", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onSelectGroup(b.id); }} />
            )}
            {isSelected && (
              <circle cx={b.x} cy={midY} r={5} fill="none" stroke="#7C3AED" strokeWidth={2} style={{ pointerEvents: "none" }} />
            )}
            {isInteractive && (
              <circle
                data-lg-connector={b.id}
                cx={connDotX} cy={midY} r={DOT_R}
                fill={isSelected ? "#7C3AED" : "transparent"}
                stroke={isSelected ? "#7C3AED" : "#94A3B8"}
                strokeWidth={1.5}
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={(e) => { e.stopPropagation(); onSelectGroup(b.id); }}
              />
            )}
            {isInteractive && isHov && (
              <g style={{ cursor: "pointer", pointerEvents: "all" }}
                 onClick={(e) => { e.stopPropagation(); onDeleteGroup(b.id); }}>
                <circle cx={b.x} cy={b.yTop - 8} r={7} fill="#DC2626" />
                <text x={b.x} y={b.yTop - 8 + 3.5} textAnchor="middle" fill="white" fontSize={9}
                      fontFamily="sans-serif" style={{ pointerEvents: "none", userSelect: "none" }}>×</text>
              </g>
            )}
          </g>
        );
      })}

      {/* ── Line (leaf) selector dots — editing mode, or read-only for grouped lines ── */}
      {(() => {
        const groupedIds = new Set(groups.map(g => g.memberId).filter(id => paragraphFirstWordIds.includes(id)));
        const visibleIds = editing ? paragraphFirstWordIds : paragraphFirstWordIds.filter(id => groupedIds.has(id));
        return visibleIds.flatMap(wordId => {
          const pos = posMap.get(wordId);
          if (!pos) return [];
          const isSelected = wordId === selectedSegA && !selectedSegAGroupId;
          const dotY = pos.top + (pos.bottom - pos.top) / 2;
          // Auto line-brackets now occupy the level-1 slot (LEAF_MARGIN +
          // LEVEL_WIDTH), leaving level 0 (LEAF_MARGIN) free for the dot —
          // no extra shift needed here regardless of extraLevel.
          const dotOffset = LEAF_MARGIN;
          const srcDotX = isHebrew ? pos.rightX + dotOffset : pos.leftX - dotOffset;
          const dots: React.ReactElement[] = [];
          if (editing) {
            dots.push(
              <circle key={`${wordId}-src`} data-lg-line={wordId} cx={srcDotX} cy={dotY} r={isSelected ? 5 : DOT_R}
                fill={isSelected ? "#7C3AED" : "transparent"}
                stroke={isSelected ? "#7C3AED" : "#94A3B8"} strokeWidth={isSelected ? 0 : 1.5}
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={(e) => { e.stopPropagation(); onSelectSegment(wordId); }}
              />
            );
          }
          return dots;
        });
      })()}
    </svg>
  );
}
