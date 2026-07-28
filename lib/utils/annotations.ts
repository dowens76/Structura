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
  { label: "Background Information", fullName: "Background Information", color: "#D4A017" },
  { label: "Foreshadowing",          fullName: "Foreshadowing",          color: "#8B5CF6" },
  { label: "Flashback",              fullName: "Flashback",              color: "#6B7280" },
  { label: "Initial Situation",      fullName: "Initial Situation",      color: "#22C55E" },
  { label: "Inciting Incident",      fullName: "Inciting Incident",      color: "#84CC16" },
  { label: "Conflict",               fullName: "Conflict",               color: "#EF4444" },
  { label: "Rising Tension",         fullName: "Rising Tension",         color: "#F59E0B" },
  { label: "Transforming Action",    fullName: "Transforming Action",    color: "#F97316" },
  { label: "Climax/Resolution",      fullName: "Climax/Resolution",      color: "#3B82F6" },
  { label: "Denouement",             fullName: "Denouement",             color: "#06B6D4" },
  { label: "Final Situation",        fullName: "Final Situation",        color: "#22C55E" },
  { label: "Epilogue",               fullName: "Epilogue",               color: "#78716C" },
] as const;

export type PlotLabel = (typeof PLOT_ELEMENTS)[number]["label"];

export const PLOT_LABEL_SET: Set<string> = new Set(PLOT_ELEMENTS.map((p) => p.label));

/** Return the PLOT_ELEMENTS entry for a given label, or undefined. */
export function getPlotElement(label: string) {
  return PLOT_ELEMENTS.find((p) => p.label === label);
}

export const LINK_TYPES = [
  { value: "quotation",          label: "Quotation",          color: "#d97706" },   // amber
  { value: "allusion",           label: "Allusion",           color: "#3b82f6" },   // blue
  { value: "echo",               label: "Echo",               color: "#6b7280" },   // gray
  { value: "typology",           label: "Typology",           color: "#8b5cf6" },   // violet
  { value: "midrashic_reuse",    label: "Midrashic Reuse",    color: "#dc2626" },   // red
  { value: "paraphrase",         label: "Paraphrase",         color: "#16a34a" },   // green
  { value: "shared_motif",       label: "Shared Motif",       color: "#0891b2" },   // cyan
  { value: "narrative_parallel", label: "Narrative Parallel", color: "#0d9488" },   // teal
  { value: "lexical_parallel",   label: "Lexical Parallel",   color: "#ca8a04" },   // yellow
  { value: "structural_parallel",label: "Structural Parallel",color: "#7c3aed" },   // purple
] as const;

export type LinkTypeValue = (typeof LINK_TYPES)[number]["value"];

export function getLinkTypeColor(linkType: string): string {
  return LINK_TYPES.find((t) => t.value === linkType)?.color ?? "#6b7280";
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
