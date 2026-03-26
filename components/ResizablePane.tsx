"use client";

/**
 * ResizablePane — wraps a right-side panel with a draggable left-edge handle.
 *
 * Renders a React Fragment containing:
 *   1. A 1 px drag handle (wider invisible hit-target, highlights on hover/drag)
 *   2. A fixed-width content div (width persisted in localStorage)
 *
 * Usage inside a flex-row parent:
 *   <ResizablePane storageKey="pane-notes-width" defaultWidth={320}>
 *     <YourPane />
 *   </ResizablePane>
 */

import { useRef, useState, useEffect, type ReactNode } from "react";

interface Props {
  /** localStorage key used to persist the width across sessions. */
  storageKey: string;
  /** Initial width in px (used when no stored value exists). */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  children: ReactNode;
}

export default function ResizablePane({
  storageKey,
  defaultWidth,
  minWidth = 200,
  maxWidth = 700,
  children,
}: Props) {
  const [width, setWidth] = useState(defaultWidth);
  const [hovered,  setHovered]  = useState(false);
  const [dragging, setDragging] = useState(false);

  // Keep a ref so event handlers always see the latest value without re-registering.
  const widthRef   = useRef(width);
  const draggingRef = useRef(false);
  const startX     = useRef(0);
  const startW     = useRef(0);

  useEffect(() => { widthRef.current = width; }, [width]);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n)) setWidth(clamp(n, minWidth, maxWidth));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Global mouse-move / mouse-up listeners (attached only once).
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      // Handle is on the LEFT edge of the pane.  Moving left → wider.
      const delta = startX.current - e.clientX;
      const w = clamp(startW.current + delta, minWidth, maxWidth);
      setWidth(w);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      localStorage.setItem(storageKey, String(widthRef.current));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  // storageKey / min / max are stable props — no need to re-register.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    draggingRef.current = true;
    setDragging(true);
    startX.current = e.clientX;
    startW.current = widthRef.current;
    e.preventDefault(); // prevent text selection during drag
  }

  const active = hovered || dragging;

  return (
    <>
      {/* ── Drag handle ────────────────────────────────────────────────── */}
      <div
        className="relative shrink-0 select-none"
        style={{
          width: "1px",
          cursor: "col-resize",
          // Slightly widen visually while active so the user sees feedback.
          outline: active ? "2px solid var(--accent, #3b82f6)" : "none",
          outlineOffset: "-1px",
          backgroundColor: "var(--border)",
          transition: dragging ? "none" : "outline 0.1s",
        }}
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-hidden="true"
      >
        {/* Wider invisible hit-target (8 px total centred on the 1 px line). */}
        <div
          style={{
            position: "absolute",
            top: 0, bottom: 0,
            left: "-4px", right: "-4px",
            cursor: "col-resize",
          }}
        />
      </div>

      {/* ── Pane content ───────────────────────────────────────────────── */}
      <div
        className="shrink-0 min-h-0 flex flex-col"
        style={{
          width,
          // Prevent content from visually escaping the pane during a drag.
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
