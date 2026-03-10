"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ClauseRelationship } from "@/lib/db/schema";
import { RELATIONSHIP_MAP, RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";

// Width of the dedicated arc column in the verse grid (matches VerseDisplay grid).
const ARC_COL = 80;
// Maximum arc depth — keeps arcs within the 80px dedicated arc column for level 0.
const BASE_DEPTH = 50;
// Additional control-point offset per nesting level
const LEVEL_STEP = 24;

interface SegmentPoint {
  wordId: string;
  y: number;
  labelLeftX: number;   // container-relative left edge of [data-seg-label] element
  labelRightX: number;  // container-relative right edge of [data-seg-label] element
}

interface Props {
  relationships: ClauseRelationship[];
  containerRef: RefObject<HTMLDivElement | null>; // the scrollable div — sole positioning ref
  isHebrew: boolean;
  hasTranslation: boolean;
  hasSource: boolean;       // false when source text is hidden (translation-only mode)
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedSegWordId: string | null;
  onSelectSegment: (wordId: string) => void;
  onDeleteRelationship: (id: number) => void;
}

/**
 * Compute the position of a paragraph segment in content-relative coordinates.
 *
 * Because this SVG is placed *inside* the scrollable container it scrolls with
 * the content.  Y must therefore be measured relative to the content top
 * (container.scrollTop = 0 → top of content), not the viewport:
 *
 *   y = elem.getBoundingClientRect().top
 *       – container.getBoundingClientRect().top
 *       + container.scrollTop
 *
 * This value is stable regardless of scroll position — no scroll listener needed.
 */
function getSegmentPos(
  wordId: string,
  container: HTMLElement,
): { y: number; labelLeftX: number; labelRightX: number } | null {
  const wordEl  = container.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  const labelEl = container.querySelector(`[data-seg-label="${CSS.escape(wordId)}"]`);
  if (!labelEl) return null; // label must always be present

  const cRect   = container.getBoundingClientRect();
  // Use source word element when present; fall back to label when source is hidden.
  const posEl   = wordEl ?? labelEl;
  const posRect = posEl.getBoundingClientRect();
  const lRect   = labelEl.getBoundingClientRect();

  const y = posRect.top - cRect.top + container.scrollTop + posRect.height / 2;

  return {
    y,
    labelLeftX:  lRect.left  - cRect.left,
    labelRightX: lRect.right - cRect.left,
  };
}

/**
 * Assign nesting levels to relationships so overlapping arcs don't collide.
 * Shorter spans get lower (inner) levels.
 */
function assignArcLevels(
  relationships: ClauseRelationship[],
  yMap: Map<string, number>,
): Map<number, number> {
  const sorted = [...relationships]
    .filter((r) => yMap.has(r.fromSegWordId) && yMap.has(r.toSegWordId))
    .sort((a, b) => {
      const spanA = Math.abs(yMap.get(a.toSegWordId)! - yMap.get(a.fromSegWordId)!);
      const spanB = Math.abs(yMap.get(b.toSegWordId)! - yMap.get(b.fromSegWordId)!);
      return spanA - spanB;
    });

  const levelMap = new Map<number, number>();
  const occupied: Array<{ minY: number; maxY: number; level: number }> = [];

  for (const rel of sorted) {
    const y1 = yMap.get(rel.fromSegWordId)!;
    const y2 = yMap.get(rel.toSegWordId)!;
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    let level = 0;
    while (occupied.some((o) => o.level === level && o.minY < maxY && o.maxY > minY)) {
      level++;
    }
    levelMap.set(rel.id, level);
    occupied.push({ minY, maxY, level });
  }

  return levelMap;
}

export default function ClauseRelationshipOverlay({
  relationships,
  containerRef,
  isHebrew,
  hasTranslation,
  hasSource,
  editing,
  paragraphFirstWordIds,
  selectedSegWordId,
  onSelectSegment,
  onDeleteRelationship,
}: Props) {
  const [points, setPoints]       = useState<SegmentPoint[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);

  function measure() {
    const c = containerRef.current;
    if (!c) return;

    const allIds = new Set<string>([
      ...paragraphFirstWordIds,
      ...relationships.flatMap((r) => [r.fromSegWordId, r.toSegWordId]),
    ]);

    const newPoints: SegmentPoint[] = [];
    for (const wordId of allIds) {
      const pos = getSegmentPos(wordId, c);
      if (pos !== null) newPoints.push({ wordId, ...pos });
    }

    // SVG height = full scrollable content height so arcs anywhere on the page render
    setSvgHeight(c.scrollHeight);
    setPoints(newPoints);
  }

  useLayoutEffect(() => {
    function scheduleMeasure() {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(measure);
    }

    scheduleMeasure();

    const c = containerRef.current;
    if (!c) return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };

    // Only need to re-measure when the content size changes (scroll is free since SVG scrolls with content)
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(c);

    return () => {
      ro.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationships, paragraphFirstWordIds, editing, containerRef, hasTranslation, hasSource]);

  const yMap          = new Map(points.map((p) => [p.wordId, p.y]));
  const labelLeftMap  = new Map(points.map((p) => [p.wordId, p.labelLeftX]));
  const labelRightMap = new Map(points.map((p) => [p.wordId, p.labelRightX]));

  if (svgHeight === 0) return null;

  // Arc placement:
  //   5-col (hasSource + hasTranslation): source arc LEFT of verse label, mirror arc RIGHT
  //   Single-col LTR (Greek, hasSource): arc on RIGHT of verse label
  //   Single-col RTL (Hebrew, hasSource): arc on LEFT of verse label
  //   Translation-only (!hasSource): single arc on RIGHT of verse label (into translation arc col)
  // arcGoesLeft = true  → arc is in LEFT arc column (source side)
  // arcGoesLeft = false → arc is in RIGHT arc column (translation/source-single-col side)
  const arcGoesLeft = hasSource && (hasTranslation || isHebrew);

  const levelMap = assignArcLevels(relationships, yMap);

  // Arc anchor is at the TEXT-SIDE edge of the arc column (not the verse-label side).
  // The arc then bows inward toward the verse label, so it "points to" the text.
  //   arcGoesLeft  → anchor at left edge of arc col  = labelLeftX  − ARC_COL
  //   !arcGoesLeft → anchor at right edge of arc col = labelRightX + ARC_COL
  function arcAnchorX(fromId: string, toId: string): number | undefined {
    if (arcGoesLeft) {
      const ll1 = labelLeftMap.get(fromId);
      const ll2 = labelLeftMap.get(toId);
      if (ll1 == null || ll2 == null) return undefined;
      return Math.min(ll1, ll2) - ARC_COL;
    } else {
      const lr1 = labelRightMap.get(fromId);
      const lr2 = labelRightMap.get(toId);
      if (lr1 == null || lr2 == null) return undefined;
      return Math.max(lr1, lr2) + ARC_COL;
    }
  }

  function dotX(wordId: string): number | undefined {
    const ll = labelLeftMap.get(wordId);
    const lr = labelRightMap.get(wordId);
    if (ll == null || lr == null) return undefined;
    return arcGoesLeft ? ll - ARC_COL : lr + ARC_COL;
  }

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
        zIndex:        5,
      }}
    >
      {/* ── Arrowhead markers (one per subordinate type) ─────────────────── */}
      <defs>
        {RELATIONSHIP_TYPES
          .filter((rt) => rt.category === "subordinate")
          .map((rt) => (
            <marker
              key={rt.key}
              id={`clrel-arrow-${rt.key}`}
              markerWidth="5"
              markerHeight="4"
              refX="4"
              refY="2"
              orient="auto"
            >
              <polygon points="0 0, 5 2, 0 4" fill={rt.color} />
            </marker>
          ))}
      </defs>

      {relationships.map((rel) => {
        const y1 = yMap.get(rel.fromSegWordId);
        const y2 = yMap.get(rel.toSegWordId);
        if (y1 == null || y2 == null) return null;

        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const midY = (minY + maxY) / 2;

        const rt = RELATIONSHIP_MAP[rel.relType];
        if (!rt) return null;
        const { color, abbr } = rt;
        const isSubordinate = rt.category === "subordinate";
        const isHov = hoveredId === rel.id;

        const level = levelMap.get(rel.id) ?? 0;
        const span  = maxY - minY;
        // Depth capped so arcs stay within the 80px dedicated arc column
        const depth = Math.min(BASE_DEPTH + level * LEVEL_STEP + span * 0.04, 70 + level * LEVEL_STEP);
        const anchorX = arcAnchorX(rel.fromSegWordId, rel.toSegWordId);
        if (anchorX == null) return null;

        // Anchor is at the TEXT side of the arc column; control point bows TOWARD the verse
        // label so the arc concave opening faces the text ("points to" the text).
        //   arcGoesLeft (left arc col): anchor is left of verse label → bow RIGHT (+ depth)
        //   !arcGoesLeft (right arc col): anchor is right of verse label → bow LEFT (− depth)
        const curveLeft = arcGoesLeft;
        const controlX  = curveLeft ? anchorX + depth : anchorX - depth;
        const apexX     = (anchorX + controlX) / 2;

        const arcPath = `M ${anchorX} ${y1} Q ${controlX} ${midY} ${anchorX} ${y2}`;

        // Label sits on the concave (text-facing) side of the arc.
        // Since the arc bows toward the label (right for left arc, left for right arc),
        // the concave side is on the TEXT side → opposite sign vs. control direction.
        const labelAnchor   = curveLeft ? "end"   : "start";
        const labelOffsetX  = curveLeft ? apexX - 3  : apexX + 3;
        const deleteOffsetX = curveLeft ? apexX - 14 : apexX + 14;

        return (
          <g key={rel.id}>
            {/* ── Source / single-col arc ───────────────────────────────── */}
            <path
              d={arcPath}
              fill="none"
              stroke={color}
              strokeWidth={isHov ? 2 : 1.5}
              markerEnd={isSubordinate ? `url(#clrel-arrow-${rel.relType})` : undefined}
            />

            <text
              x={labelOffsetX} y={midY + 4}
              textAnchor={labelAnchor} fontSize={9} fontFamily="monospace"
              fill={color} style={{ userSelect: "none" }}
            >
              {abbr}
            </text>

            <g
              style={{ pointerEvents: "auto", cursor: "pointer", opacity: isHov ? 1 : 0, transition: "opacity 0.15s" }}
              onMouseEnter={() => setHoveredId(rel.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onDeleteRelationship(rel.id)}
            >
              <circle cx={deleteOffsetX} cy={midY} r={8} fill="white" stroke={color} strokeWidth={1.5} />
              <text x={deleteOffsetX} y={midY + 3.5} textAnchor="middle" fontSize={10} fill={color} style={{ userSelect: "none" }}>×</text>
            </g>

            <path
              d={arcPath}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => setHoveredId(rel.id)}
              onMouseLeave={() => setHoveredId(null)}
            />

            {/* ── Mirror arc (translation side, 5-col layout only) ─────── */}
            {hasTranslation && hasSource && (() => {
              const mlr1 = labelRightMap.get(rel.fromSegWordId);
              const mlr2 = labelRightMap.get(rel.toSegWordId);
              if (mlr1 == null || mlr2 == null) return null;
              // Anchor at right (text) edge of translation arc column; bow left toward verse label.
              const mAnchorX  = Math.max(mlr1, mlr2) + ARC_COL;
              const mControlX = mAnchorX - depth;
              const mApexX    = (mAnchorX + mControlX) / 2;
              const mArcPath  = `M ${mAnchorX} ${y1} Q ${mControlX} ${midY} ${mAnchorX} ${y2}`;
              return (
                <g key={`mirror-${rel.id}`}>
                  <path
                    d={mArcPath}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHov ? 2 : 1.5}
                    markerEnd={isSubordinate ? `url(#clrel-arrow-${rel.relType})` : undefined}
                  />
                  <text
                    x={mApexX + 3} y={midY + 4}
                    textAnchor="start" fontSize={9} fontFamily="monospace"
                    fill={color} style={{ userSelect: "none" }}
                  >
                    {abbr}
                  </text>
                  <path
                    d={mArcPath}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ pointerEvents: "auto" }}
                    onMouseEnter={() => setHoveredId(rel.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* ── Segment selector dots (editing mode) ─────────────────────────── */}
      {editing &&
        paragraphFirstWordIds.map((wordId) => {
          const y  = yMap.get(wordId);
          const cx = dotX(wordId);
          if (y == null || cx == null) return null;
          const isSelected = wordId === selectedSegWordId;
          const dotColor   = isSelected ? "#7C3AED" : "#94A3B8";
          return (
            <circle
              key={wordId}
              cx={cx} cy={y}
              r={isSelected ? 7 : 5}
              fill={isSelected ? dotColor : "white"}
              stroke={dotColor} strokeWidth={1.5}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={() => onSelectSegment(wordId)}
            />
          );
        })}
    </svg>
  );
}
