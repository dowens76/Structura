"use client";
/**
 * ChapterOverlays
 *
 * Renders the RST-relation and word-arrow SVG overlays that float over the
 * text area in both ChapterDisplay and PassageView.  Extracting them here
 * ensures the two views share identical rendering logic and lets each consumer
 * drive the overlays purely through the hook return values from
 * `useRstRelations` and `useWordArrows`.
 */
import type { RefObject } from "react";
import RstRelationOverlay from "./RstRelationOverlay";
import WordArrowOverlay from "./WordArrowOverlay";
import LineGroupOverlay from "./LineGroupOverlay";
import PoetryMarginOverlay from "./PoetryMarginOverlay";
import type { RstRelation, WordArrow, RstCustomType, LineGroup, PoetryNotation } from "@/lib/db/schema";
import type { ArrowPatch } from "@/lib/hooks/useWordArrows";

export interface ChapterOverlaysProps {
  // ── RST overlay ─────────────────────────────────────────────────────────────
  rstRelations: RstRelation[];
  /** Translation-side relations; pass undefined to omit the TV tree entirely. */
  tvRstRelations?: RstRelation[];
  /** True when the user is editing the translation tree (unlinked mode). */
  editingTranslation?: boolean;
  editingRst: boolean;
  rstSegA: string | null;
  rstSegB: string | null;
  rstSegAGroupId: string | null;
  /** groupId of the relation whose type chip is being edited. */
  rstEditGroupId?: string | null;
  paragraphFirstWordIds: string[];
  customRstTypes: RstCustomType[];
  isHebrew: boolean;
  hasTranslation: boolean;
  hideSourceTree?: boolean;
  onSelectRstSegment: (wordId: string) => void;
  onSelectRstGroup: (groupId: string) => void;
  onDeleteRstGroup: (groupId: string) => Promise<void>;
  onEditRstGroup?: (groupId: string) => void;
  onUpdateRstIntersectPoint?: (id: number, intersectPoint: "start" | "mid" | "end") => Promise<void>;
  onRequiredSourcePad?: (pad: number) => void;

  // ── Word-arrow overlay ───────────────────────────────────────────────────────
  wordArrows: WordArrow[];
  editingArrows: boolean;
  arrowFromWordId: string | null;
  onDeleteArrow: (id: number) => Promise<void>;
  onUpdateArrow: (id: number, patch: ArrowPatch) => Promise<void>;

  // ── Line-group bracket overlay ───────────────────────────────────────────────
  lineGroups: LineGroup[];
  editingLineGroups: boolean;
  lineGroupSegA: string | null;
  lineGroupSegAGroupId: string | null;
  getLineGroupColor: (level: number) => string;
  onSelectLineGroupSegment: (wordId: string) => void;
  onSelectLineGroupGroup: (groupId: string) => void;
  onDeleteLineGroup: (groupId: string) => void;
  onRequiredLineGroupPad?: (pad: number) => void;
  /** Poetry Notation tool's "bracket every poetic line" toggle — see
   *  LineGroupOverlay's showAutoLineBrackets prop. */
  showAutoLineBrackets?: boolean;
  excludedLineIds?: Set<string>;
  onToggleLineBracketExclusion?: (segFirstWordId: string) => void;

  // ── Balance/Imbalance + Symmetry margin overlay ──────────────────────────────
  balanceMarks: PoetryNotation[];
  symmetryMarks: PoetryNotation[];
  editingPoetryNotation?: boolean;
  activePrinciple: string;
  pendingPoetryAnchor: string | null;
  onSelectPoetryAnchor?: (anchorId: string) => void;
  openPoetryNotationId: number | null;
  onOpenPoetryNotation: (id: number | null) => void;
  onDeletePoetryMark?: (id: number) => void;
  onSavePoetryNote?: (id: number, note: string | null) => void;
  /** Forces PoetryMarginOverlay to re-measure — pass something that changes when
   *  its `[data-poetry-col]` anchor's visibility could have (e.g. panelDisplayMode). */
  poetryRemeasureKey?: string | number;

