"use client";

import { useLayoutEffect, useRef, useState, useCallback, RefObject } from "react";
import type { RstRelation } from "@/lib/db/schema";
import { RELATIONSHIP_MAP } from "@/lib/morphology/clauseRelationships";

// ── Layout constants ──────────────────────────────────────────────────────────
const HANG_PX  = 32;          // must match VerseDisplay HANG_PX
const COORD_X  = 3;           // px from segment left/right edge for coordinate line
const SUBORD_X = HANG_PX - 3; // = 17px — inside hanging indent, 3px from continuation text

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
  /** Members sorted by Y for rendering dots */
  members: { segWordId: string; role: string; y: number; lineX: number }[];
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
  onSelectSegment: (wordId: string) => void;
  onDeleteGroup: (groupId: string) => void;
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

    // Translation mirror: left edge of the first text child inside the translation div.
    // Using the inner <p> (actual text content) rather than the outer div gives a cleaner
    // anchor — the line lands at the text's visual left margin, not the div's outer edge.
    const transEl    = container.querySelector<HTMLElement>(`[data-seg-translation="${CSS.escape(id)}"]`);
    const transTextEl = transEl?.querySelector<HTMLElement>("p, span") ?? transEl;
    const transLeftX = transTextEl ? transTextEl.getBoundingClientRect().left - cRect.left : undefined;

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

    // Source line X: use the leftmost (LTR) or rightmost (RTL) segment as anchor
    const refPos = withPos.reduce(
      (best, m) => (isHebrew
        ? m.pos.rightX > best.pos.rightX ? m : best
        : m.pos.leftX  < best.pos.leftX  ? m : best
      ),
      withPos[0]
    ).pos;

    const lineX = isHebrew
      ? refPos.rightX - (category === "coordinate" ? COORD_X : SUBORD_X)
      : refPos.leftX  + (category === "coordinate" ? COORD_X : SUBORD_X);

    // Translation mirror line X: leftmost transLeftX + offset (always LTR side)
    const transMembers  = withPos.filter(m => m.pos.transLeftX !== undefined);
    const minTransLeftX = transMembers.length > 0
      ? Math.min(...transMembers.map(m => m.pos.transLeftX!))
      : undefined;
    const transLineX = minTransLeftX !== undefined
      ? minTransLeftX + (category === "coordinate" ? COORD_X : SUBORD_X)
      : undefined;

    // Line Y endpoints:
    //   subordinate → nucleus edge faces away from the group (not through nucleus text)
    //   coordinate  → center-to-center of first/last member
    const firstPos    = withPos[0].pos;
    const lastPos     = withPos[withPos.length - 1].pos;
    const firstCenter = firstPos.top + (firstPos.bottom - firstPos.top) / 2;
    const lastCenter  = lastPos.top  + (lastPos.bottom  - lastPos.top)  / 2;

    let topY: number;
    let bottomY: number;

    if (category === "subordinate") {
      const nucPos = withPos.find(m => m.role === "nucleus")?.pos;
      if (nucPos) {
        const isNucFirst = nucPos.top === firstPos.top;
        const isNucLast  = nucPos.top === lastPos.top;
        if (isNucFirst) {
          // Nucleus at top: line starts at nucleus bottom edge (below its text)
          topY    = nucPos.bottom;
          bottomY = lastCenter;
        } else if (isNucLast) {
          // Nucleus at bottom: line ends at nucleus top edge (above its text)
          topY    = firstCenter;
          bottomY = nucPos.top;
        } else {
          // Nucleus in middle: fall back to centers
          topY    = firstCenter;
          bottomY = lastCenter;
        }
      } else {
        topY    = firstCenter;
        bottomY = lastCenter;
      }
    } else {
      // Coordinate: center-to-center
      topY    = firstCenter;
      bottomY = lastCenter;
    }

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
      segWordId: m.segWordId,
      role:      m.role,
      y:         m.pos.top + (m.pos.bottom - m.pos.top) / 2,
      lineX,
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
  onSelectSegment,
  onDeleteGroup,
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
    const relMeta   = RELATIONSHIP_MAP[g.relType];
    const color     = relMeta?.color ?? "#6B7280";
    const isHovered = hoveredGroup === g.groupId;

    // Chip starts just past the line's stroke edge (touching, not overlapping)
    // Source: LTR → chip to the right; RTL/Hebrew → chip to the left
    // Translation mirror: always LTR (chip to the right)
    const chipLeft = isTransMirror
      ? lx + 2
      : (isHebrew ? lx - 26 : lx + 2);  // lx-26 → chip right edge = lx-1 for Hebrew

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
            {/* Pill background */}
            <rect
              x={chipLeft - 1}
              y={lbl.y - 8}
              width={26}
              height={16}
              rx={3}
              fill={lbl.color}
              opacity={0.9}
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
                onClick={() => onDeleteGroup(g.groupId)}
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
          ? pos.rightX - (isRelated ? SUBORD_X - 1 : COORD_X - 1)
          : pos.leftX  + (isRelated ? SUBORD_X - 1 : COORD_X - 1);
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
