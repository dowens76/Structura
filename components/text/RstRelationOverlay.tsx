"use client";

import { useLayoutEffect, useRef, useState, useCallback, RefObject } from "react";
import type { RstRelation } from "@/lib/db/schema";
import { RELATIONSHIP_MAP } from "@/lib/morphology/clauseRelationships";

// ── Layout constants ──────────────────────────────────────────────────────────
const HANG_PX     = 32;  // must match VerseDisplay HANG_PX
const SIDE_OFFSET = 6;   // px outside the segment text-start edge for the vertical RST line
const TICK_PAD    = 5;   // px above/below segment row for the bracket tick anchor points

// ── Types ─────────────────────────────────────────────────────────────────────

interface SegPos {
  top: number;         // content-relative top Y (px)
  bottom: number;      // content-relative bottom Y (px)
  leftX: number;       // left edge of source text span (px from container left)
  rightX: number;      // right edge of source text span (px from container left)
  transLeftX?: number; // left edge of translation div, if visible
}

/** One "rendered group" — all geometry calculated for a single groupId. */
interface GroupGeom {
  groupId: string;
  relType: string;
  category: "coordinate" | "subordinate";
  lineX: number;       // absolute SVG x of the source vertical line
  transLineX?: number; // absolute SVG x of the translation mirror line (if visible)
  topY: number;        // top of line (center Y of first member)
  bottomY: number;     // bottom of line (center Y of last member)
  /** Between-member labels: [{y, text, color}] */
  labels: { y: number; text: string; color: string }[];
  /** Members sorted by Y for rendering dots and bracket ticks */
  members: { segWordId: string; role: string; y: number; lineX: number; segTop: number; segBottom: number; textStartX: number }[];
  /** Center-Y of each satellite segment (subordinate only) — for branch arrows */
  satelliteYs: number[];
}

