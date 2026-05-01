"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ClauseRelationship } from "@/lib/db/schema";
import { RELATIONSHIP_MAP, RELATIONSHIP_TYPES } from "@/lib/morphology/clauseRelationships";

// Width of the dedicated arc column in the verse grid (matches VerseDisplay grid).
const ARC_COL = 80;
// Subordinate right-angle arrow: how far into the arc column the corner sits.
// Sized to just fit a 3-char label (≈16 px) plus padding on each side.
const BASE_DEPTH = 30;
// Extra depth per nesting level (both subordinate and coordinate).
const LEVEL_STEP = 20;
// Coordinate bracket: base tick length (shallow — bracket stays compact).
const BRACKET_BASE = 16;

type IntersectPoint = "start" | "mid" | "end";

interface SegmentPoint {
  wordId: string;
  y: number;
  labelLeftX: number;   // container-relative left edge of [data-seg-label] element
  labelRightX: number;  // container-relative right edge of [data-seg-label] element
  wordRightX: number;   // container-relative right edge of [data-word-id] element (or label right if absent)
  wordLeftX: number;    // container-relative left edge of [data-word-id] element (or label left if absent)
  transLeftX: number;   // container-relative left edge of translation text, after indent padding (5-col only)
}

/**
 * A group of relationships that share the same nucleus (fromSegWordId) and
 * relationship type.  They are rendered as a single multi-arm bracket.
 */
interface RelGroup {
  groupKey: string;        // `${fromSegWordId}::${relType}`
  fromSegWordId: string;   // nucleus
  relType: string;
  toSegs: Array<{ wordId: string; id: number; intersectPoint: IntersectPoint }>;
}

/** Pre-computed geometry for a group (used to extend arms to nested spines). */
interface GroupGeo {
  cornerX: number;
  spanMinY: number;
  spanMaxY: number;
}

interface Props {
  relationships: ClauseRelationship[];
  containerRef: RefObject<HTMLDivElement | null>; // the scrollable div — sole positioning ref
  isHebrew: boolean;
  hasTranslation: boolean;
  hasSource: boolean;       // false when source text is hidden (translation-only mode)
  editing: boolean;
  paragraphFirstWordIds: string[];
  selectedSegWordId: string | null;       // nucleus selection — shown in violet
  selectedToSegWordId?: string | null;    // satellite selection — shown in amber
  onSelectSegment: (wordId: string) => void;
  onDeleteRelationship: (id: number) => void;
  onUpdateIntersectPoint?: (id: number, point: IntersectPoint) => void;
}

/**
 * Compute the position of a paragraph segment in content-relative coordinates.
 */
function getSegmentPos(
  wordId: string,
  container: HTMLElement,
): { y: number; labelLeftX: number; labelRightX: number; wordRightX: number; wordLeftX: number; transLeftX: number } | null {
  const wordEl  = container.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  const labelEl = container.querySelector(`[data-seg-label="${CSS.escape(wordId)}"]`);
  if (!labelEl) return null;

  const cRect   = container.getBoundingClientRect();
  const posEl   = wordEl ?? labelEl;
  const posRect = posEl.getBoundingClientRect();
  const lRect   = labelEl.getBoundingClientRect();
  const wRect   = wordEl ? wordEl.getBoundingClientRect() : lRect;

  const transEl  = container.querySelector(`[data-seg-translation="${CSS.escape(wordId)}"]`);
  const transPEl = transEl?.querySelector("p") ?? transEl;
  const transPRect = transPEl ? transPEl.getBoundingClientRect() : null;
  const transLeftX = transPRect != null
    ? transPRect.left - cRect.left
    : lRect.right + ARC_COL;

  const y = posRect.top - cRect.top + container.scrollTop + posRect.height / 2;

  return {
    y,
    labelLeftX:  lRect.left  - cRect.left,
    labelRightX: lRect.right - cRect.left,
    wordRightX:  wRect.right - cRect.left,
    wordLeftX:   wRect.left  - cRect.left,
    transLeftX,
  };
}

/**
 * Group relationships by fromSegWordId + relType.
 */
