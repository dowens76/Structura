"use client";

import { useLayoutEffect, useMemo, useRef, useState, useCallback, RefObject } from "react";
import type { PoetryNotation } from "@/lib/db/schema";
import { measureSegments, type SegPos } from "./measureSegments";
import { isGapAnchor, gapBelowLineId } from "@/lib/poetry/anchorPoints";
import { computePoetryAnchorLayout, stackOffsets, POETRY_STACK_STEP_PX, type PoetryAnchorLayout } from "@/lib/poetry/computePoetryAnchorLayout";
import { balanceGlyph, darkenColor, POETRY_COLORS, type BalanceSubtype, type ImbalanceDirection } from "@/lib/poetry/constants";
import PoetryNotePopover from "./PoetryNotePopover";

// ── Layout constants — all within the EXISTING poetry column's own width,
// no extra horizontal space reserved beyond what already existed. ──────────
const BRACKET_LANE_W = 16; // px — narrow lane closest to the text, Balance's bracket only
const TICK_LEN        = 4;  // px — bracket end-cap length
const ANCHOR_GAP       = 10; // px between the bracket lane and the anchor-dot column
const GLYPH_GAP        = 14; // px between the anchor dot and where stacked glyphs render
const DOT_R            = 3.5; // matches RstRelationOverlay/LineGroupOverlay's leaf-selector dots
const GLYPH_FONT_SIZE  = "1.75rem";
// Symmetry inner-repeat glyphs (see isInnerRepeat) render 20% smaller than
// the outer glyph — every inner repeat at a given anchor shares this same
// size regardless of how many there are, rather than shrinking further with
// each additional occurrence.
const INNER_GLYPH_FONT_SIZE = "1.4rem";
// Fixed width the glyph <span> is centered within (text-align: center) —
// wide enough for the outer (largest) glyph. Without this, a left-aligned
// smaller inner glyph would sit visually left-of-center relative to a
// stacked outer glyph above/below it, since a smaller character in a
// same-left-edge box is narrower and its own center sits further left.
const GLYPH_BOX_W = 24; // px
// Inset each bracket's own top/bottom by this much, toward its own center —
// guarantees a small visible gap between two brackets that share an anchor
// (one's bottom sitting exactly where another's top starts) or otherwise
// overlap, rather than their strokes merging into what reads as one bracket.
const BRACKET_VGAP_HALF = 2;

export interface Props {
  balanceMarks: PoetryNotation[];
  symmetryMarks: PoetryNotation[];
  containerRef: RefObject<HTMLDivElement | null>;
  paragraphFirstWordIds: string[];
  editing: boolean;
  /** "balance" | "symmetry" | anything else — dots (the clickable anchor
   *  ladder) only render for whichever of the two is currently the active
   *  sub-tool; existing marks' brackets/glyphs always render regardless. */
  activePrinciple: string;
  /** The anchor pending as this tool's first click (highlighted while awaiting the second). */
  pendingAnchor: string | null;
  onSelectAnchor?: (anchorId: string) => void;
  openNotationId: number | null;
  onOpenNotation: (id: number | null) => void;
  onDeleteMark?: (id: number) => void;
  onSaveNote?: (id: number, note: string | null) => void;
  /** Shows a small dot on any glyph whose mark has a note — the note itself
   *  was always available via the glyph's native hover tooltip, but with no
   *  visual cue, so it was practically undiscoverable. */
  showNotes?: boolean;
  /** Forces a re-measure when something outside this component's own props
   *  changed the `[data-poetry-col]` anchor's visibility (e.g. a margin-panel
   *  toggle) — a value-only trigger like this is more reliable than the
   *  is more reliable here than the MutationObserver alone. */
  remeasureKey?: string | number;
}

/**
 * Draws the shared Balance/Imbalance + Symmetry margin: a narrow bracket lane
 * right next to the text (Balance only), then a ladder of anchor points — one
 * per poetic line and one in the gap between each adjacent pair — running
 * through the rest of the existing poetry column's width. Both principles
 * pick two anchors from this same ladder; Balance's bracket spans them with
 * its symbol centered on the anchor exactly midway between, Symmetry's two
 * triangles sit directly on its own two anchors. When a Balance and a
 * Symmetry occurrence land on the same anchor they stack vertically —
 * Symmetry pushed to the outer side (matching its own start/end role),
 * Balance to the inner side — rather than ever widening the column.
 */