export interface Props {
  relations: RstRelation[];
  containerRef: RefObject<HTMLDivElement | null>;
  isHebrew: boolean;
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedNucleusWordId: string | null;
  selectedSatelliteWordId: string | null;
  editingGroupId?: string | null;      // group whose label chip is being edited (highlighted)
  onSelectSegment: (wordId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup?: (groupId: string) => void; // click chip body → change relation type
}

// ── Position measurement ──────────────────────────────────────────────────────

function measureSegments(
  wordIds: string[],
  container: HTMLElement
): Map<string, SegPos> {
  const cRect     = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;
  const result    = new Map<string, SegPos>();

  for (const id of wordIds) {
    // Outer div → top/bottom (full vertical extent of the segment row)
    const outerEl = container.querySelector<HTMLElement>(`[data-rst-seg="${CSS.escape(id)}"]`);
    if (!outerEl) continue;
    const outerR = outerEl.getBoundingClientRect();

    // Source text span → leftX/rightX so lines anchor to text start
    const textEl = container.querySelector<HTMLElement>(`[data-rst-text="${CSS.escape(id)}"]`) ?? outerEl;
    const textR  = textEl.getBoundingClientRect();

    // Translation mirror: use the translation cell div's left edge directly.
    // The cell div IS the translation column, so its left edge reliably reflects
    // where the translation content begins (regardless of inner paragraph structure).
    const transEl    = container.querySelector<HTMLElement>(`[data-seg-translation="${CSS.escape(id)}"]`);
    const transLeftX = transEl ? transEl.getBoundingClientRect().left - cRect.left : undefined;

    result.set(id, {
      top:    outerR.top    - cRect.top + scrollTop,
      bottom: outerR.bottom - cRect.top + scrollTop,
      leftX:  textR.left    - cRect.left,
      rightX: textR.right   - cRect.left,
      transLeftX,
    });
  }
  return result;
}

// ── Geometry builder ──────────────────────────────────────────────────────────

function buildGroupGeometries(
  relations: RstRelation[],
  posMap: Map<string, SegPos>,
  isHebrew: boolean
): GroupGeom[] {
  // Group relations by groupId
  const byGroup = new Map<string, RstRelation[]>();
  for (const r of relations) {
    const arr = byGroup.get(r.groupId) ?? [];
    arr.push(r);
    byGroup.set(r.groupId, arr);
  }

  const geoms: GroupGeom[] = [];

  for (const [groupId, members] of byGroup) {
    if (!members.length) continue;
    const relType  = members[0].relType;
    const relMeta  = RELATIONSHIP_MAP[relType];
    const category = (relMeta?.category ?? "subordinate") as "coordinate" | "subordinate";

    // Resolve positions and sort by Y
    const withPos = members
      .map((m) => ({ ...m, pos: posMap.get(m.segWordId) }))
      .filter((m): m is typeof m & { pos: SegPos } => m.pos !== undefined)
      .sort((a, b) => a.pos.top - b.pos.top);

    if (!withPos.length) continue;

    // Source line X: 2px inward from the text-start edge of each member's text span.
    // Use the most-outward segment as the anchor so all members share one vertical line.
    const refPos = withPos.reduce(
      (best, m) => (isHebrew
        ? m.pos.rightX > best.pos.rightX ? m : best
        : m.pos.leftX  < best.pos.leftX  ? m : best
      ),
      withPos[0]
    ).pos;

    // Line placement:
    //   LTR:    SIDE_OFFSET px to the LEFT of leftX  — in the hanging-indent gap.
    //   Hebrew: SIDE_OFFSET px to the RIGHT of (rightX - HANG_PX) — in the RTL hanging-indent
    //           gap (continuation lines are indented HANG_PX from the right, leaving empty space
    //           between rightX-HANG_PX and rightX; the line sits at rightX-HANG_PX+SIDE_OFFSET).
    //           Using rightX + SIDE_OFFSET would push the line into the center label column or
    //           beyond the SVG viewport, so we anchor inside the hanging-indent zone instead.
    const lineX = isHebrew
      ? refPos.rightX - HANG_PX + SIDE_OFFSET
      : refPos.leftX  - SIDE_OFFSET;

    // Translation mirror line X: outside/left of transLeftX (always LTR)
    const transMembers  = withPos.filter(m => m.pos.transLeftX !== undefined);
    const minTransLeftX = transMembers.length > 0
      ? Math.min(...transMembers.map(m => m.pos.transLeftX!))
      : undefined;
    const transLineX = minTransLeftX !== undefined
      ? minTransLeftX - SIDE_OFFSET
      : undefined;

    // Vertical line spans from TICK_PAD above the first member's text top
    // to TICK_PAD below the last member's text bottom — matching the bracket ticks.
    const firstPos = withPos[0].pos;
    const lastPos  = withPos[withPos.length - 1].pos;
    const topY     = firstPos.top    - TICK_PAD;
    const bottomY  = lastPos.bottom  + TICK_PAD;

    // Labels between consecutive members.
    // Clamp so the chip (16px tall) stays entirely within the inter-segment gap.
    const CHIP_HALF = 8;
    const CHIP_H    = CHIP_HALF * 2; // 16px total height
    const labels: GroupGeom["labels"] = [];
    for (let i = 0; i < withPos.length - 1; i++) {
      const gapTop  = withPos[i].pos.bottom;
      const gapBot  = withPos[i + 1].pos.top;
      const gapMid  = (gapTop + gapBot) / 2;
      // Clamp both edges: chip top ≥ gapTop, chip bottom ≤ gapBot.
      // If the gap is narrower than the chip, center in the gap.
      const minY = gapTop + CHIP_HALF;
      const maxY = gapBot - CHIP_HALF;
      const y = minY <= maxY ? Math.max(minY, Math.min(maxY, gapMid)) : gapMid;
      labels.push({
        y,
        text:  relMeta?.abbr ?? relType.slice(0, 3),
        color: relMeta?.color ?? "#6B7280",
      });
    }

    // Post-pass: ensure consecutive chips never overlap each other.
    // If two chips are too close (gap < chip height + 2px clearance), push the
    // lower one down so they are separated by exactly chip height + 2px.
    for (let i = 1; i < labels.length; i++) {
      const minSep = labels[i - 1].y + CHIP_H + 2;
      if (labels[i].y < minSep) labels[i] = { ...labels[i], y: minSep };
    }

    const memberDots = withPos.map((m) => ({
      segWordId:  m.segWordId,
      role:       m.role,
      y:          m.pos.top + (m.pos.bottom - m.pos.top) / 2,
      lineX,
      segTop:     m.pos.top,
      segBottom:  m.pos.bottom,
      textStartX: isHebrew ? m.pos.rightX : m.pos.leftX,
    }));

    // Satellite center Ys — for the branch arrows on subordinate relations
    const satelliteYs = category === "subordinate"
      ? withPos
          .filter(m => m.role === "satellite")
          .map(m => m.pos.top + (m.pos.bottom - m.pos.top) / 2)
      : [];

    geoms.push({ groupId, relType, category, lineX, transLineX, topY, bottomY, labels, members: memberDots, satelliteYs });
  }

  return geoms;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RstRelationOverlay({
  relations,
  containerRef,
  isHebrew,
  editing,
  paragraphFirstWordIds,
  selectedNucleusWordId,
  selectedSatelliteWordId,
  editingGroupId,
  onSelectSegment,
  onDeleteGroup,
  onEditGroup,
}: Props) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number | null>(null);
  const [svgH, setSvgH] = useState(0);
  const [geoms, setGeoms] = useState<GroupGeom[]>([]);
  const [posMap, setPosMap] = useState<Map<string, SegPos>>(new Map());
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const allSegIds = [
    ...new Set([
      ...relations.map((r) => r.segWordId),
      ...(editing ? paragraphFirstWordIds : []),
    ]),
  ];

  // Use requestAnimationFrame (like WordArrowOverlay) so scrollHeight is non-zero at measurement.
  const scheduleRemeasure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const newH   = container.scrollHeight;
      const newPos = measureSegments(allSegIds, container);
      setPosMap(newPos);
      setSvgH(newH);
      setGeoms(buildGroupGeometries(relations, newPos, isHebrew));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relations, containerRef, isHebrew, editing, paragraphFirstWordIds.join(",")]);

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

  const relatedSegIds = new Set(relations.map((r) => r.segWordId));

  /**
   * Render a vertical line + label chips for one group at a given x position.
   * isTransMirror=true → translation side (always LTR chip placement, no hit target / delete ×).
   */
  const renderLine = (g: GroupGeom, lx: number, isTransMirror: boolean) => {
    const relMeta      = RELATIONSHIP_MAP[g.relType];
    const color        = relMeta?.color ?? "#6B7280";
    const isHovered    = hoveredGroup === g.groupId;
    const isEditingThis = !isTransMirror && editingGroupId === g.groupId;

    // Chip starts just past the line's stroke edge (touching, not overlapping).
    // For Hebrew the line sits inside the RTL hanging-indent zone (rightX - HANG_PX + SIDE_OFFSET),
    // so the chip goes to the right of the line (toward the text's right edge) to stay in that zone.
    const chipLeft = lx + 2;  // chip always to the right of the bracket line

    // Satellite branch arrows for subordinate relations.
    // Arrow points outward from the text (left for Hebrew, right for LTR/translation).
    // Stem starts exactly at the vertical line so they touch.
    const ARROW_LEN   = 8;  // total arrow length px
    const ARROW_TIP   = 4;  // arrowhead depth px
    const arrowDir    = (isTransMirror || !isHebrew) ? 1 : -1;  // +1 = right, -1 = left
    const tipX        = lx + arrowDir * ARROW_LEN;
    const stemX       = lx + arrowDir * (ARROW_LEN - ARROW_TIP);

    return (
      <>
        {/* Vertical line */}
        <line
          x1={lx} y1={g.topY}
          x2={lx} y2={g.bottomY}
          stroke={color}
          strokeWidth={editing ? 2 : 1.5}
          opacity={0.8}
          style={{ pointerEvents: "none" }}
        />

        {/* Per-member bracket ticks: a dot + horizontal line at segTop-2 and segBottom+2,
            anchored at the text-start X, connecting across to the vertical line. */}
        {g.members.map((m, mi) => {
          // Dot sits ON the vertical line (lx); a short tick extends toward the text start edge.
          // For LTR:    line is left of text  → tick goes right (+1) toward leftX.
          // For Hebrew: line is left of rightX → tick goes right (+1) toward rightX.
          // For trans:  line is left of translation column → tick goes right (+1).
          // In all cases tickDir = +1.
          const tickDir  = 1;
          const tickEndX = lx + tickDir * (SIDE_OFFSET - 3);
          const topTickY = m.segTop    - TICK_PAD;
          const botTickY = m.segBottom + TICK_PAD;
          return (
            <g key={`tick-${mi}`} style={{ pointerEvents: "none" }}>
              {/* Top anchor dot on the vertical line */}
              <circle cx={lx} cy={topTickY} r={2}
                fill={color} opacity={0.9} />
              {/* Top tick extending toward text */}
              <line x1={lx} y1={topTickY} x2={tickEndX} y2={topTickY}
                stroke={color} strokeWidth={1.5} opacity={0.7} />
              {/* Bottom anchor dot on the vertical line */}
              <circle cx={lx} cy={botTickY} r={2}
                fill={color} opacity={0.9} />
              {/* Bottom tick extending toward text */}
              <line x1={lx} y1={botTickY} x2={tickEndX} y2={botTickY}
                stroke={color} strokeWidth={1.5} opacity={0.7} />
            </g>
          );
        })}

        {/* Satellite branch arrows (subordinate only) */}
        {g.satelliteYs.map((satY, si) => (
          <g key={`arr-${si}`} style={{ pointerEvents: "none" }}>
            {/* Arrow stem */}
            <line
              x1={lx} y1={satY}
              x2={stemX} y2={satY}
              stroke={color}
              strokeWidth={editing ? 2 : 1.5}
              opacity={0.8}
            />
            {/* Arrowhead */}
            <polygon
              points={`${stemX},${satY - ARROW_TIP / 2} ${tipX},${satY} ${stemX},${satY + ARROW_TIP / 2}`}
              fill={color}
              opacity={0.8}
            />
          </g>
        ))}

        {/* Wide transparent hit-target for hover + delete (source line only) */}
        {editing && !isTransMirror && (
          <line
            x1={lx} y1={g.topY}
            x2={lx} y2={g.bottomY}
            stroke="transparent"
            strokeWidth={16}
            style={{ pointerEvents: "stroke", cursor: "pointer" }}
            onMouseEnter={() => setHoveredGroup(g.groupId)}
            onMouseLeave={() => setHoveredGroup(null)}
            onClick={() => onDeleteGroup(g.groupId)}
          />
        )}

        {/* Label chips between consecutive members */}
        {g.labels.map((lbl, li) => (
          <g
            key={li}
            onMouseEnter={() => editing && !isTransMirror && setHoveredGroup(g.groupId)}
            onMouseLeave={() => editing && !isTransMirror && setHoveredGroup(null)}
            style={{ pointerEvents: (editing && !isTransMirror) ? "all" : "none" }}
          >
            {/* Active-edit highlight ring (white outline around the chip) */}
            {isEditingThis && (
              <rect
                x={chipLeft - 3}
                y={lbl.y - 10}
                width={30}
                height={20}
                rx={4}
                fill="none"
                stroke="white"
                strokeWidth={2}
                opacity={1}
                style={{ pointerEvents: "none" }}
              />
            )}

            {/* Pill background — clickable to edit relation type */}
            <rect
              x={chipLeft - 1}
              y={lbl.y - 8}
              width={26}
              height={16}
              rx={3}
              fill={lbl.color}
              opacity={isEditingThis ? 1 : 0.9}
              style={{
                cursor: (editing && !isTransMirror && onEditGroup) ? "pointer" : "default",
                pointerEvents: "all",
              }}
              onClick={(e) => {
                if (editing && !isTransMirror && onEditGroup) {
                  e.stopPropagation();
                  onEditGroup(g.groupId);
                }
              }}
            />
            <text
              x={chipLeft + 12}
              y={lbl.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize={9}
              fontFamily="monospace"
              fontWeight="bold"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {lbl.text}
            </text>

            {/* Delete × badge on hover (source line only) */}
            {editing && !isTransMirror && isHovered && (
              <g
                style={{ cursor: "pointer", pointerEvents: "all" }}
                onClick={(e) => { e.stopPropagation(); onDeleteGroup(g.groupId); }}
              >
                <circle cx={chipLeft + 12} cy={lbl.y - 11} r={6} fill="#DC2626" />
                <text
                  x={chipLeft + 12} y={lbl.y - 7}
                  textAnchor="middle"
                  fill="white"
                  fontSize={9}
                  fontFamily="sans-serif"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >×</text>
              </g>
            )}
          </g>
        ))}
      </>
    );
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 overflow-visible pointer-events-none"
      style={{ width: "100%", height: svgH }}
      aria-hidden="true"
    >
      {/* ── RST group lines ──────────────────────────────────────────────── */}
      {geoms.map((g) => (
        <g key={g.groupId}>
          {/* Source-side line */}
          {renderLine(g, g.lineX, false)}
          {/* Translation mirror line (when a translation column is visible) */}
          {g.transLineX !== undefined && renderLine(g, g.transLineX, true)}
        </g>
      ))}

      {/* ── Editing mode: segment selector dots ──────────────────────────── */}
      {editing && paragraphFirstWordIds.map((wordId) => {
        const pos = posMap.get(wordId);
        if (!pos) return null;

        const isNucleus   = wordId === selectedNucleusWordId;
        const isSatellite = wordId === selectedSatelliteWordId;
        const isRelated   = relatedSegIds.has(wordId);

        const dotX = isHebrew
          ? pos.rightX - HANG_PX + SIDE_OFFSET  // same zone as the bracket line
          : pos.leftX  + SIDE_OFFSET;
        const dotY = pos.top + (pos.bottom - pos.top) / 2;

        const r      = isNucleus ? NUCLEUS_R : isSatellite ? SAT_R : SEG_R;
        const fill   = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "transparent";
        const stroke = isNucleus ? "#7C3AED" : isSatellite ? "#F59E0B" : "#94A3B8";
        const sw     = isNucleus || isSatellite ? 0 : 1.5;

        return (
          <circle
            key={wordId}
            cx={dotX} cy={dotY} r={r}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onClick={() => onSelectSegment(wordId)}
          />
        );
      })}
    </svg>
  );
}
