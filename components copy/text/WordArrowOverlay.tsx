"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WordArrow } from "@/lib/db/schema";

interface WordRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawnArrow {
  arrow: WordArrow;
  fromR: WordRect;
  toR: WordRect;
}

interface Props {
  arrows: WordArrow[];
  containerRef: RefObject<HTMLDivElement | null>; // scrollable inner div — for DOM queries
  outerRef?:    RefObject<HTMLDivElement | null>; // non-clipping outer wrapper — for SVG coordinates; falls back to containerRef
  /** Extra element to watch for size changes (e.g. the flex-1 wrapper that shrinks
   *  when a sidebar opens). Triggers remeasurement without affecting coordinates. */
  layoutRef?:   RefObject<HTMLDivElement | null>;
  editing: boolean;
  selectedFromWordId: string | null;
  onDeleteArrow: (id: number) => void;
  isHebrew?: boolean; // true → RTL text; routes gutter to the right of words
}

function getWordRect(
  wordId: string,
  innerContainer: HTMLElement, // used for querySelector
  outerContainer: HTMLElement, // used for coordinate origin
): WordRect | null {
  const el = innerContainer.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  if (!el) return null;
  const elRect = el.getBoundingClientRect();
  const oRect  = outerContainer.getBoundingClientRect();
  return {
    // Add scrollLeft/scrollTop so the result is in the outerContainer's scroll-canvas
    // coordinate space (not viewport space). When outerRef is non-scrollable (ChapterDisplay)
    // these are 0 and the formula is unchanged. When outerRef IS the scrollable container
    // (PassageView) we need the offset to keep arrows anchored to words after scrolling.
    x:      elRect.left - oRect.left + outerContainer.scrollLeft,
    y:      elRect.top  - oRect.top  + outerContainer.scrollTop,
    width:  elRect.width,
    height: elRect.height,
  };
}

/** Cubic bezier midpoint at t=0.5 */
function bezierMid(
  x0: number, y0: number,
  cx0: number, cy0: number,
  cx1: number, cy1: number,
  x1: number, y1: number
): [number, number] {
  const t = 0.5;
  const mt = 1 - t;
  const x = mt * mt * mt * x0 + 3 * mt * mt * t * cx0 + 3 * mt * t * t * cx1 + t * t * t * x1;
  const y = mt * mt * mt * y0 + 3 * mt * mt * t * cy0 + 3 * mt * t * t * cy1 + t * t * t * y1;
  return [x, y];
}

const ARROW_COLOR = "#64748B"; // slate-500

/**
 * How far (px) past the nearest word edge the gutter routing dips before
 * turning to travel vertically. Should be ≤ the verse-label column width so
 * the arc stays inside the label column rather than overflowing to the left.
 */
const GUTTER_REACH = 28;