export default function PoetryMarginOverlay({
  balanceMarks,
  symmetryMarks,
  containerRef,
  paragraphFirstWordIds,
  editing,
  activePrinciple,
  pendingAnchor,
  onSelectAnchor,
  openNotationId,
  onOpenNotation,
  onDeleteMark,
  onSaveNote,
  showNotes = false,
  remeasureKey,
}: Props) {
  const [svgH, setSvgH] = useState(0);
  const [posMap, setPosMap] = useState<Map<string, SegPos>>(new Map());
  const [colX, setColX] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const layout: PoetryAnchorLayout = useMemo(
    () => computePoetryAnchorLayout(balanceMarks, symmetryMarks, paragraphFirstWordIds),
    [balanceMarks, symmetryMarks, paragraphFirstWordIds]
  );

  // A line's true top/bottom is whichever of the source text or its
  // translation(s) extends furthest — the translation block's own baseline
  // padding (tvPaddingTop, aligning its first line with the verse label) can
  // actually start it a little ABOVE the source text's top, not just below,
  // so both edges take a min/max rather than assuming source always wins.
  const lineFullTop = useCallback((pos: SegPos) => Math.min(pos.top, pos.transTop ?? pos.top), []);
  const lineFullBottom = useCallback((pos: SegPos) => Math.max(pos.bottom, pos.transBottom ?? pos.bottom), []);

  // The anchor's own click/display point — vertically centered in the FULL
  // space a line occupies (source text plus any translation(s) beneath it,
  // not just the source's own first line), so it doesn't sit high and to one
  // side of a two-translation line. A gap anchor centers between the line
  // above's true bottom (translations included) and the line below's top.
  const anchorCenterY = useCallback((anchorId: string): number | null => {
    if (!isGapAnchor(anchorId)) {
      const pos = posMap.get(anchorId);
      return pos ? (lineFullTop(pos) + lineFullBottom(pos)) / 2 : null;
    }
    const belowId = gapBelowLineId(anchorId);
    const idx = paragraphFirstWordIds.indexOf(belowId);
    if (idx <= 0) return null;
    const posAbove = posMap.get(paragraphFirstWordIds[idx - 1]);
    const posBelow = posMap.get(belowId);
    if (!posAbove || !posBelow) return null;
    return (lineFullBottom(posAbove) + lineFullTop(posBelow)) / 2;
  }, [posMap, paragraphFirstWordIds, lineFullTop, lineFullBottom]);

  // Bracket endpoints: a LINE endpoint extends the bracket to that line's own
  // true top/bottom edge (encompassing all of its text, not just its center
  // anchor point) — a GAP endpoint has no extent of its own, so it just uses
  // the gap's own center point.
  const anchorTopEdgeY = useCallback((anchorId: string): number | null => {
    if (isGapAnchor(anchorId)) return anchorCenterY(anchorId);
    const pos = posMap.get(anchorId);
    return pos ? lineFullTop(pos) : null;
  }, [posMap, anchorCenterY, lineFullTop]);
  const anchorBottomEdgeY = useCallback((anchorId: string): number | null => {
    if (isGapAnchor(anchorId)) return anchorCenterY(anchorId);
    const pos = posMap.get(anchorId);
    return pos ? lineFullBottom(pos) : null;
  }, [posMap, anchorCenterY, lineFullBottom]);

  const scheduleRemeasure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        setPosMap(measureSegments(paragraphFirstWordIds, container));
        setSvgH(container.scrollHeight);
        const col = container.querySelector<HTMLElement>("[data-poetry-col]");
        if (!col) { setColX(null); return; }
        const containerRect = container.getBoundingClientRect();
        setColX(col.getBoundingClientRect().left - containerRect.left);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, paragraphFirstWordIds.join(",")]);

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
    // remeasureKey is a signal-only trigger, intentionally not read in the body.
  }, [scheduleRemeasure, containerRef, remeasureKey]);

  const showDots = editing && (activePrinciple === "balance" || activePrinciple === "symmetry");
  const hasAnything = balanceMarks.length > 0 || symmetryMarks.length > 0 || showDots;

  if (!hasAnything || !svgH || colX === null) return null;

  const bracketX = colX + BRACKET_LANE_W / 2;
  const dotX = colX + BRACKET_LANE_W + ANCHOR_GAP;
  const glyphX = dotX + GLYPH_GAP;

  return (
    <>
      <svg
        className="absolute inset-0 overflow-visible pointer-events-none z-10"
        style={{ width: "100%", height: svgH }}
        aria-hidden="true"
      >
        {/* Balance brackets — narrow lane closest to the text. Extends to each
            selected line's own true top/bottom edge (all of its text, including
            any translation(s)), not just its center anchor point. */}
        {layout.balanceBrackets.map(({ mark, topAnchor, bottomAnchor }) => {
          const rawTop = anchorTopEdgeY(topAnchor);
          const rawBottom = anchorBottomEdgeY(bottomAnchor);
          if (rawTop == null || rawBottom == null) return null;
          const mid = (rawTop + rawBottom) / 2;
          const yTop = Math.min(mid, rawTop + BRACKET_VGAP_HALF);
          const yBottom = Math.max(mid, rawBottom - BRACKET_VGAP_HALF);
          const pathD = `M ${bracketX - TICK_LEN},${yTop} H ${bracketX} V ${yBottom} H ${bracketX - TICK_LEN}`;
          return (
            <path
              key={mark.id}
              d={pathD}
              fill="none"
              stroke={POETRY_COLORS.balance}
              strokeWidth={editing ? 2 : 1.5}
              opacity={0.85}
              style={{ pointerEvents: "none" }}
            />
          );
        })}

        {/* Anchor-point ladder — one dot per line, one per gap, clickable while
            Balance or Symmetry is the active sub-tool. */}
        {showDots && layout.sequence.map((anchorId) => {
          const y = anchorCenterY(anchorId);
          if (y == null) return null;
          const isPending = anchorId === pendingAnchor;
          const color = activePrinciple === "balance" ? POETRY_COLORS.balance : POETRY_COLORS.symmetry;
          return (
            <circle
              key={anchorId}
              cx={dotX} cy={y} r={DOT_R}
              fill={isPending ? color : "transparent"}
              stroke={isPending ? color : "#94A3B8"}
              strokeWidth={1.5}
              style={{ cursor: "pointer", pointerEvents: "all" }}
              onClick={(e) => { e.stopPropagation(); onSelectAnchor?.(anchorId); }}
            />
          );
        })}
      </svg>

      {/* Stacked glyphs — Symmetry pushed outer (top/bottom of the local
          stack, per its own start/end role), Balance inner. */}
      {[...layout.occurrencesByAnchor.entries()].flatMap(([anchorId, occs]) => {
        const y = anchorCenterY(anchorId);
        if (y == null) return [];
        const offsets = stackOffsets(occs.length, POETRY_STACK_STEP_PX);
        return occs.map((occ, i) => {
          const glyph = occ.type === "balance"
            ? balanceGlyph(occ.mark.subtype as BalanceSubtype | null, occ.mark.direction as ImbalanceDirection | null)
            : occ.role === "start" ? "▼" : "▲";
          const baseColor = occ.type === "balance" ? POETRY_COLORS.balance : POETRY_COLORS.symmetry;
          // Symmetry applied more than once to the same line: repeats beyond
          // the first render smaller and darker so they read as nested inside
          // the original rather than as clutter.
          const color = occ.isInnerRepeat ? darkenColor(baseColor, 0.25) : baseColor;
          const fontSize = occ.isInnerRepeat ? INNER_GLYPH_FONT_SIZE : GLYPH_FONT_SIZE;
          const key = `${occ.type}-${occ.mark.id}-${occ.role ?? ""}`;
          return (
            <PoetryGlyph
              key={key}
              x={glyphX}
              y={y + offsets[i]}
              glyph={glyph}
              color={color}
              fontSize={fontSize}
              pairNumber={occ.type === "symmetry" ? occ.pairNumber : undefined}
              mark={occ.mark}
              editing={editing}
              open={openNotationId === occ.mark.id}
              onOpen={() => onOpenNotation(occ.mark.id)}
              onClose={() => onOpenNotation(null)}
              onDelete={onDeleteMark}
              onSave={onSaveNote}
              showNotes={showNotes}
            />
          );
        });
      })}
    </>
  );
}

