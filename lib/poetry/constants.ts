export type PoetryPrinciple =
  | "continuation"
  | "balance"
  | "requiredness"
  | "symmetry"
  | "similarity"
  | "closure";

export type BalanceSubtype = "balance" | "imbalance";
export type ClosureSubtype = "weak" | "complete";
export type ImbalanceDirection = "left" | "right";
/** "arrow" (default/legacy, null subtype) = single-word gray → above the word;
 *  "underline" = arbitrary word range, gray underline (same range-picking UX as Closure — weak). */
export type RequirednessSubtype = "arrow" | "underline";

/** Fixed color per Gestalt principle (and balance/imbalance sub-variant), following the
 *  TC_COLORS / POS_COLORS idiom — colors are not stored per-row. */
export const POETRY_COLORS: Record<PoetryPrinciple | "imbalance", string> = {
  continuation: "#F97316", // orange-500
  balance:      "#7DD3FC", // light blue (sky-300)
  imbalance:    "#7DD3FC",
  requiredness: "#9CA3AF", // gray-400
  symmetry:     "#86EFAC", // light green (green-300)
  similarity:   "#FDE047", // yellow-300
  closure:      "#A855F7", // purple-500
};

export const POETRY_PRINCIPLE_LABELS: Record<PoetryPrinciple, string> = {
  continuation: "Continuation",
  balance: "Balance/Imbalance",
  requiredness: "Requiredness",
  symmetry: "Symmetry",
  similarity: "Similarity",
  closure: "Closure",
};

/** Single-glyph toolbar/badge icons, following the app's existing Unicode-glyph idiom
 *  (↩ ⇔ ⌐ ≡) rather than an SVG icon set. */
export const POETRY_PRINCIPLE_GLYPHS: Record<PoetryPrinciple, string> = {
  continuation: "↓",
  balance: "=",
  requiredness: "→",
  symmetry: "▼▲",
  similarity: "◯",
  closure: "▬",
};

export function balanceGlyph(subtype: BalanceSubtype | null | undefined, direction: ImbalanceDirection | null | undefined): string {
  if (subtype === "imbalance") return direction === "left" ? "◁" : "▷";
  return "=";
}

/** Darkens a "#RRGGBB" color by `amount` (0-1 fraction of each channel to
 *  remove) — used for Symmetry's inner-repeat glyphs so a line with the same
 *  mark applied more than once reads as nested rather than duplicated. */
export function darkenColor(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
