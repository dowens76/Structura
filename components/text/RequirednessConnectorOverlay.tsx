"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { POETRY_COLORS, POETRY_UNDERLINE_THICKNESS_PX } from "@/lib/poetry/constants";

export interface RequirednessConnector {
  id: number;
  requiresWordId: string;
  resolvedStartWordId: string;
  resolvedEndWordId: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawnConnector {
  id: number;
  d: string;
}

// 25% of the Requiredness underline's own thickness.
const STROKE_WIDTH = POETRY_UNDERLINE_THICKNESS_PX / 4;
// Approximates how far below a word's border-box the Requiredness underline
// actually renders (text-underline-offset: 0.35em + half its own thickness) —
// see WordToken.tsx's poetryRequirednessStyle. Not pixel-exact (that would
// require reading the live computed underline position, which the DOM
// doesn't expose), but close enough for a thin leader line to read as
// "reaching" the underline rather than stopping short of it or overshooting
// into the next line.
const UNDERLINE_OFFSET_EM = 0.35;
// A y-gap bigger than this fraction of a word's own height means the next
// point is on a different visual line (matches WordArrowOverlay's same-line
// heuristic).
const LINE_GAP_TOLERANCE = 0.75;

function elRect(el: Element, outer: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const oRect = outer.getBoundingClientRect();
  return {
    x: r.left - oRect.left + outer.scrollLeft,
    y: r.top - oRect.top + outer.scrollTop,
    width: r.width,
    height: r.height,
  };
}

function getRect(wordId: string, container: HTMLElement, outer: HTMLElement): Rect | null {
  const el = container.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  return el ? elRect(el, outer) : null;
}

function underlineOffsetPx(el: Element): number {
  const fontSizePx = parseFloat(getComputedStyle(el).fontSize) || 16;
  return fontSizePx * UNDERLINE_OFFSET_EM + POETRY_UNDERLINE_THICKNESS_PX / 2;
}

/** A translation token id's abbreviation (`tv:ABBR:...`), or null for a source Word.wordId. */
function tvAbbr(wordId: string): string | null {
  return wordId.startsWith("tv:") ? wordId.split(":")[1] ?? null : null;
}

/**
 * Every rendered word id belonging to the same "stream" as `sampleId` — every
 * source word, or every token of one translation (matched by abbreviation) —
 * in DOM/document order, which is reading order for both. Used to walk from
 * the "requires" word to the resolved word/phrase through whatever lies
 * between them, without needing chapter-wide word-order data (which doesn't
 * cover translation tokens at all).
 */
function getStreamOrderedIds(container: HTMLElement, sampleId: string): string[] {
  const abbr = tvAbbr(sampleId);
  const ids: string[] = [];
  for (const el of container.querySelectorAll("[data-word-id]")) {
    const id = el.getAttribute("data-word-id");
    if (!id) continue;
    if (abbr ? id.startsWith(`tv:${abbr}:`) : !id.startsWith("tv:")) ids.push(id);
  }
  return ids;
}

interface LinePoint {
  x: number;
  y: number;
}

function clusterIntoLines(points: LinePoint[], gapTolerance: number): LinePoint[][] {
  const clusters: LinePoint[][] = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const cur = clusters[clusters.length - 1];
    if (Math.abs(points[i].y - cur[cur.length - 1].y) > gapTolerance) clusters.push([points[i]]);
    else cur.push(points[i]);
  }
  return clusters;
}

interface Props {
  connectors: RequirednessConnector[];
  containerRef: RefObject<HTMLDivElement | null>;
  outerRef?: RefObject<HTMLDivElement | null>;
  layoutRef?: RefObject<HTMLDivElement | null>;
  /** True when the connector's own word stream reads right-to-left (a
   *  source-anchored connector on Hebrew text) — flips which margin a
   *  wrapped line "exits"/"enters" from. Translation tokens are always
   *  treated as LTR, matching how this app renders them. */
  isHebrew?: boolean;
}

/**
 * Draws a dashed gray leader line from each Requiredness ("arrow") mark's
 * arrow glyph to the near edge of its resolved word/phrase's underline —
 * automatically, with no manual editing handles (unlike WordArrowOverlay,
 * which this borrows its DOM-measurement approach from). The line runs
 * horizontally at the text's own underline level, starting vertically
 * centered on the arrow glyph, rather than arcing or cutting a diagonal: on
 * a single line it's one flat segment end to end; across wrapped lines it
 * runs to the first line's far margin, then picks back up at the next
 * line's near margin as its own separate stroke — no line drawn across the
 * gap between them, the same way text wrapping itself has no line joining
 * one row's end to the next row's start.
 */
