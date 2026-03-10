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
  editing: boolean;
  selectedFromWordId: string | null;
  onDeleteArrow: (id: number) => void;
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
    x:      elRect.left - oRect.left,
    y:      elRect.top  - oRect.top, // viewport-relative — no scrollTop needed
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

export default function WordArrowOverlay({
  arrows,
  containerRef,
  outerRef,
  editing,
  selectedFromWordId,
  onDeleteArrow,
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

    setSvgHeight(outer.clientHeight); // viewport height — SVG covers the visible area

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

    // Observe outer wrapper for resize
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(outer);

    // Re-measure on scroll so arrow positions follow scrolled content
    container.addEventListener("scroll", scheduleMeasure, { passive: true });

    return () => {
      ro.disconnect();
      container.removeEventListener("scroll", scheduleMeasure);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrows, containerRef, effectiveOuterRef]);

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
        const fromX = fromR.x + fromR.width  / 2;
        const fromY = fromR.y + fromR.height + 3; // 3px below word baseline
        const toX   = toR.x  + toR.width    / 2;
        const toY   = toR.y  + toR.height   + 3;

        // Curve depth scales with horizontal distance, minimum 20px
        const horizDist  = Math.abs(toX - fromX);
        const curveDepth = Math.max(horizDist * 0.35 + 20, 24);

        const cx0 = fromX;
        const cy0 = fromY + curveDepth;
        const cx1 = toX;
        const cy1 = toY + curveDepth;

        const d = `M ${fromX} ${fromY} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${toX} ${toY}`;
        const [midX, midY] = bezierMid(fromX, fromY, cx0, cy0, cx1, cy1, toX, toY);

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
                y={midY + curveDepth / 2 + 12}
                textAnchor="middle"
                fontSize={9}
                fill={ARROW_COLOR}
                opacity={0.8}
                style={{ userSelect: "none" }}
              >
                {arrow.label}
              </text>
            )}

            {/* Delete handle */}
            {(editing || isHovered) && (
              <g
                style={{ pointerEvents: "auto", cursor: "pointer", opacity: isHovered ? 1 : 0, transition: "opacity 0.15s" }}
                onMouseEnter={() => setHoveredId(arrow.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onDeleteArrow(arrow.id)}
              >
                <circle cx={midX} cy={midY + 10} r={7} fill="white" stroke={ARROW_COLOR} strokeOpacity={0.7} strokeWidth={1.5} />
                <text x={midX} y={midY + 14} textAnchor="middle" fontSize={10} fill={ARROW_COLOR} opacity={0.8} style={{ userSelect: "none" }}>×</text>
              </g>
            )}

            {/* Invisible hover target */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth={12}
              fill="none"
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => setHoveredId(arrow.id)}
              onMouseLeave={() => setHoveredId(null)}
            />
          </g>
        );
      })}

      {/* Highlight selected "from" word with a small indicator */}
      {editing && selectedFromWordId && (() => {
        const container = containerRef.current;
        const outer     = effectiveOuterRef.current;
        if (!container || !outer) return null;
        const r = getWordRect(selectedFromWordId, container, outer);
        if (!r) return null;
        return (
          <circle
            cx={r.x + r.width / 2}
            cy={r.y + r.height + 8}
            r={4}
            fill={ARROW_COLOR}
            opacity={0.8}
          />
        );
      })()}
    </svg>
  );
}