export default function WordArrowOverlay({
  arrows,
  containerRef,
  outerRef,
  layoutRef,
  editing,
  selectedFromWordId,
  onDeleteArrow,
  isHebrew = false,
}: Props) {
  const [drawn, setDrawn]         = useState<DrawnArrow[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);

  // When no outerRef is provided (e.g. PassageView), use containerRef as the
  // coordinate origin — getBoundingClientRect() is still viewport-relative.
  const effectiveOuterRef = outerRef ?? containerRef;

  function measure() {
    const container = containerRef.current;      // scrollable div — for DOM queries
    const outer     = effectiveOuterRef.current; // coordinate origin wrapper
    if (!container || !outer) return;

    // Use scrollHeight when the SVG lives inside the scrollable container (PassageView),
    // otherwise clientHeight is sufficient (ChapterDisplay, where outerRef doesn't scroll).
    setSvgHeight(outer.scrollHeight > outer.clientHeight ? outer.scrollHeight : outer.clientHeight);

    const newDrawn: DrawnArrow[] = [];
    for (const arrow of arrows) {
      const fromR = getWordRect(arrow.fromWordId, container, outer);
      const toR   = getWordRect(arrow.toWordId,   container, outer);
      if (fromR && toR) newDrawn.push({ arrow, fromR, toR });
    }
    setDrawn(newDrawn);
  }

  useLayoutEffect(() => {
    function scheduleMeasure() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(measure);
    }

    scheduleMeasure();

    const container = containerRef.current;
    const outer     = effectiveOuterRef.current;
    if (!container || !outer) {
      return () => {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
      };
    }

    // Observe container for resize — e.g. window resize changes word positions.
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(outer);
    // Also observe the layout wrapper (e.g. the flex-1 div that shrinks when a
    // sidebar opens). This ensures remeasurement even if `outer` doesn't directly
    // report a size change due to overflow constraints.
    if (layoutRef?.current && layoutRef.current !== outer) {
      ro.observe(layoutRef.current);
    }

    // Re-measure when DOM content changes — e.g. translation toggled on/off shifts
    // source words from a single-column layout to a 5-column grid layout.
    const mo = new MutationObserver(scheduleMeasure);
    mo.observe(container, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrows, containerRef, effectiveOuterRef, layoutRef]);

  if (svgHeight === 0) return null;

  const markerId = "word-arrow-head";

  return (
    <svg
      style={{
        position:      "absolute",
        top:           0,
        left:          0,
        width:         "100%",
        height:        svgHeight,
        pointerEvents: "none",
        overflow:      "visible",
        zIndex:        4,
      }}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth={7}
          markerHeight={7}
          refX={3.5}
          refY={3.5}
          orient="auto"
        >
          <path d="M0,1 L7,3.5 L0,6 Z" fill={ARROW_COLOR} opacity={0.7} />
        </marker>
      </defs>

      {drawn.map(({ arrow, fromR, toR }) => {
        const fromCY = fromR.y + fromR.height / 2;
        const toCY   = toR.y  + toR.height  / 2;

        // Arrows between words on the same line arc downward below the text —
        // this avoids the curve overlapping the words themselves.
        // Arrows spanning multiple lines are routed through the side gutter so
        // they don't pass through intermediate lines of text.
        const sameLine = Math.abs(fromCY - toCY) < fromR.height * 0.75;

        let d: string;
        let midX: number, midY: number;
        let labelDy: number, handleDy: number;

        if (sameLine) {
          // ── Below-line arc ──────────────────────────────────────────────
          // Anchors at the bottom edge of each word; control points pull down.
          const fromX = fromR.x + fromR.width / 2;
          const toX   = toR.x  + toR.width   / 2;
          const fromY = fromR.y + fromR.height + 3;
          const toY   = toR.y  + toR.height   + 3;
          const horizDist  = Math.abs(toX - fromX);
          const curveDepth = Math.max(horizDist * 0.35 + 20, 24);
          const cx0 = fromX, cy0 = fromY + curveDepth;
          const cx1 = toX,   cy1 = toY   + curveDepth;
          d = `M ${fromX} ${fromY} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${toX} ${toY}`;
          [midX, midY] = bezierMid(fromX, fromY, cx0, cy0, cx1, cy1, toX, toY);
          labelDy  = curveDepth / 2 + 8;
          handleDy = curveDepth / 2 + 2;
        } else {
          // ── Side-gutter C-elbow ──────────────────────────────────────────
          // Anchor at the gutter-side edge of each word (left for LTR, right for RTL),
          // at the word's vertical centre. Two control points at the same gutterX
          // create a horizontal exit → vertical travel → horizontal entry path that
          // never crosses the text content between the two words.
          const fromXEdge = isHebrew ? fromR.x + fromR.width : fromR.x;
          const toXEdge   = isHebrew ? toR.x  + toR.width   : toR.x;
          const gutterX   = isHebrew
            ? Math.max(fromXEdge, toXEdge) + GUTTER_REACH
            : Math.min(fromXEdge, toXEdge) - GUTTER_REACH;

          const cx0 = gutterX, cy0 = fromCY;
          const cx1 = gutterX, cy1 = toCY;
          d = `M ${fromXEdge} ${fromCY} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${toXEdge} ${toCY}`;
          [midX, midY] = bezierMid(fromXEdge, fromCY, cx0, cy0, cx1, cy1, toXEdge, toCY);
          // Label/handle sit just outside the gutter column, clear of all text
          labelDy  = -12;
          handleDy = 0;
        }

        const isHovered = hoveredId === arrow.id;

        return (
          <g key={arrow.id}>
            <path
              d={d}
              stroke={ARROW_COLOR}
              strokeWidth={isHovered ? 2 : 1.2}
              strokeOpacity={0.6}
              fill="none"
              markerEnd={`url(#${markerId})`}
            />

            {/* Optional label at midpoint */}
            {arrow.label && (
              <text
                x={midX}
                y={midY + labelDy}
                textAnchor="middle"
                fontSize={9}
                fill={ARROW_COLOR}
                opacity={0.8}
                style={{ userSelect: "none" }}
              >
                {arrow.label}
              </text>
            )}

            {/* Invisible hover target — rendered before delete handle so the
                handle sits on top in SVG z-order and receives clicks correctly */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth={12}
              fill="none"
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => setHoveredId(arrow.id)}
              onMouseLeave={() => setHoveredId(null)}
            />

            {/* Delete handle — rendered last so it is on top and intercepts
                clicks before the hover target can swallow them */}
            {(editing || isHovered) && (
              <g
                style={{ pointerEvents: "auto", cursor: "pointer", opacity: isHovered ? 1 : 0, transition: "opacity 0.15s" }}
                onMouseEnter={() => setHoveredId(arrow.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onDeleteArrow(arrow.id)}
              >
                <circle cx={midX} cy={midY + handleDy} r={7} fill="white" stroke={ARROW_COLOR} strokeOpacity={0.7} strokeWidth={1.5} />
                <text x={midX} y={midY + handleDy + 4} textAnchor="middle" fontSize={10} fill={ARROW_COLOR} opacity={0.8} style={{ userSelect: "none" }}>×</text>
              </g>
            )}
          </g>
        );
      })}

      {/* Highlight selected "from" word with a small indicator in the gutter */}
      {editing && selectedFromWordId && (() => {
        const container = containerRef.current;
        const outer     = effectiveOuterRef.current;
        if (!container || !outer) return null;
        const r = getWordRect(selectedFromWordId, container, outer);
        if (!r) return null;
        // Place the dot in the gutter, aligned with the word's vertical centre
        const dotX = isHebrew ? r.x + r.width + GUTTER_REACH / 2 : r.x - GUTTER_REACH / 2;
        const dotY = r.y + r.height / 2;
        return (
          <circle
            cx={dotX}
            cy={dotY}
            r={4}
            fill={ARROW_COLOR}
            opacity={0.8}
          />
        );
      })()}
    </svg>
  );
}
