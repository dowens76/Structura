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
  toSegs: Array<{ wordId: string; id: number }>;  // satellites
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
): { y: number; labelLeftX: number; labelRightX: number; wordRightX: number; wordLeftX: number; transLeftX: number } | null {
  const wordEl  = container.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`);
  const labelEl = container.querySelector(`[data-seg-label="${CSS.escape(wordId)}"]`);
  if (!labelEl) return null; // label must always be present

  const cRect   = container.getBoundingClientRect();
  // Use source word element when present; fall back to label when source is hidden.
  const posEl   = wordEl ?? labelEl;
  const posRect = posEl.getBoundingClientRect();
  const lRect   = labelEl.getBoundingClientRect();
  // Word rect for actual text position (tracks indentation); fall back to label rect.
  const wRect   = wordEl ? wordEl.getBoundingClientRect() : lRect;

  // Translation text position: the first <p> inside [data-seg-translation] is shifted by
  // paddingLeft on its parent, so its left edge correctly reflects the indent level.
  const transEl  = container.querySelector(`[data-seg-translation="${CSS.escape(wordId)}"]`);
  const transPEl = transEl?.querySelector("p") ?? transEl;
  const transPRect = transPEl ? transPEl.getBoundingClientRect() : null;
  // Fallback: labelRight + ARC_COL = the fixed Col-5 boundary (no indent tracking).
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
 * All relationships in a group share a nucleus and are rendered as one bracket.
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
    map.get(key)!.toSegs.push({ wordId: rel.toSegWordId, id: rel.id });
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

  // Sort by span (shorter first = lower/inner level)
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
 * Build a map from each segment word-id to its connected coordinate group
 * (all segments reachable via coordinate relationships).
 * Used to adjust subordinate fromY to the group midpoint and to render midpoint dots.
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
}: Props) {
  const [points, setPoints]       = useState<SegmentPoint[]>([]);
  const [svgHeight, setSvgHeight] = useState(0);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null); // groupKey of hovered bracket
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

  // Arc placement:
  //   Hebrew 5-col (hasSource + isHebrew + hasTranslation):
  //     source arc between Hebrew text and label (Col 2); mirror arc between label and translation (Col 4)
  //   Greek 5-col (hasSource + !isHebrew + hasTranslation):
  //     source arc on FAR LEFT (Col 1, before Greek text); mirror arc between label and translation (Col 4)
  //   Single-col Greek (hasSource + !isHebrew + !hasTranslation):
  //     arc on FAR LEFT (Col 1, before label and Greek text)
  //   Single-col Hebrew (hasSource + isHebrew + !hasTranslation):
  //     arc between Hebrew text and label (Col 2)
  //   Translation-only (!hasSource):
  //     single arc on RIGHT of verse label (into translation arc col)
  //
  // arcGoesLeft: spine is to the LEFT of its anchor landmark.
  //   true  — source text present; spine left of label
  //   false — translation-only; spine right of label
  const arcGoesLeft = hasSource;

  // arcFarLeft: single-col Greek — arc col is the leftmost column (before label+text).
  // Arm tips anchor at the label's left edge (= right edge of the arc col).
  const arcFarLeft = hasSource && !isHebrew && !hasTranslation;

  // arcFarLeftWithTrans: Greek 5-col — arc col is also far-left (before Greek text).
  // Arm tips anchor at the left edge of the Greek text (= right edge of the far-left arc col).
  // Uses wordLeftX (left edge of first Greek word) as the anchor instead of labelLeftX.
  const arcFarLeftWithTrans = hasSource && !isHebrew && hasTranslation;

  // Precompute the minimum wordLeftX across all measured points for the Greek 5-col far-left case.
  // This is the right boundary of the far-left arc col (≈ where Greek text begins).
  // Used to cap arm tips so they never extend into the Greek text column even for indented segments.
  const minWordLeftX = arcFarLeftWithTrans
    ? Math.min(...points.map((p) => p.wordLeftX))
    : Infinity;

  // wordNearMap: the edge of each segment closest to the arc column.
  //   arcFarLeft         → label's left edge     (single-col Greek: arc col right = label left)
  //   arcFarLeftWithTrans → word's left edge      (Greek 5-col: arc col right ≈ Greek text left)
  //   arcGoesLeft (Hebrew)→ word's right edge     (Hebrew: arc col is between text and label)
  //   !arcGoesLeft       → word's left edge       (translation-only: arc col right of label)
  const wordNearMap = new Map(
    points.map((p) => [
      p.wordId,
      arcFarLeft          ? p.labelLeftX   // Single-col Greek: anchor at label's left edge
      : arcFarLeftWithTrans ? p.wordLeftX  // Greek 5-col: anchor at Greek text's left edge
      : arcGoesLeft       ? p.wordRightX   // Hebrew: anchor at source word's right edge
      : p.wordLeftX                        // Translation-only: anchor at word/label left edge
    ])
  );

  // transNearMap: left edge of each segment's translation text (after indent padding).
  // Used by the mirror bracket arm tips in 5-col layout to track translation indentation.
  const transNearMap = new Map(points.map((p) => [p.wordId, p.transLeftX]));

  const relGroups   = buildRelGroups(relationships);
  const groupLevels = assignGroupArcLevels(relGroups, yMap);
  const coordGroups = buildCoordGroups(relationships);

  /**
   * anchorX = text-near edge of the arc column.
   * Computed from ALL member word IDs so the bracket accommodates every arm.
   *   arcFarLeftWithTrans → leftmost wordLeftX − ARC_COL   (Greek 5-col: left edge of far-left arc col)
   *   arcGoesLeft (others)→ leftmost labelLeftX − ARC_COL  (Hebrew / single-col Greek)
   *   !arcGoesLeft        → rightmost labelRightX + ARC_COL (translation-only)
   */
  function anchorXFor(...wordIds: string[]): number | undefined {
    if (arcFarLeftWithTrans) {
      // Greek 5-col: the far-left arc col's left edge = min(wordLeftX) − ARC_COL
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
    if (arcFarLeft)          return ll - ARC_COL / 2;             // Centre of far-left arc col (single-col Greek)
    if (arcFarLeftWithTrans) return minWordLeftX - ARC_COL / 2;   // Centre of far-left arc col (Greek 5-col)
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
      {/* ── Arrowhead markers (subordinate types only) ────────────────────── */}
      <defs>
        {RELATIONSHIP_TYPES
          .filter((rt) => rt.category === "subordinate")
          .flatMap((rt) => [
            // Standard marker (kept for any future markerEnd usage)
            <marker
              key={rt.key}
              id={`clrel-arrow-${rt.key}`}
              markerWidth="5" markerHeight="4"
              refX="4" refY="2"
              orient="auto"
            >
              <polygon points="0 0, 5 2, 0 4" fill={rt.color} />
            </marker>,
            // Reversed marker: used with markerStart on paths that go spine→text.
            // orient="auto-start-reverse" flips the orientation 180° at the start
            // vertex, so the arrowhead points away from the text (into the arc column).
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

      {/* ── Relationship groups ───────────────────────────────────────────── */}
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

        // ── Subordinate fromY adjustment ──────────────────────────────────
        // If the nucleus belongs to a coordinate group, start from that group's
        // vertical midpoint so the subordinate arrow originates at the bracket centre.
        let nucleusY = nucleusY_raw;
        if (isSubordinate) {
          const cg = coordGroups.get(fromSegWordId);
          if (cg && cg.length > 1) {
            const cgYs = cg.map((id) => yMap.get(id)).filter((y): y is number => y != null);
            if (cgYs.length > 1) {
              nucleusY = (Math.min(...cgYs) + Math.max(...cgYs)) / 2;
            }
          }
        }

        const satelliteYs = validToSegs.map((s) => yMap.get(s.wordId)!);
        const allArmYs    = [nucleusY, ...satelliteYs];
        const spanMinY    = Math.min(...allArmYs);
        const spanMaxY    = Math.max(...allArmYs);
        const span        = spanMaxY - spanMinY;

        if (span === 0) return null; // degenerate — all same Y

        const allWordIds = [fromSegWordId, ...validToSegs.map((s) => s.wordId)];

        // ── Spine position ─────────────────────────────────────────────────
        // cornerX is the vertical spine, placed at BASE_DEPTH inside the arc column.
        // We anchor it relative to the most-extreme label in the group so the spine
        // never overlaps any text label.
        const spineAnchor = anchorXFor(...allWordIds);
        if (spineAnchor == null) return null;

        const level = groupLevels.get(groupKey) ?? 0;
        const depth = isSubordinate
          ? BASE_DEPTH + level * LEVEL_STEP
          : BRACKET_BASE + level * LEVEL_STEP;
        const cornerX = arcGoesLeft ? spineAnchor + depth : spineAnchor - depth;

        const strokeWidth = isHov ? 2 : 1.5;

        // ── Label position ─────────────────────────────────────────────────
        // Sits inside the bracket at the inner corner nearest the extremal satellite
        // (the satellite farthest from the nucleus). This keeps it inside the bracket
        // angle where there are no arm lines or arrowheads.
        const extremalSatY = satelliteYs.reduce((ex, y) =>
          Math.abs(y - nucleusY) > Math.abs(ex - nucleusY) ? y : ex,
          satelliteYs[0],
        );
        const labelY = extremalSatY > nucleusY
          ? extremalSatY - 3   // satellite below → just above its arm
          : extremalSatY + 10; // satellite above → just below its arm
        // Bracket label sits inside the bracket angle, near the spine:
        //   Hebrew / Hebrew 5-col (bracket opens leftward): label left of spine → "end"
        //   Greek far-left single-col or 5-col (bracket opens rightward): label right of spine → "start"
        //   Translation-only (bracket opens rightward): label right of spine → "start"
        const bracketOpensLeft = arcGoesLeft && !arcFarLeft && !arcFarLeftWithTrans;
        const labelX   = bracketOpensLeft ? cornerX - 2 : cornerX + 2;
        const labelAnc = bracketOpensLeft ? "end"        : "start";

        // ── Per-arm tip positions ──────────────────────────────────────────
        // Each arm extends from the spine (cornerX) to the near edge of the arc column.
        const LABEL_GAP = 4; // px gap between arm tip and the arc-column boundary

        function armTipX(wordId: string): number | undefined {
          const wn = wordNearMap.get(wordId);
          if (arcGoesLeft) {
            if (arcFarLeft) {
              // Single-col Greek far-left: arm tip at right edge of arc col (= label's left − gap).
              if (wn != null) return wn - LABEL_GAP;
              const ll = labelLeftMap.get(wordId);
              return ll != null ? ll - LABEL_GAP : undefined;
            } else if (arcFarLeftWithTrans) {
              // Greek 5-col far-left: arm tip at right edge of far-left arc col (= min wordLeftX − gap).
              // All arms stop at the same x — the col boundary — regardless of word position or indent.
              return minWordLeftX - LABEL_GAP;
            } else {
              // Hebrew: arm points toward Hebrew text on the LEFT.
              // wn = wordRightX; tip just inside the arc col from the text side.
              if (wn != null) return wn + LABEL_GAP;
              const ll = labelLeftMap.get(wordId);
              return ll != null ? ll - ARC_COL + LABEL_GAP : undefined;
            }
          } else {
            // Translation-only: arm points RIGHT toward translation text.
            if (wn != null) return wn - LABEL_GAP;
            const lr = labelRightMap.get(wordId);
            return lr != null ? lr + ARC_COL - LABEL_GAP : undefined;
          }
        }

        // Nucleus arm: label-edge → spine, no arrowhead
        const nucleusTipX = armTipX(fromSegWordId);
        if (nucleusTipX == null) return null;
        const nucleusArmPath = `M ${nucleusTipX} ${nucleusY} H ${cornerX}`;

        // Pre-compute per-satellite data so each loop below can reuse it
        const satData = validToSegs.flatMap((s) => {
          const sy      = yMap.get(s.wordId);
          const tipX    = armTipX(s.wordId);
          if (sy == null || tipX == null) return [];
          // Subordinate: spine → label-edge (arrowhead at text-proximate end)
          // Coordinate:  label-edge → spine (no arrowhead; bracket look)
          const armPath = isSubordinate
            ? `M ${cornerX} ${sy} H ${tipX}`
            : `M ${tipX} ${sy} H ${cornerX}`;
          const delX = (tipX + cornerX) / 2;
          return [{ s, sy, tipX, armPath, delX }];
        });

        // ── Path segments ──────────────────────────────────────────────────
        const verticalPath = `M ${cornerX} ${spanMinY} V ${spanMaxY}`;

        return (
          <g key={groupKey}>
            {/* ── Vertical spine ───────────────────────────────────────── */}
            <path d={verticalPath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="miter" />

            {/* ── Nucleus arm (no arrowhead) ───────────────────────────── */}
            <path d={nucleusArmPath} fill="none" stroke={color} strokeWidth={strokeWidth} />

            {/* ── Satellite arms ───────────────────────────────────────── */}
            {/* Subordinate: path goes spine→text edge; markerEnd places the
                arrowhead at the text end, pointing toward the clause text. */}
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

            {/* ── Label ────────────────────────────────────────────────── */}
            <text
              x={labelX} y={labelY}
              textAnchor={labelAnc} fontSize={9} fontFamily="monospace"
              fill={color} style={{ userSelect: "none" }}
            >
              {abbr}
            </text>

            {/* ── Invisible hit-target for vertical spine + nucleus arm ─── */}
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

            {/* ── Per-satellite: hit target + delete button ─────────────── */}
            {satData.map(({ s, sy, armPath, delX }) => (
              <g key={`sat-${s.id}`}>
                {/* Hit target first so delete button is on top */}
                <path
                  d={armPath}
                  fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: "auto" }}
                  onMouseEnter={() => setHoveredKey(groupKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                />
                {/* Delete handle — shown when bracket is hovered */}
                <g
                  style={{ pointerEvents: "auto", cursor: "pointer", opacity: isHov ? 1 : 0, transition: "opacity 0.15s" }}
                  onMouseEnter={() => setHoveredKey(groupKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() => onDeleteRelationship(s.id)}
                >
                  <circle cx={delX} cy={sy} r={8} fill="white" stroke={color} strokeWidth={1.5} />
                  <text x={delX} y={sy + 3.5} textAnchor="middle" fontSize={10} fill={color} style={{ userSelect: "none" }}>×</text>
                </g>
              </g>
            ))}

            {/* ── Mirror bracket on translation side (5-col layout only) ── */}
            {hasTranslation && hasSource && (() => {
              const allLRs = allWordIds
                .map((id) => labelRightMap.get(id))
                .filter((x): x is number => x != null);
              if (allLRs.length === 0) return null;
              const mSpineAnchor = Math.max(...allLRs) + ARC_COL;
              const mCornerX     = mSpineAnchor - depth;
              // Mirror label: inside the bracket angle near the extremal satellite's corner.
              // mCornerX + 2 puts it just right of the spine, inside the bracket opening.
              const mLabelX   = mCornerX + 2;
              const mLabelAnc = "start";

              // Mirror nucleus arm: translation-text-edge → mCornerX (no arrowhead).
              // Prefer actual translation text left edge (tracks indent); fall back to
              // label-based arc-col boundary (= Col-5 fixed boundary, no indent tracking).
              const mNucleusLR = labelRightMap.get(fromSegWordId);
              if (mNucleusLR == null) return null;
              const mNucleusTipX = (transNearMap.get(fromSegWordId) ?? mNucleusLR + ARC_COL) - LABEL_GAP;
              const mNucleusArmPath = `M ${mNucleusTipX} ${nucleusY} H ${mCornerX}`;

              // Mirror satellite arms: each extends from mCornerX to the translation text,
              // arrowhead at the text end.  Prefer actual text left edge (tracks indent).
              const mSatPaths = validToSegs.flatMap((s) => {
                const sy = yMap.get(s.wordId);
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
                  {/* Hit target for mirror spine */}
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
      {/* One target-style dot per coordinate group, at the vertical midpoint of
          the bracket. Clicking selects the closest-to-midpoint member as the
          fromSeg, causing any subsequent subordinate arrow to originate from
          the middle of this bracket automatically. */}
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

          // Representative member: the one whose y is closest to groupMidY
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

          // nucleus: violet (larger filled), satellite: amber (smaller filled), others: slate outline
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