function PoetryGlyph({
  x, y, glyph, color, fontSize = GLYPH_FONT_SIZE, pairNumber, mark, editing, open, onOpen, onClose, onDelete, onSave, showNotes,
}: {
  x: number; y: number; glyph: string; color: string; fontSize?: string; pairNumber?: number; mark: PoetryNotation;
  editing: boolean; open: boolean;
  onOpen: () => void; onClose: () => void;
  onDelete?: (id: number) => void;
  onSave?: (id: number, note: string | null) => void;
  showNotes?: boolean;
}) {
  const noteText = mark.note?.trim() || null;
  return (
    <div
      className="absolute z-20 flex items-center gap-1"
      style={{ left: x, top: y, transform: "translateY(-50%)" }}
    >
      <span
        className={["font-bold leading-none shrink-0 inline-block text-center", editing ? "cursor-pointer" : ""].join(" ")}
        style={{ color, fontSize, width: GLYPH_BOX_W }}
        onClick={editing ? (e) => { e.stopPropagation(); onOpen(); } : undefined}
        title={!showNotes ? (mark.note ?? undefined) : undefined}
      >
        {glyph}
      </span>
      {pairNumber != null && (
        // Same number on both triangles of a Symmetry pair, so which one
        // matches which is identifiable at a glance — not part of the glyph
        // click target, so it doesn't shift the existing note-open behavior.
        <span className="text-[10px] font-bold leading-none shrink-0" style={{ color }}>
          {pairNumber}
        </span>
      )}
      {showNotes && noteText && (
        <span
          className="text-[10px] italic leading-tight px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300"
          style={{ maxWidth: 160 }}
        >
          {noteText}
        </span>
      )}
      {open && editing && onDelete && onSave && (
        <PoetryNotePopover mark={mark} color={color} onSave={onSave} onDelete={onDelete} onClose={onClose} />
      )}
    </div>
  );
}
