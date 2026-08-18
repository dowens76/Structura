"use client";

export type PoetryArrowDirection = "down" | "right" | "left";

/**
 * SVG arrow icon for the Continuation (↓) and Requiredness (→/←)
 * poetry-notation marks. Replaces plain Unicode glyph characters (↓ / → / ←)
 * so the arrow's thickness is numerically controllable via strokeWidth
 * rather than relying on font rendering. Baseline stroke weight is 1.5px (a
 * typical thin icon stroke); the arrows render at 200% thicker than that
 * baseline — i.e. 3x — which is 4.5px. Shared between WordToken.tsx (source
 * words) and VerseDisplay.tsx's translation-token renderer so both stay in
 * sync. "left" is the "right" path mirrored horizontally — used for
 * Requiredness under Hebrew (RTL) text, where "forward" points left.
 */
export default function PoetryArrowIcon({
  direction,
  color,
  size = 12,
}: {
  direction: PoetryArrowDirection;
  color: string;
  size?: number;
}) {
  const BASELINE_STROKE_WIDTH = 1.5;
  const strokeWidth = BASELINE_STROKE_WIDTH * 3; // +200% = 4.5px

  const d = direction === "down"
    ? "M12 3 V19 M5 13 L12 20 L19 13"
    : direction === "left"
      ? "M21 12 H5 M11 5 L4 12 L11 19"
      : "M3 12 H19 M13 5 L20 12 L13 19";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
