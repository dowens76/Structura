"use client";

import { useRef, useState, type ComponentProps } from "react";
import ChapterDisplay from "@/components/text/ChapterDisplay";
import { SYNOPTIC_DEFAULT_TOOLBAR_VIS } from "@/components/controls/ToolbarCustomizer";
import ColumnHeading from "./ColumnHeading";

type ChapterDisplayOwnProps = ComponentProps<typeof ChapterDisplay>;

export interface SynopticColumn {
  /** Stable key — the column's passages.id. */
  key: string;
  label: string;
  refText: string;
  /** Every ChapterDisplay prop except the ones SynopticView supplies itself
   *  (active/navigationDisabled/headingSlot/toolbar-defaults/scroll-sync). */
  props: Omit<
    ChapterDisplayOwnProps,
    "active" | "headingSlot" | "navigationDisabled" |
    "toolbarVisibilityStorageKey" | "defaultToolbarVisibility" | "onScrollContainerRef" |
    "disableSidePanels"
  >;
}

const TOOLBAR_STORAGE_KEY = "structura:toolbarVisibility:synoptic";

/**
 * N independently-scrolling columns, each a full ChapterDisplay instance —
 * every editing/annotation feature from the regular chapter view works here
 * too, persisting to the same book/chapter/textSource-scoped tables (see
 * lib/db/scriptureLocus.ts). Columns are NOT row-aligned by verse (unlike
 * ParallelChapterView's OSHB/LXX same-book layout) since different books in a
 * pericope don't share a verse-per-verse correspondence — instead, scrolling
 * any column proportionally scrolls every other column (see registerContainer
 * below), which is a coarse but dependency-free way to keep them roughly
 * together without needing real verse-alignment data.
 */
export default function SynopticView({ columns }: { columns: SynopticColumn[] }) {
  // Tracks which column last had focus/hover/click — only that column's
  // ChapterDisplay instance responds to the global keydown shortcut handler
  // (see the `active` prop on ChapterDisplay), so multiple mounted instances
  // don't all react to the same keypress at once. Every column also sets
  // `navigationDisabled` so F8/F9/Ctrl+Arrow can't navigate the whole tab away
  // from this multi-column comparison to a plain single-chapter page, and
  // defaults its toolbar to just Tooltips + the Synoptic-comparison
  // annotation tool (text size is always shown, ungated) so the narrow
  // columns aren't cluttered with editing tools meant for the full single-
  // chapter view.
  const [activeIndex, setActiveIndex] = useState(0);

  // ── Proportional scroll sync ─────────────────────────────────────────────
  // Each column hands up its actual scrolling element via onScrollContainerRef.
  // When one scrolls, every other column's scrollTop is set to the same
  // fraction of ITS OWN scrollable range — approximate, not verse-aligned,
  // but keeps parallel passages roughly together regardless of how differently
  // long each column's text is.
  const containerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollHandlersRef = useRef<Map<HTMLDivElement, () => void>>(new Map());
  const syncingRef = useRef(false);

  function registerContainer(index: number, el: HTMLDivElement | null) {
    const prevEl = containerRefs.current[index];
    if (prevEl) {
      const prevHandler = scrollHandlersRef.current.get(prevEl);
      if (prevHandler) prevEl.removeEventListener("scroll", prevHandler);
      scrollHandlersRef.current.delete(prevEl);
    }
    containerRefs.current[index] = el;
    if (!el) return;

    const handler = () => {
      if (syncingRef.current) return;
      const scrollable = el.scrollHeight - el.clientHeight;
      const fraction = scrollable > 0 ? el.scrollTop / scrollable : 0;
      syncingRef.current = true;
      containerRefs.current.forEach((other, j) => {
        if (j === index || !other) return;
        const otherScrollable = other.scrollHeight - other.clientHeight;
        other.scrollTop = fraction * otherScrollable;
      });
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    el.addEventListener("scroll", handler, { passive: true });
    scrollHandlersRef.current.set(el, handler);
  }

  return (
    <div
      className="h-full min-h-0 grid"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((col, i) => {
        const isActive = activeIndex === i;
        return (
          <div
            key={col.key}
            className="h-full min-h-0 min-w-0 flex flex-col"
            style={i > 0 ? { borderLeft: "1px solid var(--border)" } : undefined}
            onFocusCapture={() => setActiveIndex(i)}
            onMouseDownCapture={() => setActiveIndex(i)}
          >
            <ChapterDisplay
              {...col.props}
              active={isActive}
              navigationDisabled
              toolbarVisibilityStorageKey={TOOLBAR_STORAGE_KEY}
              defaultToolbarVisibility={SYNOPTIC_DEFAULT_TOOLBAR_VIS}
              onScrollContainerRef={(el) => registerContainer(i, el)}
              disableSidePanels
              headingSlot={<ColumnHeading label={col.label} refText={col.refText} active={isActive} />}
            />
          </div>
        );
      })}
    </div>
  );
}
