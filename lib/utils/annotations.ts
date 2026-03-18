/**
 * Fixed palette of 20 distinct colours for Theme and Desc annotations.
 * Arranged in 4 rows of 5 (warm → cool → dark).
 */
export const ANNOTATION_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#64748b", "#854d0e", "#166534", "#1e3a8a",
] as const;

// Plot element definitions — predefined labels, full names, and colors.
export const PLOT_ELEMENTS = [
  { label: "Info", fullName: "Background Information", color: "#D4A017" },
  { label: "IS",   fullName: "Initial Situation",      color: "#22C55E" },
  { label: "Con",  fullName: "Conflict",               color: "#EF4444" },
  { label: "TA",   fullName: "Transforming Action",    color: "#F97316" },
  { label: "Res",  fullName: "Resolution",             color: "#3B82F6" },
  { label: "FS",   fullName: "Final Situation",        color: "#22C55E" },
] as const;

export type PlotLabel = (typeof PLOT_ELEMENTS)[number]["label"];

export const PLOT_LABEL_SET: Set<string> = new Set(PLOT_ELEMENTS.map((p) => p.label));

/** Return the PLOT_ELEMENTS entry for a given label, or undefined. */
export function getPlotElement(label: string) {
  return PLOT_ELEMENTS.find((p) => p.label === label);
}

/**
 * Resolve the display color for an annotation.
 * Plot annotations use the predefined color for their label.
 * Theme annotations use the user-chosen color stored on the record.
 */
export function getAnnotationColor(annotType: string, label: string, color: string): string {
  if (annotType === "plot") {
    return getPlotElement(label)?.color ?? color;
  }
  return color;
}