function buildRelGroups(relationships: ClauseRelationship[]): RelGroup[] {
  const map = new Map<string, RelGroup>();
  for (const rel of relationships) {
    const key = `${rel.fromSegWordId}::${rel.relType}`;
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key,
        fromSegWordId: rel.fromSegWordId,
        relType: rel.relType,
        toSegs: [],
      });
    }
    const ip = (rel.intersectPoint ?? "mid") as IntersectPoint;
    map.get(key)!.toSegs.push({ wordId: rel.toSegWordId, id: rel.id, intersectPoint: ip });
  }
  return [...map.values()];
}

/**
 * Assign nesting levels to relationship groups so overlapping paths don't collide.
 * Shorter-span groups get lower (inner) levels.
 */
function assignGroupArcLevels(
  groups: RelGroup[],
  yMap: Map<string, number>,
): Map<string, number> {
  type Entry = { key: string; minY: number; maxY: number };
  const entries: Entry[] = [];

  for (const group of groups) {
    const fromY = yMap.get(group.fromSegWordId);
    if (fromY == null) continue;
    const toYs = group.toSegs
      .map((s) => yMap.get(s.wordId))
      .filter((y): y is number => y != null);
    if (toYs.length === 0) continue;
    const allYs = [fromY, ...toYs];
    entries.push({
      key:  group.groupKey,
      minY: Math.min(...allYs),
      maxY: Math.max(...allYs),
    });
  }

  entries.sort((a, b) => (a.maxY - a.minY) - (b.maxY - b.minY));

  const levelMap = new Map<string, number>();
  const occupied: Array<{ minY: number; maxY: number; level: number }> = [];

  for (const entry of entries) {
    let level = 0;
    while (occupied.some((o) => o.level === level && o.minY < entry.maxY && o.maxY > entry.minY)) {
      level++;
    }
    levelMap.set(entry.key, level);
    occupied.push({ minY: entry.minY, maxY: entry.maxY, level });
  }

  return levelMap;
}

/**
 * Build a map from each segment word-id to its connected coordinate group.
 */
