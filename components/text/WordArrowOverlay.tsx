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
  /** Right edge of the [data-rst-src-block] source column (3-col layout only).
   *  Used to keep the Hebrew gutter inside the source column when a translation
   *  is active.  null in the 2-column (source-only) layout. */
  srcBlockRightX: number | null;
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
  /** When true, a translation column is active — the layout shifts from the
   *  narrow centred block to a full-width 3-column grid.  Including this in the
   *  useLayoutEffect deps guarantees word positions are re-measured after the
   *  layout change rather than relying solely on the MutationObserver. */
  hasTranslation?: boolean;
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
      type: "midpoint2";
      id: number;
      orig2Dx: number;
      orig2Dy: number;
      startClientX: number;
      startClientY: number;
      live2Dx: number;
      live2Dy: number;
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

/**
 * Returns the right-edge X of the [data-rst-src-block] ancestor of the given
 * word, in scroll-canvas coordinates. This element is only present in the
 * 3-column translation layout. Returns null in the 2-column (source-only)
 * layout, which falls back to per-word edge gutter positioning.
 */
function getSrcBlockRight(
  wordId: string,
  innerContainer: HTMLElement,
  outerContainer: HTMLElement,
): number | null {
  const el = innerContainer.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  if (!el) return null;
  const block = el.closest<HTMLElement>("[data-rst-src-block]");
  if (!block) return null;
  const blockR = block.getBoundingClientRect();
  const oRect  = outerContainer.getBoundingClientRect();
  return blockR.right - oRect.left + outerContainer.scrollLeft;
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
  /** Bezier t=0.5 — used for label and color picker placement */
  labelX: number;
  labelY: number;
  /** Handle 1 at t=0.25 — controls control point 0 (FROM side) */
  handle1X: number;
  handle1Y: number;
  /** Handle 2 at t=0.75 — controls control point 1 (TO side) */
  handle2X: number;
  handle2Y: number;
  fromAnchorX: number;
  fromAnchorY: number;
  toAnchorX: number;
  toAnchorY: number;
}

/**
 * Computes arrow path geometry with two independently-adjustable control points.
 *
 * liveDx/liveDy  → offset for cp0 (FROM-side control point), sourced from midpointDx/Dy.
 * live2Dx/live2Dy → offset for cp1 (TO-side control point), sourced from midpoint2Dx/Dy.
 *
 * Backward compatibility: when midpoint2Dx/Dy are null the caller passes them as
 * midpointDx/Dy so both control points start at the same position, preserving the
 * original symmetric shape.
 */
