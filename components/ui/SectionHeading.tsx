"use client";

import type { ReactNode } from "react";

/**
 * Shared heading for named groups of content within a page body. Two sizes
 * cover every case found across the app's Manage pages:
 *  - "lg" (default): a whole content section, e.g. "Download Backup",
 *    "Corpus", "Word & Concept Tags". Renders an <h2>.
 *  - "label": a compact label above a field or button group that isn't a
 *    single form control, e.g. "Translation", "Books", "New Translation".
 * Spacing (margin) is deliberately not baked in — pass it via `className`
 * since surrounding layout varies too much to standardize here.
 */
export default function SectionHeading({
  children,
  size = "lg",
  bordered = false,
  className = "",
}: {
  children: ReactNode;
  size?: "lg" | "label";
  /** Adds a bottom border — for pages with many repeated sections (e.g.
   *  Keyboard Shortcuts, Content Licenses) where a divider aids scanning. */
  bordered?: boolean;
  className?: string;
}) {
  if (size === "label") {
    return (
      <p className={`text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500 ${className}`}>
        {children}
      </p>
    );
  }
  return (
    <h2
      className={[
        "text-base font-semibold",
        bordered ? "pb-2 border-b" : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{ color: "var(--foreground)", ...(bordered ? { borderColor: "var(--border)" } : {}) }}
    >
      {children}
    </h2>
  );
}
