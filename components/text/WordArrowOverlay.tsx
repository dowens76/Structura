"use client";

import { useLayoutEffect, useEffect, useRef, useState, type RefObject } from "react";
import type { WordArrow } from "@/lib/db/schema";
import type { ArrowPatch } from "@/lib/hooks/useWordArrows";

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
  containerRef: RefObject<HTMLDivElement | null>;
  outerRef?:    RefObject<HTMLDivElement | null>;
  layoutRef?:   RefObject<HTMLDivElement | null>;
  editing: boolean;
  selectedFromWordId: string | null;
  onDeleteArrow: (id: number) => void;
  onUpdateArrow?: (id: number, patch: ArrowPatch) => Promise<void>;
  isHebrew?: boolean;
}

// ── Drag state ─────────────────────────────────────────────────────────────────

type DragState =
  | {
      type: "midpoint";
      id: number;
      origDx: number;
      origDy: number;
      startClientX: number;
      startClientY: number;
      liveDx: number;
      liveDy: number;
    }
  | {
      type: "anchor";
      id: number;
      which: "from" | "to";
      clientX: number;
      clientY: number;
    }
  | null;

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_COLOR = "#64748B"; // slate-500
const ARROW_COLORS  = ["#64748B", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#A855F7"];
const GUTTER_REACH  = 28;

function effectiveColor(arrow: WordArrow): string {
  return arrow.color ?? DEFAULT_COLOR;
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

function getWordRect(
  wordId: string,
  innerContainer: HTMLElement,
  outerContainer: HTMLElement,
): WordRect | null {
  const el = innerContainer.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  if (!el) return null;
  const elRect = el.getBoundingClientRect();
  const oRect  = outerContainer.getBoundingClientRect();
  return {
    x:      elRect.left - oRect.left + outerContainer.scrollLeft,
    y:      elRect.top  - oRect.top  + outerContainer.scrollTop,
    width:  elRect.width,
    height: elRect.height,
  };
}

/** Cubic bezier point at parameter t */
function bezierPoint(
  x0: number, y0: number,
  cx0: number, cy0: number,
  cx1: number, cy1: number,
  x1: number, y1: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  const x = mt*mt*mt*x0 + 3*mt*mt*t*cx0 + 3*mt*t*t*cx1 + t*t*t*x1;
  const y = mt*mt*mt*y0 + 3*mt*mt*t*cy0 + 3*mt*t*t*cy1 + t*t*t*y1;
  return [x, y];
}

const bezierMid = (
  x0: number, y0: number,
  cx0: number, cy0: number,
  cx1: number, cy1: number,
  x1: number, y1: number,
) => bezierPoint(x0, y0, cx0, cy0, cx1, cy1, x1, y1, 0.5);

/**
 * Client-space coordinates → SVG / outer-container scroll-canvas coordinates.
 * Matches the same formula used in getWordRect.
 */
function clientToSvg(
  clientX: number,
  clientY: number,
  outer: HTMLElement,
): [number, number] {
  const r = outer.getBoundingClientRect();
  return [
    clientX - r.left + outer.scrollLeft,
    clientY - r.top  + outer.scrollTop,
  ];
}

// ── Arrow geometry computation ─────────────────────────────────────────────────

interface ArrowGeometry {
  d: string;
  midX: number;
  midY: number;
  handleDy: number;
  labelDy: number;
  fromAnchorX: number;
  fromAnchorY: number;
  toAnchorX: number;
  toAnchorY: number;
}

function computeArrowGeometry(
  arrow: WordArrow,
  fromR: WordRect,
  toR: WordRect,
  liveDx: number,
  liveDy: number,
  isHebrew: boolean,
): ArrowGeometry {
  const fromCY = fromR.y + fromR.height / 2;
  const toCY   = toR.y  + toR.height  / 2;
  const sameLine = Math.abs(fromCY - toCY) < fromR.height * 0.75;

  let d: string;
  let midX: number, midY: number;
  let handleDy: number, labelDy: number;

  if (sameLine) {
    // ── Below-line arc ────────────────────────────────────────────────────────
    // midpointDy shifts how deep the bow goes. Formula derivation:
    //   bezierMidY = 0.5*(fromY+toY) + 0.75*curveDepth
    //   → curveDepth = defaultDepth + liveDy*(4/3)   (moves midpoint by liveDy px)
    const fromX = fromR.x + fromR.width / 2;
    const toX   = toR.x  + toR.width   / 2;
    const fromY = fromR.y + fromR.height + 3;
    const toY   = toR.y  + toR.height   + 3;
    const horizDist    = Math.abs(toX - fromX);
    const defaultDepth = Math.max(horizDist * 0.35 + 20, 24);
    const curveDepth   = Math.max(8, defaultDepth + liveDy * (4 / 3));
    const cx0 = fromX, cy0 = fromY + curveDepth;
    const cx1 = toX,   cy1 = toY   + curveDepth;
    d = `M ${fromX} ${fromY} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${toX} ${toY}`;
    [midX, midY] = bezierMid(fromX, fromY, cx0, cy0, cx1, cy1, toX, toY);
    handleDy = curveDepth / 2 + 2;
    labelDy  = curveDepth / 2 + 8;

    return {
      d, midX, midY, handleDy, labelDy,
      fromAnchorX: fromX, fromAnchorY: fromY,
      toAnchorX: toX, toAnchorY: toY,
    };
  } else {
    // ── Side-gutter C-elbow ───────────────────────────────────────────────────
    // midpointDx shifts the gutter depth. Formula:
    //   bezierMidX = 0.75*gutterX + 0.125*(fromXEdge+toXEdge)
    //   → gutterX = defaultGutterX + liveDx / 0.75   (moves midX by liveDx px)
    const fromXEdge = isHebrew ? fromR.x + fromR.width : fromR.x;
    const toXEdge   = isHebrew ? toR.x  + toR.width   : toR.x;
    const defaultGutterX = isHebrew
      ? Math.max(fromXEdge, toXEdge) + GUTTER_REACH
      : Math.min(fromXEdge, toXEdge) - GUTTER_REACH;
    const gutterX = defaultGutterX + liveDx / 0.75;
    const cx0 = gutterX, cy0 = fromCY;
    const cx1 = gutterX, cy1 = toCY;
    d = `M ${fromXEdge} ${fromCY} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${toXEdge} ${toCY}`;
    [midX, midY] = bezierMid(fromXEdge, fromCY, cx0, cy0, cx1, cy1, toXEdge, toCY);
    handleDy = 0;
    labelDy  = -12;

    return {
      d, midX, midY, handleDy, labelDy,
      fromAnchorX: fromXEdge, fromAnchorY: fromCY,
      toAnchorX: toXEdge, toAnchorY: toCY,
    };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WordArrowOverlay({
  arrows,
  containerRef,
  outerRef,
  layoutRef,
  editing,
  selectedFromWordId,
  onDeleteArrow,
  onUpdateArrow,
  isHebrew = false,
}: Props) {
  const [drawn, setDrawn]         = useState<DrawnArrow[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const frameRef = useRef<number | null>(null);

  const effectiveOuterRef = outerRef ?? containerRef;

  // ── Measurement ─────────────────────────────────────────────────────────────

  function measure() {
    const container = containerRef.current;
    const outer     = effectiveOuterRef.current;
    if (!container || !outer) return;
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
    if (!container || !outer) return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(outer);
    if (layoutRef?.current && layoutRef.current !== outer) ro.observe(layoutRef.current);
    const mo = new MutationObserver(scheduleMeasure);
    mo.observe(container, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrows, containerRef, effectiveOuterRef, layoutRef]);

  // ── Global drag handlers ────────────────────────────────────────────────────

  useEffect(() => {
    if (!dragState) return;

    function onMouseMove(e: MouseEvent) {
      if (dragState?.type === "midpoint") {
        const liveDx = dragState.origDx + (e.clientX - dragState.startClientX);
        const liveDy = dragState.origDy + (e.clientY - dragState.startClientY);
        setDragState({ ...dragState, liveDx, liveDy });
      } else if (dragState?.type === "anchor") {
        setDragState({ ...dragState, clientX: e.clientX, clientY: e.clientY });
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragState) return;

      if (dragState.type === "midpoint") {
        const liveDx = dragState.origDx + (e.clientX - dragState.startClientX);
        const liveDy = dragState.origDy + (e.clientY - dragState.startClientY);
        onUpdateArrow?.(dragState.id, { midpointDx: liveDx, midpointDy: liveDy });
      } else if (dragState.type === "anchor") {
        // Find the word element under the cursor (skip pointer-events:none elements)
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        let targetWordId: string | null = null;
        for (const el of els) {
          const wid = (el as HTMLElement).dataset?.wordId;
          if (wid) { targetWordId = wid; break; }
          const closest = (el as HTMLElement).closest?.("[data-word-id]");
          if (closest) { targetWordId = (closest as HTMLElement).dataset.wordId ?? null; break; }
        }
        if (targetWordId) {
          // Don't allow anchoring an arrow to itself
          const arrow = drawn.find(d => d.arrow.id === dragState.id)?.arrow;
          const otherId = dragState.which === "from" ? arrow?.toWordId : arrow?.fromWordId;
          if (targetWordId !== otherId) {
            const patch: ArrowPatch = dragState.which === "from"
              ? { fromWordId: targetWordId }
              : { toWordId: targetWordId };
            onUpdateArrow?.(dragState.id, patch);
          }
        }
      }

      setDragState(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragState, drawn, onUpdateArrow]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (svgHeight === 0) return null;

  // Collect unique colors to define arrowhead markers
  const uniqueColors = [...new Set(drawn.map(({ arrow }) => effectiveColor(arrow)))];

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
        {uniqueColors.map(color => (
          <marker
            key={color}
            id={`war-head-${color.slice(1)}`}
            markerWidth={7}
            markerHeight={7}
            refX={3.5}
            refY={3.5}
            orient="auto"
          >
            <path d="M0,1 L7,3.5 L0,6 Z" fill={color} opacity={0.7} />
          </marker>
        ))}
      </defs>

      {drawn.map(({ arrow, fromR, toR }) => {
        const color = effectiveColor(arrow);

        // Apply live drag delta for midpoint drag
        const isDraggingMidpoint = dragState?.type === "midpoint" && dragState.id === arrow.id;
        const liveDx = isDraggingMidpoint
          ? (dragState as Extract<DragState, { type: "midpoint" }>).liveDx
          : (arrow.midpointDx ?? 0);
        const liveDy = isDraggingMidpoint
          ? (dragState as Extract<DragState, { type: "midpoint" }>).liveDy
          : (arrow.midpointDy ?? 0);

        const { d, midX, midY, handleDy, labelDy, fromAnchorX, fromAnchorY, toAnchorX, toAnchorY } =
          computeArrowGeometry(arrow, fromR, toR, liveDx, liveDy, isHebrew);

        const isHovered       = hoveredId === arrow.id;
        const isDraggingThis  = dragState !== null && dragState.id === arrow.id;
        // Show color picker + delete whenever editing is active (not just on hover)
        const showEditHandles = editing && !selectedFromWordId;

        // Color picker row geometry — centered on midX, offset above handle
        const colorRowY = midY + handleDy - 26;
        const colorCount = ARROW_COLORS.length;
        const colorSpacing = 14;
        const colorRowStartX = midX - ((colorCount - 1) * colorSpacing) / 2;

        return (
          <g key={arrow.id}>
            {/* ── Arrow path ── */}
            <path
              d={d}
              stroke={color}
              strokeWidth={isHovered || isDraggingThis ? 2 : 1.2}
              strokeOpacity={0.6}
              fill="none"
              markerEnd={`url(#war-head-${color.slice(1)})`}
            />

            {/* Optional label */}
            {arrow.label && (
              <text
                x={midX}
                y={midY + labelDy}
                textAnchor="middle"
                fontSize={9}
                fill={color}
                opacity={0.8}
                style={{ userSelect: "none" }}
              >
                {arrow.label}
              </text>
            )}

            {/* ── Fat invisible hover target ── */}
            <path
              d={d}
              stroke="transparent"
              strokeWidth={12}
              fill="none"
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
              onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
            />

            {/* ── Editing handles (visible when hovered in edit mode) ── */}
            {editing && (
              <g style={{ pointerEvents: "auto" }}>

                {/* Anchor handle — FROM word */}
                <circle
                  cx={fromAnchorX}
                  cy={fromAnchorY}
                  r={5}
                  fill="white"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={isHovered ? 0.9 : 0.35}
                  style={{ cursor: "grab", pointerEvents: "auto" }}
                  onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
                  onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDragState({
                      type: "anchor",
                      id: arrow.id,
                      which: "from",
                      clientX: e.clientX,
                      clientY: e.clientY,
                    });
                  }}
                />

                {/* Anchor handle — TO word */}
                <circle
                  cx={toAnchorX}
                  cy={toAnchorY}
                  r={5}
                  fill="white"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={isHovered ? 0.9 : 0.35}
                  style={{ cursor: "grab", pointerEvents: "auto" }}
                  onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
                  onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDragState({
                      type: "anchor",
                      id: arrow.id,
                      which: "to",
                      clientX: e.clientX,
                      clientY: e.clientY,
                    });
                  }}
                />

                {/* Midpoint drag handle */}
                <circle
                  cx={midX}
                  cy={midY + handleDy}
                  r={6}
                  fill={color}
                  fillOpacity={isHovered || isDraggingMidpoint ? 0.85 : 0.3}
                  stroke="white"
                  strokeWidth={1.2}
                  strokeOpacity={isHovered || isDraggingMidpoint ? 1 : 0.5}
                  style={{ cursor: "move", pointerEvents: "auto" }}
                  onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
                  onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDragState({
                      type: "midpoint",
                      id: arrow.id,
                      origDx: arrow.midpointDx ?? 0,
                      origDy: arrow.midpointDy ?? 0,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      liveDx: arrow.midpointDx ?? 0,
                      liveDy: arrow.midpointDy ?? 0,
                    });
                  }}
                />

                {/* Color picker + delete — only on hover */}
                {showEditHandles && (
                  <g>
                    {/* Background pill */}
                    <rect
                      x={colorRowStartX - 8}
                      y={colorRowY - 7}
                      width={(colorCount - 1) * colorSpacing + 16 + 24}
                      height={14}
                      rx={7}
                      fill="white"
                      fillOpacity={0.92}
                      stroke={color}
                      strokeOpacity={0.25}
                      strokeWidth={1}
                    />

                    {/* Color swatches */}
                    {ARROW_COLORS.map((c, i) => {
                      const cx = colorRowStartX + i * colorSpacing;
                      const isActive = c === color;
                      return (
                        <circle
                          key={c}
                          cx={cx}
                          cy={colorRowY}
                          r={isActive ? 5.5 : 4.5}
                          fill={c}
                          stroke="white"
                          strokeWidth={isActive ? 2 : 1}
                          style={{ cursor: "pointer", pointerEvents: "auto" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateArrow?.(arrow.id, { color: c });
                          }}
                        />
                      );
                    })}

                    {/* Delete button — × after swatches */}
                    <g
                      style={{ cursor: "pointer", pointerEvents: "auto" }}
                      onClick={(e) => { e.stopPropagation(); onDeleteArrow(arrow.id); }}
                    >
                      <circle
                        cx={colorRowStartX + (colorCount - 1) * colorSpacing + 18}
                        cy={colorRowY}
                        r={6}
                        fill="white"
                        stroke={color}
                        strokeOpacity={0.5}
                        strokeWidth={1.2}
                      />
                      <text
                        x={colorRowStartX + (colorCount - 1) * colorSpacing + 18}
                        y={colorRowY + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fill={color}
                        opacity={0.8}
                        style={{ userSelect: "none" }}
                      >×</text>
                    </g>
                  </g>
                )}
              </g>
            )}

            {/* ── Non-editing hover delete (existing behavior) ── */}
            {!editing && (editing || isHovered) && (
              <g
                style={{
                  pointerEvents: "auto",
                  cursor: "pointer",
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={() => setHoveredId(arrow.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onDeleteArrow(arrow.id)}
              >
                <circle
                  cx={midX}
                  cy={midY + handleDy}
                  r={7}
                  fill="white"
                  stroke={color}
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                />
                <text
                  x={midX}
                  y={midY + handleDy + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fill={color}
                  opacity={0.8}
                  style={{ userSelect: "none" }}
                >×</text>
              </g>
            )}

            {/* ── Anchor drag preview ── */}
            {dragState?.type === "anchor" && dragState.id === arrow.id && (() => {
              const outer = effectiveOuterRef.current;
              if (!outer) return null;
              const [svgX, svgY] = clientToSvg(dragState.clientX, dragState.clientY, outer);
              const fixedX = dragState.which === "from" ? toAnchorX : fromAnchorX;
              const fixedY = dragState.which === "from" ? toAnchorY : fromAnchorY;
              return (
                <g style={{ pointerEvents: "none" }}>
                  <line
                    x1={fixedX} y1={fixedY}
                    x2={svgX}   y2={svgY}
                    stroke={color}
                    strokeWidth={1.2}
                    strokeOpacity={0.5}
                    strokeDasharray="4 3"
                  />
                  <circle
                    cx={svgX}
                    cy={svgY}
                    r={5}
                    fill="white"
                    stroke={color}
                    strokeWidth={1.5}
                    strokeOpacity={0.9}
                  />
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* ── Selected-from-word indicator ── */}
      {editing && selectedFromWordId && (() => {
        const container = containerRef.current;
        const outer     = effectiveOuterRef.current;
        if (!container || !outer) return null;
        const r = getWordRect(selectedFromWordId, container, outer);
        if (!r) return null;
        const dotX = isHebrew ? r.x + r.width + GUTTER_REACH / 2 : r.x - GUTTER_REACH / 2;
        const dotY = r.y + r.height / 2;
        return (
          <circle cx={dotX} cy={dotY} r={4} fill={DEFAULT_COLOR} opacity={0.8} />
        );
      })()}
    </svg>
  );
}