export default function RequirednessConnectorOverlay({
  connectors,
  containerRef,
  outerRef,
  layoutRef,
  isHebrew = false,
}: Props) {
  const [drawn, setDrawn] = useState<DrawnConnector[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const frameRef = useRef<number | null>(null);
  const effectiveOuterRef = outerRef ?? containerRef;

  function measureConnector(c: RequirednessConnector, container: HTMLElement, outer: HTMLElement): string | null {
    const arrowEl = container.querySelector(`[data-word-id="${CSS.escape(c.requiresWordId)}"] [data-requiredness-arrow]`);
    if (!arrowEl) return null;

    const orderedIds = getStreamOrderedIds(container, c.requiresWordId);
    const reqIdx = orderedIds.indexOf(c.requiresWordId);
    const startIdx = orderedIds.indexOf(c.resolvedStartWordId);
    const endIdx = orderedIds.indexOf(c.resolvedEndWordId);
    if (reqIdx === -1 || startIdx === -1 || endIdx === -1) return null;
    const nearIdx = Math.abs(reqIdx - startIdx) <= Math.abs(reqIdx - endIdx) ? startIdx : endIdx;
    const [from, to] = reqIdx <= nearIdx ? [reqIdx, nearIdx] : [nearIdx, reqIdx];
    const waypointIds = orderedIds.slice(from, to + 1);
    if (reqIdx > nearIdx) waypointIds.reverse();
    // waypointIds[0] === c.requiresWordId; waypointIds[last] is the resolved
    // range's endpoint nearest to it (may equal it, for a self-referencing mark).

    const waypointEls = waypointIds.map((id) => container.querySelector(`[data-word-id="${CSS.escape(id)}"]`));
    if (waypointEls.some((el) => !el)) return null;
    const rects = waypointEls.map((el) => elRect(el!, outer));
    const arrowR = elRect(arrowEl, outer);

    const rightToLeft = !c.requiresWordId.startsWith("tv:") && isHebrew;

    // Every line after the first carries the connector at the exact same
    // level as the solid underline it's leading to — one offset, taken from
    // the resolved word's own font (the word that actually renders that
    // underline), applied uniformly to every waypoint rather than
    // recomputed per word. Recomputing per word let ordinary sub-pixel rect
    // differences between words nudge each line's level slightly out of
    // step with both the real underline and each other.
    const targetOffsetPx = underlineOffsetPx(waypointEls[waypointEls.length - 1]!);

    // The point the path travels through for each waypoint: the arrow's own
    // tip for the first (not the requires-word's own rect, so a same-word
    // Continuation+Requiredness pairing still starts from the right glyph),
    // the resolved range's near-facing edge for the last, and each
    // in-between word's underline level at its own horizontal center.
    const points: LinePoint[] = [{ x: arrowR.x + arrowR.width / 2, y: arrowR.y + arrowR.height / 2 }];
    for (let i = 1; i < waypointIds.length - 1; i++) {
      const r = rects[i];
      points.push({ x: r.x + r.width / 2, y: r.y + r.height + targetOffsetPx });
    }
    if (waypointIds.length > 1) {
      const lastR = rects[rects.length - 1];
      const prevPoint = points[points.length - 1];
      const lastCenterX = lastR.x + lastR.width / 2;
      const targetEdgeX = prevPoint.x < lastCenterX ? lastR.x : lastR.x + lastR.width;
      points.push({ x: targetEdgeX, y: lastR.y + lastR.height + targetOffsetPx });
    }

    const maxHeight = Math.max(arrowR.height, ...rects.map((r) => r.height));
    const clusters = clusterIntoLines(points, maxHeight * LINE_GAP_TOLERANCE);

    if (clusters.length === 1) {
      const [p0, p1] = [points[0], points[points.length - 1]];
      return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
    }

    // Wrap-through lines run the full width of the connector's own span
    // (every measured rect), approximating that span's text column.
    const allX = [arrowR.x, arrowR.x + arrowR.width, ...rects.flatMap((r) => [r.x, r.x + r.width])];
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const exitX = rightToLeft ? minX : maxX;
    const enterX = rightToLeft ? maxX : minX;

    // Each wrapped line is its own subpath (a fresh "M", not a continuing
    // "L") — text wrapping has no line connecting the end of one row to the
    // start of the next, so neither should this: it just continues on the
    // next line, the same way an underline would if you kept typing past
    // the line's end.
    let d = "";
    clusters.forEach((cluster, i) => {
      const y = cluster[0].y;
      const isFirst = i === 0;
      const isLast = i === clusters.length - 1;
      const segStartX = isFirst ? cluster[0].x : enterX;
      const segEndX = isLast ? cluster[cluster.length - 1].x : exitX;
      d += `M ${segStartX} ${y} L ${segEndX} ${y} `;
    });
    return d.trim();
  }

  function measure() {
    const container = containerRef.current;
    const outer = effectiveOuterRef.current;
    if (!container || !outer) return;
    setSvgHeight(outer.scrollHeight > outer.clientHeight ? outer.scrollHeight : outer.clientHeight);

    const next: DrawnConnector[] = [];
    for (const c of connectors) {
      const d = measureConnector(c, container, outer);
      if (d) next.push({ id: c.id, d });
    }
    setDrawn(next);
  }

  useLayoutEffect(() => {
    function scheduleMeasure() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(measure);
    }
    scheduleMeasure();

    // A translation column can finish mounting its words in a later commit
    // than this overlay's own first layout effect (e.g. while its own
    // settling effects run), so the very first measure can fire before the
    // words it needs to walk between exist yet — and by then there's no
    // further DOM mutation for the observer below to catch, since nothing
    // else changes once that column has settled. These retries are a cheap,
    // self-cancelling safety net: each just reschedules the same measure(),
    // which no-ops harmlessly once the real one has already succeeded.
    const retryTimers = [50, 150, 400, 900, 1800].map((delay) => window.setTimeout(scheduleMeasure, delay));

    const container = containerRef.current;
    const outer = effectiveOuterRef.current;
    if (!container || !outer) return () => {
      retryTimers.forEach(clearTimeout);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(outer);
    if (layoutRef?.current && layoutRef.current !== outer) ro.observe(layoutRef.current);
    const mo = new MutationObserver(scheduleMeasure);
    mo.observe(container, { childList: true, subtree: true });
    return () => {
      retryTimers.forEach(clearTimeout);
      ro.disconnect();
      mo.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectors, containerRef, effectiveOuterRef, layoutRef, isHebrew]);

  if (svgHeight === 0 || drawn.length === 0) return null;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: svgHeight,
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 3,
      }}
    >
      {drawn.map(({ id, d }) => (
        <path
          key={id}
          d={d}
          stroke={POETRY_COLORS.requiredness}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray="4 3"
          strokeOpacity={0.85}
          fill="none"
        />
      ))}
    </svg>
  );
}