function buildCoordGroups(
  relationships: ClauseRelationship[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const rel of relationships) {
    const rt = RELATIONSHIP_MAP[rel.relType];
    if (!rt || rt.category !== "coordinate") continue;
    const { fromSegWordId: a, toSegWordId: b } = rel;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  const groupOf = new Map<string, string[]>();
  const visited = new Set<string>();

  for (const startId of adj.keys()) {
    if (visited.has(startId)) continue;
    const group: string[] = [];
    const queue = [startId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      group.push(curr);
      for (const nb of (adj.get(curr) ?? [])) queue.push(nb);
    }
    for (const id of group) groupOf.set(id, group);
  }

  return groupOf;
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
  selectedToSegWordId,
  onSelectSegment,
  onDeleteRelationship,
  onUpdateIntersectPoint,
}: Props) {
  const [points, setPoints]       = useState<SegmentPoint[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
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
  const wordLeftMap   = new Map(points.map((p) => [p.wordId, p.wordLeftX]));

  if (svgHeight === 0) return null;

  // ── Arc direction flags ─────────────────────────────────────────────────
  const arcGoesLeft = hasSource;
  const arcFarLeft  = hasSource && !isHebrew && !hasTranslation;
  const arcFarLeftWithTrans = hasSource && !isHebrew && hasTranslation;

  const minWordLeftX = arcFarLeftWithTrans
    ? Math.min(...points.map((p) => p.wordLeftX))
    : Infinity;

  const wordNearMap = new Map(
    points.map((p) => [
      p.wordId,
      arcFarLeft          ? p.labelLeftX
      : arcFarLeftWithTrans ? p.wordLeftX
      : arcGoesLeft       ? p.wordRightX
      : p.wordLeftX
    ])
  );

  const transNearMap = new Map(points.map((p) => [p.wordId, p.transLeftX]));

  const relGroups   = buildRelGroups(relationships);
  const groupLevels = assignGroupArcLevels(relGroups, yMap);
  const coordGroups = buildCoordGroups(relationships);

  function anchorXFor(...wordIds: string[]): number | undefined {
    if (arcFarLeftWithTrans) {
      const wls = wordIds.map((id) => wordLeftMap.get(id)).filter((x): x is number => x != null);
      if (wls.length === 0) return undefined;
      return Math.min(...wls) - ARC_COL;
    }
    if (arcGoesLeft) {
      const lls = wordIds.map((id) => labelLeftMap.get(id)).filter((x): x is number => x != null);
      if (lls.length === 0) return undefined;
      return Math.min(...lls) - ARC_COL;
    } else {
      const lrs = wordIds.map((id) => labelRightMap.get(id)).filter((x): x is number => x != null);
      if (lrs.length === 0) return undefined;
      return Math.max(...lrs) + ARC_COL;
    }
  }

  function dotX(wordId: string): number | undefined {
    const ll = labelLeftMap.get(wordId);
    const lr = labelRightMap.get(wordId);
    if (ll == null || lr == null) return undefined;
    if (arcFarLeft)          return ll - ARC_COL / 2;
    if (arcFarLeftWithTrans) return minWordLeftX - ARC_COL / 2;
    return arcGoesLeft ? ll - ARC_COL : lr + ARC_COL;
  }

  const LABEL_GAP = 4;

  function armTipX(wordId: string): number | undefined {
    const wn = wordNearMap.get(wordId);
    if (arcGoesLeft) {
      if (arcFarLeft) {
        if (wn != null) return wn - LABEL_GAP;
        const ll = labelLeftMap.get(wordId);
        return ll != null ? ll - LABEL_GAP : undefined;
      } else if (arcFarLeftWithTrans) {
        return minWordLeftX - LABEL_GAP;
      } else {
        if (wn != null) return wn + LABEL_GAP;
        const ll = labelLeftMap.get(wordId);
        return ll != null ? ll - ARC_COL + LABEL_GAP : undefined;
      }
    } else {
      if (wn != null) return wn - LABEL_GAP;
      const lr = labelRightMap.get(wordId);
      return lr != null ? lr + ARC_COL - LABEL_GAP : undefined;
    }
  }

  // ── Pre-pass: compute group geometry (cornerX + initial Y span) ─────────
  // This map lets higher-level brackets find the spine position of lower-level
  // brackets that are nested at their arm tips, so arms can extend all the way
  // to the nested bracket's vertical line instead of stopping at the word edge.
  const groupGeoMap = new Map<string, GroupGeo>();

  for (const group of relGroups) {
    const { fromSegWordId, toSegs, groupKey, relType } = group;
    const rt = RELATIONSHIP_MAP[relType];
    if (!rt) continue;
    const isSubordinate = rt.category === "subordinate";

    const nucleusY_raw = yMap.get(fromSegWordId);
    if (nucleusY_raw == null) continue;

    const validToSegs = toSegs.filter((s) => yMap.get(s.wordId) != null);
    if (validToSegs.length === 0) continue;

    // Nucleus Y: adjust to coordinate-group midpoint for subordinate brackets
    let nucleusY = nucleusY_raw;
    if (isSubordinate) {
      const cg = coordGroups.get(fromSegWordId);
      if (cg && cg.length > 1) {
        const cgYs = cg.map((id) => yMap.get(id)).filter((y): y is number => y != null);
        if (cgYs.length > 1) nucleusY = (Math.min(...cgYs) + Math.max(...cgYs)) / 2;
      }
    }

    const satelliteYs = validToSegs.map((s) => yMap.get(s.wordId)!);
    const allArmYs    = [nucleusY, ...satelliteYs];
    const spanMinY    = Math.min(...allArmYs);
    const spanMaxY    = Math.max(...allArmYs);
    if (spanMinY === spanMaxY) continue;

    const allWordIds  = [fromSegWordId, ...validToSegs.map((s) => s.wordId)];
    const spineAnchor = anchorXFor(...allWordIds);
    if (spineAnchor == null) continue;

    const level   = groupLevels.get(groupKey) ?? 0;
    const depth   = isSubordinate ? BASE_DEPTH + level * LEVEL_STEP : BRACKET_BASE + level * LEVEL_STEP;
    const cornerX = arcGoesLeft ? spineAnchor + depth : spineAnchor - depth;

    groupGeoMap.set(groupKey, { cornerX, spanMinY, spanMaxY });
  }

  // segment-id → all geos for brackets that contain this segment.
  // For subordinate brackets: only the nucleus (fromSeg) is indexed.
  // For coordinate brackets: all members (fromSeg + toSegs) share the same spine,
  // so all are indexed — this lets higher-level arms extend to the coordinate spine
  // even when the satellite is a toSeg rather than the fromSeg of the inner bracket.
  const segToGeoMap = new Map<string, GroupGeo[]>();
  for (const group of relGroups) {
    const geo = groupGeoMap.get(group.groupKey);
    if (!geo) continue;
    const rt = RELATIONSHIP_MAP[group.relType];
    const isCoord = rt?.category === "coordinate";

    const segIds = [group.fromSegWordId];
    if (isCoord) {
      for (const s of group.toSegs) segIds.push(s.wordId);
    }

    for (const segId of segIds) {
      if (!segToGeoMap.has(segId)) segToGeoMap.set(segId, []);
      segToGeoMap.get(segId)!.push(geo);
    }
  }

  /**
   * When a segment is itself the nucleus of a bracket, return the shallowest
   * such bracket's geo — this is the target for an arm extension.
   * "Shallowest" = spine closest to text (smallest depth into the arc column).
   */
  function getNestedGeo(wordId: string): GroupGeo | undefined {
    const geos = segToGeoMap.get(wordId);
    if (!geos || geos.length === 0) return undefined;
    return geos.reduce((best, g) =>
      arcGoesLeft ? (g.cornerX < best.cornerX ? g : best)
                  : (g.cornerX > best.cornerX ? g : best)
    );
  }

  /**
   * Effective arm tip X: extend to nested bracket's spine when the segment is
   * itself a bracket nucleus; otherwise use the word/label edge.
   */
  function effectiveTipX(wordId: string): number | undefined {
    const nested = getNestedGeo(wordId);
    return nested ? nested.cornerX : armTipX(wordId);
  }

  /**
   * Effective arm Y: if the segment is a bracket nucleus, use the intersect
   * point within that bracket's span; otherwise use the raw segment Y.
   */
  function effectiveY(wordId: string, ip: IntersectPoint, fallbackY: number): number {
    const nested = getNestedGeo(wordId);
    if (!nested) return fallbackY;
    if (ip === "start") return nested.spanMinY;
    if (ip === "end")   return nested.spanMaxY;
    return (nested.spanMinY + nested.spanMaxY) / 2;
  }

  // ── Render ──────────────────────────────────────────────────────────────
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
      {/* ── Arrowhead markers ───────────────────────────────────────────── */}
      <defs>
        {RELATIONSHIP_TYPES
          .filter((rt) => rt.category === "subordinate")
          .flatMap((rt) => [
            <marker
              key={rt.key}
              id={`clrel-arrow-${rt.key}`}
              markerWidth="5" markerHeight="4"
              refX="4" refY="2"
              orient="auto"
            >
              <polygon points="0 0, 5 2, 0 4" fill={rt.color} />
            </marker>,
            <marker
              key={`rev-${rt.key}`}
              id={`clrel-arrow-rev-${rt.key}`}
              markerWidth="5" markerHeight="4"
              refX="4" refY="2"
              orient="auto-start-reverse"
            >
              <polygon points="0 0, 5 2, 0 4" fill={rt.color} />
            </marker>,
          ])}
      </defs>

      {/* ── Relationship groups ─────────────────────────────────────────── */}
      {relGroups.map((group) => {
        const { fromSegWordId, relType, toSegs, groupKey } = group;
        const rt = RELATIONSHIP_MAP[relType];
        if (!rt) return null;
        const { color, abbr } = rt;
        const isSubordinate = rt.category === "subordinate";
        const isHov = hoveredKey === groupKey;

        const nucleusY_raw = yMap.get(fromSegWordId);
        if (nucleusY_raw == null) return null;

        const validToSegs = toSegs.filter((s) => yMap.get(s.wordId) != null);
        if (validToSegs.length === 0) return null;

        // Nucleus Y: subordinate brackets originate from coordinate-group midpoint
        let nucleusY = nucleusY_raw;
        if (isSubordinate) {
          const cg = coordGroups.get(fromSegWordId);
          if (cg && cg.length > 1) {
            const cgYs = cg.map((id) => yMap.get(id)).filter((y): y is number => y != null);
            if (cgYs.length > 1) nucleusY = (Math.min(...cgYs) + Math.max(...cgYs)) / 2;
          }
        }

        const allWordIds  = [fromSegWordId, ...validToSegs.map((s) => s.wordId)];
        const spineAnchor = anchorXFor(...allWordIds);
        if (spineAnchor == null) return null;

        const level = groupLevels.get(groupKey) ?? 0;
        const depth = isSubordinate
          ? BASE_DEPTH + level * LEVEL_STEP
          : BRACKET_BASE + level * LEVEL_STEP;
        const cornerX = arcGoesLeft ? spineAnchor + depth : spineAnchor - depth;

        const strokeWidth = isHov ? 2 : 1.5;

        // ── Effective nucleus arm ───────────────────────────────────────
        // Extend to nested bracket's spine when the nucleus is itself a bracket.
        const nucleusTipX = effectiveTipX(fromSegWordId);
        if (nucleusTipX == null) return null;
        // Nucleus always connects at the midpoint of the nested bracket (if any)
        const effNucleusY = effectiveY(fromSegWordId, "mid", nucleusY);

        // ── Effective satellite arms ────────────────────────────────────
        const satData = validToSegs.flatMap((s) => {
          const rawSatY = yMap.get(s.wordId);
          if (rawSatY == null) return [];
          const sy    = effectiveY(s.wordId, s.intersectPoint, rawSatY);
          const tipX  = effectiveTipX(s.wordId);
          if (tipX == null) return [];

          const armPath = isSubordinate
            ? `M ${cornerX} ${sy} H ${tipX}`
            : `M ${tipX} ${sy} H ${cornerX}`;
          const delX = (tipX + cornerX) / 2;
          return [{ s, sy, tipX, armPath, delX, rawSatY }];
        });

        // Spine spans effective Y range of all arms
        const allEffectiveYs = [effNucleusY, ...satData.map((d) => d.sy)];
        const spanMinY = Math.min(...allEffectiveYs);
        const spanMaxY = Math.max(...allEffectiveYs);

        if (spanMinY === spanMaxY) return null;

        const nucleusArmPath = `M ${nucleusTipX} ${effNucleusY} H ${cornerX}`;
        const verticalPath   = `M ${cornerX} ${spanMinY} V ${spanMaxY}`;

        // ── Label ───────────────────────────────────────────────────────
        const extremalSatY = satData
          .map((d) => d.sy)
          .reduce((ex, y) =>
            Math.abs(y - effNucleusY) > Math.abs(ex - effNucleusY) ? y : ex,
            satData[0]?.sy ?? effNucleusY,
          );
        const labelY = extremalSatY > effNucleusY
          ? extremalSatY - 3
          : extremalSatY + 10;

        const bracketOpensLeft = arcGoesLeft && !arcFarLeft && !arcFarLeftWithTrans;
        const labelX   = bracketOpensLeft ? cornerX - 2 : cornerX + 2;
        const labelAnc = bracketOpensLeft ? "end"        : "start";

        return (
          <g key={groupKey}>
            {/* Vertical spine */}
            <path d={verticalPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="miter" />

            {/* Nucleus arm */}
            <path d={nucleusArmPath} fill="none" stroke={color} strokeWidth={strokeWidth} />

            {/* Satellite arms */}
            {satData.map(({ s, armPath }) => (
              <path
                key={`arm-${s.id}`}
                d={armPath}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                markerEnd={isSubordinate ? `url(#clrel-arrow-${relType})` : undefined}
              />
            ))}

            {/* Label */}
            <text
              x={labelX} y={labelY}
              textAnchor={labelAnc} fontSize={9} fontFamily="monospace"
              fill={color} style={{ userSelect: "none" }}
            >
              {abbr}
            </text>

            {/* Hit targets for spine + nucleus arm */}
            <path
              d={verticalPath}
              fill="none" stroke="transparent" strokeWidth={12}
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => setHoveredKey(groupKey)}
              onMouseLeave={() => setHoveredKey(null)}
            />
            <path
              d={nucleusArmPath}
              fill="none" stroke="transparent" strokeWidth={12}
              style={{ pointerEvents: "auto" }}
              onMouseEnter={() => setHoveredKey(groupKey)}
              onMouseLeave={() => setHoveredKey(null)}
            />

            {/* Per-satellite: hit target + delete button */}
            {satData.map(({ s, sy, armPath, delX }) => (
              <g key={`sat-${s.id}`}>
                <path
                  d={armPath}
                  fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: "auto" }}
                  onMouseEnter={() => setHoveredKey(groupKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                />
                <g
                  style={{ pointerEvents: "auto", cursor: "pointer", opacity: isHov ? 1 : 0, transition: "opacity 0.15s" }}
                  onMouseEnter={() => setHoveredKey(groupKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() => onDeleteRelationship(s.id)}
                >
                  <circle cx={delX} cy={sy} r={8} fill="white" stroke={color} strokeWidth={1.5} />
                  <text x={delX} y={sy + 3.5} textAnchor="middle" fontSize={10} fill={color} style={{ userSelect: "none" }}>×</text>
                </g>

                {/* Intersect-point selector — shown in editing mode when the
                    satellite arm connects to a nested bracket's spine.
                    Three dots mark start/mid/end; active dot is filled. */}
                {editing && onUpdateIntersectPoint && (() => {
                  const nested = getNestedGeo(s.wordId);
                  if (!nested) return null;
                  const positions: Array<{ ip: IntersectPoint; y: number; label: string }> = [
                    { ip: "start", y: nested.spanMinY, label: "⊤" },
                    { ip: "mid",   y: (nested.spanMinY + nested.spanMaxY) / 2, label: "·" },
                    { ip: "end",   y: nested.spanMaxY, label: "⊥" },
                  ];
                  const dotCx = nested.cornerX;
                  return positions.map(({ ip, y: dotY, label }) => {
                    const isActive = s.intersectPoint === ip;
                    return (
                      <g
                        key={`ipt-${s.id}-${ip}`}
                        style={{ pointerEvents: "auto", cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); onUpdateIntersectPoint(s.id, ip); }}
                        onMouseEnter={() => setHoveredKey(groupKey)}
                        onMouseLeave={() => setHoveredKey(null)}
                        title={`Connect at ${ip === "start" ? "top" : ip === "end" ? "bottom" : "middle"} of bracket`}
                      >
                        <circle
                          cx={dotCx} cy={dotY} r={5}
                          fill={isActive ? color : "white"}
                          stroke={color} strokeWidth={1.5}
                          opacity={0.85}
                        />
                        <text
                          x={dotCx} y={dotY + 3.5}
                          textAnchor="middle" fontSize={7}
                          fill={isActive ? "white" : color}
                          style={{ userSelect: "none", pointerEvents: "none" }}
                        >
                          {label}
                        </text>
                      </g>
                    );
                  });
                })()}
              </g>
            ))}

            {/* Mirror bracket on translation side (5-col layout only) */}
            {hasTranslation && hasSource && (() => {
              const allLRs = allWordIds
                .map((id) => labelRightMap.get(id))
                .filter((x): x is number => x != null);
              if (allLRs.length === 0) return null;
              const mSpineAnchor = Math.max(...allLRs) + ARC_COL;
              const mCornerX     = mSpineAnchor - depth;
              const mLabelX   = mCornerX + 2;
              const mLabelAnc = "start";

              const mNucleusLR = labelRightMap.get(fromSegWordId);
              if (mNucleusLR == null) return null;
              const mNucleusTipX = (transNearMap.get(fromSegWordId) ?? mNucleusLR + ARC_COL) - LABEL_GAP;
              const mNucleusArmPath = `M ${mNucleusTipX} ${effNucleusY} H ${mCornerX}`;

              const mSatPaths = validToSegs.flatMap((s) => {
                const satEntry = satData.find((d) => d.s.id === s.id);
                const sy = satEntry?.sy ?? yMap.get(s.wordId);
                const lr = labelRightMap.get(s.wordId);
                if (sy == null || lr == null) return [];
                const mTipX = (transNearMap.get(s.wordId) ?? lr + ARC_COL) - LABEL_GAP;
                const mArmPath = isSubordinate
                  ? `M ${mCornerX} ${sy} H ${mTipX}`
                  : `M ${mTipX} ${sy} H ${mCornerX}`;
                return [{ id: s.id, sy, mArmPath }];
              });

              return (
                <g key={`mirror-${groupKey}`}>
                  <path d={`M ${mCornerX} ${spanMinY} V ${spanMaxY}`} fill="none" stroke={color} strokeWidth={strokeWidth} />
                  <path d={mNucleusArmPath} fill="none" stroke={color} strokeWidth={strokeWidth} />
                  {mSatPaths.map(({ id, mArmPath }) => (
                    <path
                      key={id}
                      d={mArmPath}
                      fill="none" stroke={color} strokeWidth={strokeWidth}
                      markerEnd={isSubordinate ? `url(#clrel-arrow-${relType})` : undefined}
                    />
                  ))}
                  <text
                    x={mLabelX} y={labelY}
                    textAnchor={mLabelAnc} fontSize={9} fontFamily="monospace"
                    fill={color} style={{ userSelect: "none" }}
                  >
                    {abbr}
                  </text>
                  <path
                    d={`M ${mCornerX} ${spanMinY} V ${spanMaxY}`}
                    fill="none" stroke="transparent" strokeWidth={12}
                    style={{ pointerEvents: "auto" }}
                    onMouseEnter={() => setHoveredKey(groupKey)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* ── Coordinate-group midpoint dots (editing mode) ───────────────── */}
      {editing && (() => {
        const renderedKeys = new Set<string>();
        return [...coordGroups.entries()].flatMap(([wordId, group]) => {
          if (group.length < 2) return [];
          const key = [...group].sort().join("|");
          if (renderedKeys.has(key)) return [];
          renderedKeys.add(key);

          const groupYs = group
            .map((id) => yMap.get(id))
            .filter((y): y is number => y != null);
          if (groupYs.length < 2) return [];

          const groupMidY = (Math.min(...groupYs) + Math.max(...groupYs)) / 2;
          const cx = dotX(wordId);
          if (cx == null) return [];

          const repId = group.reduce((best, id) => {
            const y     = yMap.get(id) ?? Infinity;
            const bestY = yMap.get(best) ?? Infinity;
            return Math.abs(y - groupMidY) < Math.abs(bestY - groupMidY) ? id : best;
          });

          const isSelected = repId === selectedSegWordId || group.includes(selectedSegWordId ?? "");
          const ringColor  = isSelected ? "#7C3AED" : "#0891B2";

          return [
            <g
              key={`coord-mid-${key}`}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={() => onSelectSegment(repId)}
            >
              <circle cx={cx} cy={groupMidY} r={7} fill="white" stroke={ringColor} strokeWidth={1.5} />
              <circle cx={cx} cy={groupMidY} r={2.5} fill={ringColor} />
            </g>,
          ];
        });
      })()}

      {/* ── Segment selector dots (editing mode) ─────────────────────────── */}
      {editing &&
        paragraphFirstWordIds.map((wordId) => {
          const y  = yMap.get(wordId);
          const cx = dotX(wordId);
          if (y == null || cx == null) return null;

          const isFrom = wordId === selectedSegWordId;
          const isTo   = wordId === selectedToSegWordId;

          const dotColor = isFrom ? "#7C3AED" : isTo ? "#D97706" : "#94A3B8";
          const radius   = isFrom ? 7 : isTo ? 6 : 5;
          const filled   = isFrom || isTo;

          return (
            <circle
              key={wordId}
              cx={cx} cy={y}
              r={radius}
              fill={filled ? dotColor : "white"}
              stroke={dotColor} strokeWidth={1.5}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={() => onSelectSegment(wordId)}
            />
          );
        })}
    </svg>
  );
}