  // ── Shared layout refs ──────────────────────────────────────────────────────
  /** The scrollable content container — overlays render SVG inside this. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Optional outer wrapper without overflow clipping — used for arc extension. */
  layoutRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Drop-in overlay bundle.  Place this as the **first** child of the scrollable
 * content container so that it shares the same scroll canvas as the text rows.
 */
export default function ChapterOverlays({
  rstRelations,
  tvRstRelations,
  editingTranslation = false,
  editingRst,
  rstSegA,
  rstSegB,
  rstSegAGroupId,
  rstEditGroupId = null,
  paragraphFirstWordIds,
  customRstTypes,
  isHebrew,
  hasTranslation,
  hideSourceTree = false,
  onSelectRstSegment,
  onSelectRstGroup,
  onDeleteRstGroup,
  onEditRstGroup,
  onUpdateRstIntersectPoint,
  onRequiredSourcePad,
  wordArrows,
  editingArrows,
  arrowFromWordId,
  onDeleteArrow,
  onUpdateArrow,
  lineGroups,
  editingLineGroups,
  lineGroupSegA,
  lineGroupSegAGroupId,
  getLineGroupColor,
  onSelectLineGroupSegment,
  onSelectLineGroupGroup,
  onDeleteLineGroup,
  onRequiredLineGroupPad,
  showAutoLineBrackets = false,
  excludedLineIds,
  onToggleLineBracketExclusion,
  balanceMarks,
  symmetryMarks,
  editingPoetryNotation = false,
  activePrinciple,
  pendingPoetryAnchor,
  onSelectPoetryAnchor,
  openPoetryNotationId,
  onOpenPoetryNotation,
  onDeletePoetryMark,
  onSavePoetryNote,
  poetryRemeasureKey,
  containerRef,
  layoutRef,
}: ChapterOverlaysProps) {
  return (
    <>
      <RstRelationOverlay
        relations={rstRelations}
        tvRelations={tvRstRelations}
        editingTranslation={editingTranslation}
        containerRef={containerRef}
        layoutRef={layoutRef}
        isHebrew={isHebrew}
        hasTranslation={hasTranslation}
        hideSourceTree={hideSourceTree}
        editing={editingRst}
        paragraphFirstWordIds={paragraphFirstWordIds}
        selectedNucleusWordId={rstSegA}
        selectedSatelliteWordId={rstSegB}
        selectedNucleusGroupId={rstSegAGroupId}
        editingGroupId={rstEditGroupId}
        onSelectSegment={onSelectRstSegment}
        onDeleteGroup={onDeleteRstGroup}
        onEditGroup={onEditRstGroup}
        onSelectGroup={onSelectRstGroup}
        onUpdateRstIntersectPoint={onUpdateRstIntersectPoint}
        customTypes={customRstTypes}
        onRequiredSourcePad={onRequiredSourcePad}
      />
<WordArrowOverlay
        arrows={wordArrows}
        containerRef={containerRef}
        layoutRef={layoutRef}
        editing={editingArrows}
        selectedFromWordId={arrowFromWordId}
        onDeleteArrow={onDeleteArrow}
        onUpdateArrow={onUpdateArrow}
        isHebrew={isHebrew}
        hasTranslation={hasTranslation}
      />
      <LineGroupOverlay
        groups={lineGroups}
        containerRef={containerRef}
        layoutRef={layoutRef}
        isHebrew={isHebrew}
        hasTranslation={hasTranslation}
        editing={editingLineGroups}
        paragraphFirstWordIds={paragraphFirstWordIds}
        selectedSegA={lineGroupSegA}
        selectedSegAGroupId={lineGroupSegAGroupId}
        getColor={getLineGroupColor}
        onSelectSegment={onSelectLineGroupSegment}
        onSelectGroup={onSelectLineGroupGroup}
        onDeleteGroup={onDeleteLineGroup}
        showAutoLineBrackets={showAutoLineBrackets}
        excludedLineIds={excludedLineIds}
        onToggleLineBracketExclusion={onToggleLineBracketExclusion}
        onRequiredSourcePad={onRequiredLineGroupPad}
      />
      <PoetryMarginOverlay
        balanceMarks={balanceMarks}
        symmetryMarks={symmetryMarks}
        containerRef={containerRef}
        paragraphFirstWordIds={paragraphFirstWordIds}
        editing={editingPoetryNotation}
        activePrinciple={activePrinciple}
        pendingAnchor={pendingPoetryAnchor}
        onSelectAnchor={onSelectPoetryAnchor}
        openNotationId={openPoetryNotationId}
        onOpenNotation={onOpenPoetryNotation}
        onDeleteMark={onDeletePoetryMark}
        onSaveNote={onSavePoetryNote}
        remeasureKey={poetryRemeasureKey}
      />
    </>
  );
}