function computeArrowGeometry(
  arrow: WordArrow,
  fromR: WordRect,
  toR: WordRect,
  liveDx: number,
  liveDy: number,
  live2Dx: number,
  live2Dy: number,
  isHebrew: boolean,
  srcBlockRightX: number | null = null,
): ArrowGeometry {
  const fromCY = fromR.y + fromR.height / 2;
  const toCY   = toR.y  + toR.height  / 2;
  const sameLine = Math.abs(fromCY - toCY) < fromR.height * 0.75;

  // For Hebrew, heavily-cantillated words have a tall bounding box whose
  // geometric centre falls in the cantillation zone, well above the consonants.
  // Using 0.62 of the height shifts the multi-line attachment point down into
  // the consonant area so the arrowhead points at the visible text, not above it.
  const fromAttachY = isHebrew ? fromR.y + fromR.height * 0.62 : fromCY;
  const toAttachY   = isHebrew ? toR.y  + toR.height  * 0.62 : toCY;

  let d: string;
  let cx0: number, cy0: number, cx1: number, cy1: number;
  let p0x: number, p0y: number, p1x: number, p1y: number; // curve endpoints

  if (sameLine) {
    // ── Below-line arc ────────────────────────────────────────────────────────
    // Each handle independently adjusts the curve depth on its side.
    // Formula: bezierMidY = 0.5*(fromY+toY) + 0.75*curveDepth
    //          → curveDepth = defaultDepth + liveDy*(4/3)   (moves midpoint by liveDy px)
    p0x = fromR.x + fromR.width / 2;
    p1x = toR.x  + toR.width   / 2;
    p0y = fromR.y + fromR.height + 3;
    p1y = toR.y  + toR.height   + 3;
    const horizDist    = Math.abs(p1x - p0x);
    const defaultDepth = Math.max(horizDist * 0.35 + 20, 24);
    const curveDepth1  = Math.max(8, defaultDepth + liveDy  * (4 / 3));
    const curveDepth2  = Math.max(8, defaultDepth + live2Dy * (4 / 3));
    cx0 = p0x + liveDx;  cy0 = p0y + curveDepth1;
    cx1 = p1x + live2Dx; cy1 = p1y + curveDepth2;
  } else {
    // ── Multi-line: pick anchor edge based on primary displacement direction ───
    const fromMidX = fromR.x + fromR.width  / 2;
    const toMidX   = toR.x   + toR.width    / 2;
    const dx       = toMidX   - fromMidX;
    const dy       = toAttachY - fromAttachY; // signed: positive = TO is lower on screen

    if (Math.abs(dy) >= Math.abs(dx)) {
      // ── Primarily vertical: anchor bottom/top of each word ──────────────────
      // FROM exits at its bottom edge when TO is below, top edge when TO is above.
      // TO is entered at its top edge when FROM is above, bottom edge when below.
      p0x = fromMidX;
      p0y = dy >= 0 ? fromR.y + fromR.height : fromR.y;
      p1x = toMidX;
      p1y = dy >= 0 ? toR.y                  : toR.y + toR.height;
      // Control points ⅓ and ⅔ of the gap: produces a smooth vertical arc.
      const spanY = (p1y - p0y) / 3;
      cx0 = p0x + liveDx;   cy0 = p0y + spanY + liveDy;
      cx1 = p1x + live2Dx;  cy1 = p1y - spanY + live2Dy;
    } else {
      // ── Primarily horizontal: left/right anchor ──────────────────────────────
      p0y = fromAttachY;
      p1y = toAttachY;

      const SAME_COL = Math.max(fromR.width, toR.width) * 0.75;

      if (Math.abs(dx) < SAME_COL) {
        // Same column: C-elbow gutter on the language-start side.
        p0x = isHebrew ? fromR.x + fromR.width : fromR.x;
        p1x = isHebrew ? toR.x  + toR.width   : toR.x;
        const defaultGutterX = isHebrew
          ? (srcBlockRightX !== null
              ? srcBlockRightX + GUTTER_REACH
              : Math.max(p0x, p1x) + GUTTER_REACH)
          : Math.min(p0x, p1x) - GUTTER_REACH;
        const gutterX1 = defaultGutterX + liveDx  / 0.75;
        const gutterX2 = defaultGutterX + live2Dx / 0.75;
        cx0 = gutterX1; cy0 = p0y + liveDy;
        cx1 = gutterX2; cy1 = p1y + live2Dy;
      } else {
        // Cross-column: anchor each word on its side nearest the other.
        p0x = dx > 0 ? fromR.x + fromR.width : fromR.x;
        p1x = dx > 0 ? toR.x                 : toR.x + toR.width;
        const spanX = (p1x - p0x) / 3;
        cx0 = p0x + spanX + liveDx;   cy0 = p0y + liveDy;
        cx1 = p1x - spanX + live2Dx;  cy1 = p1y + live2Dy;
      }
    }
  }

  d = `M ${p0x} ${p0y} C ${cx0} ${cy0}, ${cx1} ${cy1}, ${p1x} ${p1y}`;

  const [labelX, labelY]   = bezierPoint(p0x, p0y, cx0, cy0, cx1, cy1, p1x, p1y, 0.5);
  const [handle1X, handle1Y] = bezierPoint(p0x, p0y, cx0, cy0, cx1, cy1, p1x, p1y, 0.25);
  const [handle2X, handle2Y] = bezierPoint(p0x, p0y, cx0, cy0, cx1, cy1, p1x, p1y, 0.75);

  return {
    d,
    labelX, labelY,
    handle1X, handle1Y,
    handle2X, handle2Y,
    fromAnchorX: p0x, fromAnchorY: p0y,
    toAnchorX: p1x,   toAnchorY: p1y,
  };
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
  hasTranslation = false,
}: Props) {
  const [drawn, setDrawn]         = useState<DrawnArrow[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const frameRef   = useRef<number | null>(null);
  const svgRef     = useRef<SVGSVGElement | null>(null);
  const arrowsRef  = useRef(arrows);
  arrowsRef.current = arrows;

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
      if (fromR && toR) {
        // For Hebrew arrows in the 3-column layout, find the source column's
        // right boundary so the gutter stays within the source area and doesn't
        // bleed into the translation column.
        const fromBlockRight = isHebrew ? getSrcBlockRight(arrow.fromWordId, container, outer) : null;
        const toBlockRight   = isHebrew ? getSrcBlockRight(arrow.toWordId,   container, outer) : null;
        const srcBlockRightX =
          fromBlockRight !== null || toBlockRight !== null
            ? Math.max(fromBlockRight ?? -Infinity, toBlockRight ?? -Infinity)
            : null;
        newDrawn.push({ arrow, fromR, toR, srcBlockRightX });
      }
    }
    setDrawn(newDrawn);
  }

  /**
   * Direct SVG DOM update for print — bypasses React's render / commit cycle.
   *
   * React state updates (even with flushSync) schedule a synchronous flush
   * but still go through reconciliation.  In some browsers the print snapshot
   * is taken before that flush is reflected in the rendered output.  Writing
   * directly to path.d and text.x/y attributes is immediate and is visible to
   * the print engine regardless of timing.
   */
  function updateSvgForPrint() {
    const container = containerRef.current;
    const outer     = effectiveOuterRef.current;
    const svg       = svgRef.current;
    if (!container || !outer || !svg) return;

    // Update SVG height to match the print-layout scroll height.
    const newHeight = outer.scrollHeight > outer.clientHeight
      ? outer.scrollHeight : outer.clientHeight;
    svg.style.height = `${newHeight}px`;

    for (const arrow of arrowsRef.current) {
      const fromR = getWordRect(arrow.fromWordId, container, outer);
      const toR   = getWordRect(arrow.toWordId,   container, outer);
      if (!fromR || !toR) continue;

      const fromBlockRight = isHebrew ? getSrcBlockRight(arrow.fromWordId, container, outer) : null;
      const toBlockRight   = isHebrew ? getSrcBlockRight(arrow.toWordId,   container, outer) : null;
      const srcBlockRightX =
        fromBlockRight !== null || toBlockRight !== null
          ? Math.max(fromBlockRight ?? -Infinity, toBlockRight ?? -Infinity)
          : null;

      const { d, labelX, labelY } = computeArrowGeometry(
        arrow, fromR, toR,
        arrow.midpointDx  ?? 0,
        arrow.midpointDy  ?? 0,
        arrow.midpoint2Dx ?? arrow.midpointDx ?? 0,
        arrow.midpoint2Dy ?? arrow.midpointDy ?? 0,
        isHebrew, srcBlockRightX,
      );

      // Update every path element for this arrow (visible path + hover path).
      svg.querySelectorAll<Element>(`[data-arrow-path="${arrow.id}"]`).forEach(el => {
        el.setAttribute("d", d);
      });

      // Update optional label position.
      const labelEl = svg.querySelector<Element>(`[data-arrow-label="${arrow.id}"]`);
      if (labelEl) {
        labelEl.setAttribute("x", String(labelX));
        labelEl.setAttribute("y", String(labelY - 8));
      }
    }
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
  }, [arrows, containerRef, effectiveOuterRef, layoutRef, hasTranslation]);

  // ── Print re-measurement ─────────────────────────────────────────────────
  //
  // When the browser renders the print layout for window.print(), it reflows
  // the page to the paper width (narrower than the screen).  The SVG paths are
  // stored as screen coordinates, so arrows land in the wrong position in the
  // PDF.
  //
  // IMPORTANT: In WebKit/WKWebView the `beforeprint` event fires BEFORE print
  // CSS is applied and the layout is reflowed, so getBoundingClientRect() in
  // that handler still returns screen-layout positions.  Instead we listen on
  // window.matchMedia('print'), whose `change` event fires AFTER WebKit has
  // applied @media print rules and completed reflow.  At that point
  // getBoundingClientRect() returns the true print-layout positions we need.
  //
  // flushSync forces React to commit the updated paths synchronously so the
  // DOM is updated before the browser takes its print snapshot.
  //
  // measureRef always holds the most-recent measure closure (with up-to-date
  // arrow data), avoiding stale-closure issues in the stable event handler.
  const measureRef            = useRef(measure);
  measureRef.current           = measure;
  const updateSvgForPrintRef  = useRef(updateSvgForPrint);
  updateSvgForPrintRef.current = updateSvgForPrint;

  useEffect(() => {
    const mql = window.matchMedia("print");

    function handlePrintMediaChange(e: MediaQueryListEvent) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (e.matches) {
        // Print CSS is now active and layout has reflowed.
        // Write path coordinates directly to the DOM — this bypasses React's
        // render/commit cycle so the update is visible in the print snapshot
        // regardless of browser print-pipeline timing.
        updateSvgForPrintRef.current();
      } else {
        // Print dialog closed — restore screen-layout coordinates via state.
        measureRef.current();
      }
    }

    // ExportLayout dispatches this before calling window.print() while the
    // text container is temporarily constrained to ≈ print content width.
    // Handling it synchronously here guarantees the SVG paths are updated
    // before the browser snapshot — no dependency on matchMedia timing.
    function handlePrintPrepare() {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      updateSvgForPrintRef.current();
    }

    mql.addEventListener("change", handlePrintMediaChange);
    window.addEventListener("structura:print-prepare", handlePrintPrepare);
    return () => {
      mql.removeEventListener("change", handlePrintMediaChange);
      window.removeEventListener("structura:print-prepare", handlePrintPrepare);
    };
  }, []); // empty: attach once per mount, refs keep content current

  // ── Global drag handlers ────────────────────────────────────────────────────

  useEffect(() => {
    if (!dragState) return;

    function onMouseMove(e: MouseEvent) {
      e.preventDefault();
      if (dragState?.type === "midpoint") {
        const liveDx = dragState.origDx + (e.clientX - dragState.startClientX);
        const liveDy = dragState.origDy + (e.clientY - dragState.startClientY);
        setDragState({ ...dragState, liveDx, liveDy });
      } else if (dragState?.type === "midpoint2") {
        const live2Dx = dragState.orig2Dx + (e.clientX - dragState.startClientX);
        const live2Dy = dragState.orig2Dy + (e.clientY - dragState.startClientY);
        setDragState({ ...dragState, live2Dx, live2Dy });
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
      } else if (dragState.type === "midpoint2") {
        const live2Dx = dragState.orig2Dx + (e.clientX - dragState.startClientX);
        const live2Dy = dragState.orig2Dy + (e.clientY - dragState.startClientY);
        onUpdateArrow?.(dragState.id, { midpoint2Dx: live2Dx, midpoint2Dy: live2Dy });
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
      ref={svgRef}
      style={{
        position:      "absolute",
        top:           0,
        left:          0,
        width:         "100%",
        height:        svgHeight,
        pointerEvents: "none",
        overflow:      "visible",
        zIndex:        4,
        // Suppress text selection on the page while any handle is being dragged.
        userSelect:    dragState ? "none" : undefined,
      }}
    >
      <defs>
        {uniqueColors.map(color => {
          // A filled dot at each endpoint.  markerUnits="userSpaceOnUse" keeps
          // the size fixed in pixels regardless of stroke width.  refX/refY
          // centre the circle exactly on the path endpoint.
          const hex = color.slice(1);
          return (
            <marker
              key={hex}
              id={`war-dot-${hex}`}
              markerWidth={7} markerHeight={7}
              refX={3.5} refY={3.5}
              markerUnits="userSpaceOnUse"
            >
              <circle cx={3.5} cy={3.5} r={2.5} fill={color} opacity={0.75} />
            </marker>
          );
        })}
      </defs>

      {drawn.map(({ arrow, fromR, toR, srcBlockRightX }) => {
        const color = effectiveColor(arrow);

        // ── Live delta resolution ──────────────────────────────────────────────
        // Handle 1 (cp0 / FROM side): sourced from midpointDx/Dy
        const isDragging1 = dragState?.type === "midpoint"  && dragState.id === arrow.id;
        const isDragging2 = dragState?.type === "midpoint2" && dragState.id === arrow.id;

        const liveDx = isDragging1
          ? (dragState as Extract<DragState, { type: "midpoint" }>).liveDx
          : (arrow.midpointDx ?? 0);
        const liveDy = isDragging1
          ? (dragState as Extract<DragState, { type: "midpoint" }>).liveDy
          : (arrow.midpointDy ?? 0);

        // Handle 2 (cp1 / TO side): sourced from midpoint2Dx/Dy.
        // Falls back to midpointDx/Dy when midpoint2 has never been set,
        // so existing arrows keep their symmetric shape.
        const live2Dx = isDragging2
          ? (dragState as Extract<DragState, { type: "midpoint2" }>).live2Dx
          : (arrow.midpoint2Dx ?? arrow.midpointDx ?? 0);
        const live2Dy = isDragging2
          ? (dragState as Extract<DragState, { type: "midpoint2" }>).live2Dy
          : (arrow.midpoint2Dy ?? arrow.midpointDy ?? 0);

        const {
          d, labelX, labelY,
          handle1X, handle1Y,
          handle2X, handle2Y,
          fromAnchorX, fromAnchorY,
          toAnchorX, toAnchorY,
        } = computeArrowGeometry(
          arrow, fromR, toR,
          liveDx, liveDy, live2Dx, live2Dy,
          isHebrew, srcBlockRightX,
        );

        const isHovered       = hoveredId === arrow.id;
        const isDraggingThis  = dragState !== null && dragState.id === arrow.id;
        // Show color picker + delete whenever editing is active (not just on hover)
        const showEditHandles = editing && !selectedFromWordId;

        // Color picker row geometry — centered on labelX, offset above
        const colorRowY = labelY - 20;
        const colorCount = ARROW_COLORS.length;
        const colorSpacing = 14;
        const colorRowStartX = labelX - ((colorCount - 1) * colorSpacing) / 2;

        return (
          <g key={arrow.id}>
            {/* ── Arrow path ── */}
            <path
              data-arrow-path={arrow.id}
              d={d}
              stroke={color}
              strokeWidth={isHovered || isDraggingThis ? 2 : 1.2}
              strokeOpacity={0.6}
              fill="none"
              markerStart={`url(#war-dot-${color.slice(1)})`}
              markerEnd={`url(#war-dot-${color.slice(1)})`}
            />

            {/* Optional label */}
            {arrow.label && (
              <text
                data-arrow-label={arrow.id}
                x={labelX}
                y={labelY - 8}
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
              data-arrow-path={arrow.id}
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
                    e.preventDefault();
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
                    e.preventDefault();
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

                {/* ── Curve handle 1 (FROM side, t=0.25) ── */}
                <circle
                  cx={handle1X}
                  cy={handle1Y}
                  r={5}
                  fill={color}
                  fillOpacity={isHovered || isDragging1 ? 0.85 : 0.3}
                  stroke="white"
                  strokeWidth={1.2}
                  strokeOpacity={isHovered || isDragging1 ? 1 : 0.5}
                  style={{ cursor: "move", pointerEvents: "auto" }}
                  onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
                  onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
                  onMouseDown={(e) => {
                    e.preventDefault();
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

                {/* ── Curve handle 2 (TO side, t=0.75) ── */}
                <circle
                  cx={handle2X}
                  cy={handle2Y}
                  r={5}
                  fill={color}
                  fillOpacity={isHovered || isDragging2 ? 0.85 : 0.3}
                  stroke="white"
                  strokeWidth={1.2}
                  strokeOpacity={isHovered || isDragging2 ? 1 : 0.5}
                  style={{ cursor: "move", pointerEvents: "auto" }}
                  onMouseEnter={() => { if (!dragState) setHoveredId(arrow.id); }}
                  onMouseLeave={() => { if (!dragState) setHoveredId(null); }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Initialise orig2 from midpoint2Dx/Dy, falling back to
                    // midpointDx/Dy so a first drag on handle 2 starts from the
                    // current symmetric shape rather than the origin.
                    setDragState({
                      type: "midpoint2",
                      id: arrow.id,
                      orig2Dx: arrow.midpoint2Dx ?? arrow.midpointDx ?? 0,
                      orig2Dy: arrow.midpoint2Dy ?? arrow.midpointDy ?? 0,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      live2Dx: arrow.midpoint2Dx ?? arrow.midpointDx ?? 0,
                      live2Dy: arrow.midpoint2Dy ?? arrow.midpointDy ?? 0,
                    });
                  }}
                />

                {/* Color picker + delete — always visible in edit mode */}
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
                  cx={labelX}
                  cy={labelY}
                  r={7}
                  fill="white"
                  stroke={color}
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                />
                <text
                  x={labelX}
                  y={labelY + 4}
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
        // For Hebrew in the 3-column layout, pin the indicator to just right of
        // the source column boundary (same logic as the gutter).
        const blockRight = isHebrew ? getSrcBlockRight(selectedFromWordId, container, outer) : null;
        const dotX = isHebrew
          ? (blockRight !== null ? blockRight + GUTTER_REACH / 2 : r.x + r.width + GUTTER_REACH / 2)
          : r.x - GUTTER_REACH / 2;
        const dotY = r.y + r.height / 2;
        return (
          <circle cx={dotX} cy={dotY} r={4} fill={DEFAULT_COLOR} opacity={0.8} />
        );
      })()}
    </svg>
  );
}
